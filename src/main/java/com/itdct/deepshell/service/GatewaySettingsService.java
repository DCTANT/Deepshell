package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 本机作为执行网关时的服务端配置：是否启用、目标白名单、并发上限与访问 Token。
 * Token 优先取 application.yml 的 deepshell.gateway.token，否则生成到数据目录 gateway.token；
 * 白名单支持精确主机名、*.域名、单 IP 与 CIDR，解析后的 IP 也会参与匹配。
 */
@Slf4j
@Service
public class GatewaySettingsService {

    /** 客户端携带网关 Token 的请求头（WebSocket 握手同样适用） */
    public static final String HEADER = "X-DeepShell-Gateway-Token";

    public static final String KEY_ENABLED = "gateway.enabled";
    public static final String KEY_ALLOWLIST = "gateway.allowlist";
    public static final String KEY_MAX_CONNECTIONS = "gateway.max-connections";

    private static final int DEFAULT_MAX_CONNECTIONS = 16;

    private static final SecureRandom RANDOM = new SecureRandom();

    @Value("${deepshell.gateway.token:}")
    private String configuredToken;

    private final Path settingsFile = DataDir.root().resolve("gateway.properties");
    private final Path tokenFile = DataDir.root().resolve("gateway.token");

    private final AtomicInteger activeTunnels = new AtomicInteger();

    public synchronized Properties load() {
        Properties p = new Properties();
        try {
            if (Files.isRegularFile(settingsFile)) {
                try (InputStream in = Files.newInputStream(settingsFile)) {
                    p.load(in);
                }
            }
        } catch (Exception e) {
            log.warn("读取网关配置失败: {}", e.getMessage());
        }
        return p;
    }

    private synchronized void store(Properties p) {
        try {
            Files.createDirectories(settingsFile.getParent());
            try (OutputStream out = Files.newOutputStream(settingsFile)) {
                p.store(out, "DeepShell execution gateway");
            }
            restrictToOwner(settingsFile);
        } catch (Exception e) {
            throw new IllegalStateException("保存网关配置失败: " + e.getMessage());
        }
    }

    public boolean isEnabled() {
        return "true".equalsIgnoreCase(load().getProperty(KEY_ENABLED, "false").trim());
    }

    public void setEnabled(boolean enabled) {
        Properties p = load();
        p.setProperty(KEY_ENABLED, String.valueOf(enabled));
        store(p);
    }

    public List<String> allowlist() {
        String raw = load().getProperty(KEY_ALLOWLIST, "");
        List<String> out = new ArrayList<>();
        for (String line : raw.split("[,\\r\\n]+")) {
            String v = line == null ? "" : line.trim();
            if (!v.isEmpty() && !v.startsWith("#") && !out.contains(v)) {
                out.add(v);
            }
        }
        return out;
    }

    public void setAllowlist(List<String> entries) {
        List<String> clean = new ArrayList<>();
        if (entries != null) {
            for (String e : entries) {
                String v = e == null ? "" : e.trim();
                if (!v.isEmpty() && !v.startsWith("#") && !clean.contains(v)) {
                    clean.add(v);
                }
            }
        }
        Properties p = load();
        p.setProperty(KEY_ALLOWLIST, String.join("\n", clean));
        store(p);
    }

    public int maxConnections() {
        try {
            int v = Integer.parseInt(load().getProperty(KEY_MAX_CONNECTIONS,
                    String.valueOf(DEFAULT_MAX_CONNECTIONS)).trim());
            return Math.max(1, Math.min(64, v));
        } catch (NumberFormatException e) {
            return DEFAULT_MAX_CONNECTIONS;
        }
    }

    public void setMaxConnections(int max) {
        Properties p = load();
        p.setProperty(KEY_MAX_CONNECTIONS, String.valueOf(Math.max(1, Math.min(64, max))));
        store(p);
    }

    public int activeTunnels() {
        return activeTunnels.get();
    }

    public void tunnelOpened() {
        activeTunnels.incrementAndGet();
    }

    public void tunnelClosed() {
        activeTunnels.updateAndGet(v -> v > 0 ? v - 1 : 0);
    }

