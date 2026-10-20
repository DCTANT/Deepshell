package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * HTTPS/TLS：局域网模式下默认自动启用。
 * 未配置 keystore 时，首次启动调用 JDK 自带 keytool 在数据目录生成自签 PKCS12 证书；
 * 也支持配置正式证书（PKCS12/JKS），供反向代理之外的内网 HTTPS 使用。
 */
@Slf4j
@Service
public class TlsService {

    @Value("${deepshell.tls.mode:auto}")
    private String mode;

    @Value("${deepshell.tls.keystore:}")
    private String configuredKeystore;

    @Value("${deepshell.tls.keystore-password:}")
    private String configuredKeystorePassword;

    @Value("${deepshell.tls.keystore-type:PKCS12}")
    private String configuredKeystoreType;

    @Value("${deepshell.tls.key-alias:deepshell}")
    private String configuredKeyAlias;

    @Value("${deepshell.tls.key-password:}")
    private String configuredKeyPassword;

    @Value("${server.address:127.0.0.1}")
    private String bindAddress;

    @Value("${server.port:18080}")
    private int port;

    private volatile boolean enabled;
    private volatile boolean selfSigned;
    private volatile String keystorePath;
    private volatile String keystorePassword;
    private volatile String keyPassword;
    private volatile String keystoreType;
    private volatile String keyAlias;

    @PostConstruct
    void init() {
        String m = mode == null ? "auto" : mode.trim().toLowerCase(Locale.ROOT);
        enabled = wouldEnable(isLanBinding(bindAddress));
        if (!enabled) {
            return;
        }
        selfSigned = isBlank(configuredKeystore);
        if (selfSigned) {
            initSelfSigned();
        } else {
            initConfigured();
        }
        log.info("TLS 已启用（{}），访问地址将使用 https", selfSigned ? "自签证书" : "自定义证书");
    }

    /** 根据当前/目标监听地址判断是否会启用；auto 只在局域网模式启用 */
    public boolean wouldEnable(boolean lanBinding) {
        String m = mode == null ? "auto" : mode.trim().toLowerCase(Locale.ROOT);
        if ("on".equals(m) || "true".equals(m) || "always".equals(m)) {
            return true;
        }
        if ("off".equals(m) || "false".equals(m) || "never".equals(m)) {
            return false;
        }
        return lanBinding;
    }

    private void initConfigured() {
        Path path = Paths.get(configuredKeystore.trim()).toAbsolutePath().normalize();
        if (!Files.isRegularFile(path)) {
            throw new IllegalStateException("TLS keystore 不存在：" + path
                    + "。请检查 deepshell.tls.keystore，或留空自动生成自签证书。");
        }
        if (isBlank(configuredKeystorePassword)) {
            throw new IllegalStateException("配置了 deepshell.tls.keystore 时必须同时配置 deepshell.tls.keystore-password");
        }
        keystorePath = path.toString();
        keystorePassword = configuredKeystorePassword;
        keyPassword = isBlank(configuredKeyPassword) ? configuredKeystorePassword : configuredKeyPassword;
        keystoreType = isBlank(configuredKeystoreType) ? "PKCS12" : configuredKeystoreType.trim();
        keyAlias = isBlank(configuredKeyAlias) ? "deepshell" : configuredKeyAlias.trim();
    }

    private void initSelfSigned() {
        Path dir = DataDir.root().resolve("tls");
        Path ks = dir.resolve("deepshell.p12");
        Path passFile = dir.resolve("keystore.pass");
        Path sanFile = dir.resolve("san.txt");
        try {
            Files.createDirectories(dir);
            String san = buildSan();
            boolean reuse = Files.isRegularFile(ks) && Files.isRegularFile(passFile)
                    && Files.isRegularFile(sanFile)
                    && san.equals(new String(Files.readAllBytes(sanFile), StandardCharsets.UTF_8).trim());
            String pass;
            if (reuse) {
                pass = new String(Files.readAllBytes(passFile), StandardCharsets.UTF_8).trim();
            } else {
                pass = randomPassword();
                generateKeyStore(ks, pass, san);
                writePrivate(passFile, pass);
                writePrivate(sanFile, san);
            }
            keystorePath = ks.toAbsolutePath().toString();
            keystorePassword = pass;
            keyPassword = pass;
            keystoreType = "PKCS12";
            keyAlias = isBlank(configuredKeyAlias) ? "deepshell" : configuredKeyAlias.trim();
        } catch (Exception e) {
            if (e instanceof IllegalStateException) {
                throw (IllegalStateException) e;
            }
            throw new IllegalStateException("初始化自签 TLS 证书失败: " + e.getMessage(), e);
        }
    }