    /**
     * 目标是否在白名单内。空白名单视为拒绝全部，避免误开成开放代理。
     * 主机名匹配精确 / 通配符规则；IP 与 CIDR 规则同时匹配请求地址和 DNS 解析结果。
     */
    public boolean isTargetAllowed(String host, int port) {
        if (host == null || host.trim().isEmpty() || port < 1 || port > 65535) {
            return false;
        }
        List<String> entries = allowlist();
        if (entries.isEmpty()) {
            return false;
        }
        String target = host.trim().toLowerCase(Locale.ROOT);
        List<String> rules = new ArrayList<>();
        for (String e : entries) {
            rules.add(e.toLowerCase(Locale.ROOT));
        }
        for (String rule : rules) {
            if ("*".equals(rule)) {
                return true;
            }
            if (rule.startsWith("*.")) {
                String suffix = rule.substring(1);
                if (target.endsWith(suffix) && target.length() > suffix.length()) {
                    return true;
                }
                continue;
            }
            if (rule.contains("/")) {
                continue;
            }
            if (rule.equals(target)) {
                return true;
            }
        }
        InetAddress[] addresses;
        try {
            addresses = InetAddress.getAllByName(host.trim());
        } catch (Exception e) {
            return false;
        }
        for (InetAddress address : addresses) {
            String ip = address.getHostAddress();
            for (String rule : rules) {
                if (rule.contains("/")) {
                    if (matchesCidr(address, rule)) {
                        return true;
                    }
                } else if (isIpLiteral(rule) && rule.equals(ip.toLowerCase(Locale.ROOT))) {
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean isIpLiteral(String value) {
        return value.indexOf(':') >= 0 || value.matches("\\d{1,3}(\\.\\d{1,3}){3}");
    }

    static boolean matchesCidr(InetAddress address, String cidr) {
        try {
            int slash = cidr.indexOf('/');
            String base = cidr.substring(0, slash).trim();
            int prefix = Integer.parseInt(cidr.substring(slash + 1).trim());
            InetAddress network = InetAddress.getByName(base);
            byte[] a = address.getAddress();
            byte[] n = network.getAddress();
            if (a.length != n.length || prefix < 0 || prefix > a.length * 8) {
                return false;
            }
            int fullBytes = prefix / 8;
            int remainBits = prefix % 8;
            for (int i = 0; i < fullBytes; i++) {
                if (a[i] != n[i]) {
                    return false;
                }
            }
            if (remainBits == 0) {
                return true;
            }
            int mask = 0xFF << (8 - remainBits);
            return (a[fullBytes] & mask) == (n[fullBytes] & mask);
        } catch (Exception e) {
            return false;
        }
    }

    public boolean isConfiguredToken() {
        return configuredToken != null && !configuredToken.trim().isEmpty();
    }

    public synchronized String token() {
        if (isConfiguredToken()) {
            return configuredToken.trim();
        }
        if (Files.isRegularFile(tokenFile)) {
            try {
                String value = new String(Files.readAllBytes(tokenFile), StandardCharsets.UTF_8).trim();
                if (!value.isEmpty()) {
                    return value;
                }
            } catch (Exception e) {
                log.warn("读取网关 Token 失败: {}", e.getMessage());
            }
        }
        try {
            String value = randomToken();
            Files.createDirectories(tokenFile.getParent());
            Files.write(tokenFile, (value + System.lineSeparator()).getBytes(StandardCharsets.UTF_8));
            restrictToOwner(tokenFile);
            log.info("已生成执行网关 Token: {}", tokenFile);
            return value;
        } catch (Exception e) {
            throw new IllegalStateException("生成网关 Token 失败：" + e.getMessage(), e);
        }
    }

    public synchronized String regenerateToken() {
        if (isConfiguredToken()) {
            throw new IllegalArgumentException("当前网关 Token 由 application.yml 固定配置，请修改配置后重启");
        }
        try {
            String value = randomToken();
            Files.createDirectories(tokenFile.getParent());
            Files.write(tokenFile, (value + System.lineSeparator()).getBytes(StandardCharsets.UTF_8));
            restrictToOwner(tokenFile);
            return value;
        } catch (Exception e) {
            throw new IllegalStateException("重新生成网关 Token 失败：" + e.getMessage(), e);
        }
    }

    public boolean verifyToken(String supplied) {
        if (supplied == null || supplied.trim().isEmpty()) {
            return false;
        }
        String expected;
        try {
            expected = token();
        } catch (Exception e) {
            return false;
        }
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                supplied.trim().getBytes(StandardCharsets.UTF_8));
    }

    public Path tokenFile() {
        return tokenFile;
    }

    private static String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static void restrictToOwner(Path file) {
        try {
            Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
            Files.setPosixFilePermissions(file, perms);
        } catch (Exception ignore) {
            // Windows 等不支持 POSIX 权限的平台交给用户目录 ACL
        }
    }
}