    private void generateKeyStore(Path ks, String pass, String san) throws Exception {
        String keytool = keytoolPath();
        List<String> cmd = new ArrayList<>();
        cmd.add(keytool);
        cmd.add("-genkeypair");
        cmd.add("-alias");
        cmd.add(isBlank(configuredKeyAlias) ? "deepshell" : configuredKeyAlias.trim());
        cmd.add("-keyalg");
        cmd.add("RSA");
        cmd.add("-keysize");
        cmd.add("2048");
        cmd.add("-sigalg");
        cmd.add("SHA256withRSA");
        cmd.add("-validity");
        cmd.add("3650");
        cmd.add("-storetype");
        cmd.add("PKCS12");
        cmd.add("-keystore");
        cmd.add(ks.toString());
        cmd.add("-storepass");
        cmd.add(pass);
        cmd.add("-keypass");
        cmd.add(pass);
        cmd.add("-dname");
        cmd.add("CN=DeepShell, OU=DeepShell, O=DeepShell, L=Local, ST=Local, C=CN");
        cmd.add("-ext");
        cmd.add("SAN=" + san);
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        Process p = pb.start();
        String output;
        try (InputStream in = p.getInputStream(); ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[2048];
            int n;
            while ((n = in.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            output = new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
        if (!p.waitFor(60, TimeUnit.SECONDS)) {
            p.destroyForcibly();
            throw new IllegalStateException("生成自签证书超时");
        }
        if (p.exitValue() != 0) {
            try {
                Files.deleteIfExists(ks);
            } catch (Exception ignore) {
            }
            throw new IllegalStateException("生成自签证书失败（keytool 退出码 " + p.exitValue() + "）："
                    + clip(output));
        }
        log.info("已生成自签 TLS 证书：{}（SAN: {}）", ks, san);
    }

    private String keytoolPath() {
        String exe = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win")
                ? "keytool.exe" : "keytool";
        Path path = Paths.get(System.getProperty("java.home"), "bin", exe);
        if (!Files.isRegularFile(path)) {
            throw new IllegalStateException("未找到 keytool：" + path
                    + "。请使用 JDK 8+ 启动，或在 application.yml 配置正式 TLS 证书。");
        }
        return path.toString();
    }

    /** 证书 SAN：localhost + 本机 IPv4 地址，局域网 IP 变化后下次启动会自动重签 */
    private String buildSan() {
        Set<String> parts = new LinkedHashSet<>();
        parts.add("dns:localhost");
        parts.add("ip:127.0.0.1");
        try {
            String host = InetAddress.getLocalHost().getHostName();
            if (host != null && host.matches("[A-Za-z0-9.-]+") && host.contains(".")) {
                parts.add("dns:" + host);
            }
        } catch (Exception ignore) {
        }
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            while (nis != null && nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback()) {
                    continue;
                }
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) {
                        parts.add("ip:" + a.getHostAddress());
                    }
                }
            }
        } catch (Exception ignore) {
        }
        return String.join(",", parts);
    }

    private static String randomPassword() {
        byte[] bytes = new byte[18];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static void writePrivate(Path file, String content) throws Exception {
        Files.write(file, content.getBytes(StandardCharsets.UTF_8));
        try {
            Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException ignore) {
            // Windows 等文件系统不支持 POSIX 权限
        }
    }

    private static String clip(String s) {
        String t = s == null ? "" : s.trim();
        return t.length() > 800 ? t.substring(0, 800) : t;
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    private static boolean isLanBinding(String address) {
        return "0.0.0.0".equals(address) || "::".equals(address) || "[::]".equals(address);
    }

    public boolean isEnabled() {
        return enabled;
    }

    public boolean isSelfSigned() {
        return selfSigned;
    }

    public String getScheme() {
        return enabled ? "https" : "http";
    }

    public String getMode() {
        return mode == null ? "auto" : mode.trim().toLowerCase(Locale.ROOT);
    }

    public String localUrl() {
        return getScheme() + "://127.0.0.1:" + port;
    }

    public String getKeystorePath() {
        return keystorePath;
    }

    public String getKeystorePassword() {
        return keystorePassword;
    }

    public String getKeyPassword() {
        return keyPassword;
    }

    public String getKeystoreType() {
        return keystoreType;
    }

    public String getKeyAlias() {
        return keyAlias;
    }
}
