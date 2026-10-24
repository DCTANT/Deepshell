package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.common.DataDir;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServletRequest;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

/**
 * 登录认证：配置开关、账号校验、JWT 签发/校验、Token 有效期（支持运行时修改）与滑动续期。
 *
 * <p>Token 使用 HS256 自实现 JWT，不引入额外依赖；签名密钥首次启动时随机生成并保存在数据目录
 * {@code auth.key}，重启后已签发的 Token 仍然有效。运行时修改的有效期保存在 {@code auth.properties}，
 * 优先于 application.yml 中的默认值。</p>
 */
@Slf4j
@Service
public class AuthService {

    /** HttpOnly Cookie 名称；WebSocket 握手时也从该 Cookie 读取 Token */
    public static final String COOKIE_NAME = "DS_TOKEN";
    public static final int MIN_EXPIRE_HOURS = 1;
    public static final int MAX_EXPIRE_HOURS = 720;

    private static final String HEADER_JSON = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";

    private final ObjectMapper om = new ObjectMapper();
    private final SecureRandom random = new SecureRandom();

    @Value("${deepshell.auth.enabled:false}")
    private boolean enabled;

    @Value("${deepshell.auth.username:admin}")
    private String username;

    @Value("${deepshell.auth.password:deepshell}")
    private String password;

    @Value("${deepshell.auth.token-expire-hours:6}")
    private int defaultExpireHours;

    @Value("${server.address:127.0.0.1}")
    private String bindAddress;

    private volatile byte[] secret;
    private volatile int expireHours;
    /** 账号密码摘要：修改密码后旧 Token 自动失效 */
    private volatile String credentialVersion;

    @PostConstruct
    void init() {
        if (username == null || username.trim().isEmpty()) {
            username = "admin";
        } else {
            username = username.trim();
        }
        if (password == null) {
            password = "deepshell";
        }
        // 安全底线：监听局域网时不允许无鉴权或默认密码
        if (isLanBinding(bindAddress)) {
            String lanHint = lanSwitchHint();
            if (!enabled) {
                throw new IllegalStateException("当前以局域网模式启动（监听 " + bindAddress + "），但登录认证未启用。"
                        + lanHint
                        + "如需继续开放局域网：设置 deepshell.auth.enabled=true 并修改 deepshell.auth.password 后重启；"
                        + "只想本机使用：在界面「局域网访问」中关闭开关后重启，"
                        + "或删除 " + DataDir.root().resolve("network.properties") + " 后重启，"
                        + "此时 application.yml 中的 server.address 才会生效。");
            }
            if (isDefaultPasswordValue(password)) {
                throw new IllegalStateException("当前以局域网模式启动（监听 " + bindAddress + "），"
                        + "但仍在使用随源码公开的默认密码。" + lanHint
                        + "请修改 deepshell.auth.password 后重启。");
            }
        }
        try {
            secret = loadOrCreateSecret();
        } catch (Exception e) {
            throw new IllegalStateException("初始化登录签名密钥失败: " + e.getMessage(), e);
        }
        expireHours = loadExpireHours();
        defaultExpireHours = clampExpireHours(defaultExpireHours);
        credentialVersion = credentialVersion();
        if (enabled && isDefaultPasswordValue(password)) {
            log.warn("登录功能已启用，但仍在使用默认密码，请尽快修改 application.yml 中的 deepshell.auth.password");
        }
    }

    public boolean isEnabled() {
        return enabled;
    }

    public boolean isDefaultPassword() {
        return isDefaultPasswordValue(password);
    }

    /** 源码 / 分发包里出现过的默认口令都按“未修改”处理，避免局域网用公开口令启动 */
    private static boolean isDefaultPasswordValue(String value) {
        return "deepshell".equals(value) || "deepshell2".equals(value);
    }

    /** 除回环地址外的任何绑定（0.0.0.0、::、具体网卡 IP、局域网主机名）都视为对外监听 */
    private static boolean isLanBinding(String address) {
        if (address == null || address.trim().isEmpty()) {
            return false;
        }
        String value = address.trim();
        if (value.startsWith("[") && value.endsWith("]")) {
            value = value.substring(1, value.length() - 1);
        }
        if ("localhost".equalsIgnoreCase(value)) {
            return false;
        }
        try {
            return !java.net.InetAddress.getByName(value).isLoopbackAddress();
        } catch (Exception e) {
            // 解析不了的主机名也按对外监听处理，宁可要求先配置登录
            return true;
        }
    }

    /** 解释监听地址为何是局域网：界面开关保存的 network.properties 优先于 application.yml */
    private static String lanSwitchHint() {
        Path file = DataDir.root().resolve("network.properties");
        if (!Files.isRegularFile(file)) {
            return "";
        }
        return "检测到 " + file + " 中保存的界面「局域网访问」开关为开启状态，"
                + "它会覆盖 application.yml 中的 server.address（改 yml 的地址不会生效）。";
    }

    public String getUsername() {
        return username;
    }

    public int getExpireHours() {
        return expireHours;
    }

    public int getDefaultExpireHours() {
        return defaultExpireHours;
    }

    /** 校验用户名与密码；使用常量时间比较，避免明显的时序差异 */
    public boolean matches(String user, String pass) {
        if (user == null || pass == null) {
            return false;
        }
        boolean userOk = MessageDigest.isEqual(
                username.getBytes(StandardCharsets.UTF_8), user.getBytes(StandardCharsets.UTF_8));
        boolean passOk = MessageDigest.isEqual(
                password.getBytes(StandardCharsets.UTF_8), pass.getBytes(StandardCharsets.UTF_8));
        return userOk & passOk;
    }

    /** 按当前有效期签发新 Token */
    public String issueToken() {
        long now = Instant.now().getEpochSecond();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("sub", username);
        payload.put("iat", now);
        payload.put("exp", now + (long) expireHours * 3600L);
        payload.put("ver", credentialVersion);
        payload.put("jti", UUID.randomUUID().toString());
        try {
            String header = b64(HEADER_JSON.getBytes(StandardCharsets.UTF_8));
            String body = b64(om.writeValueAsBytes(payload));
            return header + "." + body + "." + b64(hmac(header + "." + body));
        } catch (Exception e) {
            throw new IllegalStateException("签发 Token 失败: " + e.getMessage(), e);
        }
    }

    /** 校验签名、有效期与用户；失败返回 null */
    public TokenInfo verify(String token) {
        if (!enabled || token == null || token.isEmpty() || token.length() > 8192) {
            return null;
        }
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            return null;
        }
        try {
            byte[] actual = Base64.getUrlDecoder().decode(parts[2]);
            byte[] expected = hmac(parts[0] + "." + parts[1]);
            if (!MessageDigest.isEqual(expected, actual)) {
                return null;
            }
            JsonNode node = om.readTree(Base64.getUrlDecoder().decode(parts[1]));
            String sub = node.path("sub").asText("");
            String ver = node.path("ver").asText("");
            long iat = node.path("iat").asLong(0);
            long exp = node.path("exp").asLong(0);
            long now = Instant.now().getEpochSecond();
            if (!username.equals(sub) || !credentialVersion.equals(ver)
                    || exp <= now || iat > now + 300) {
                return null;
            }
            return new TokenInfo(sub, iat, exp);
        } catch (Exception e) {
            return null;
        }
    }

    /** 正常 API 请求中，剩余有效期不足一半时自动续签（WebSocket 长连接由前端定时 ping 续期） */
    public boolean shouldRenew(TokenInfo info) {
        if (info == null) {
            return false;
        }
        long ttl = (long) expireHours * 3600L;
        long remaining = info.expiresAt - Instant.now().getEpochSecond();
        return remaining < Math.max(60L, ttl / 2);
    }

    /** 从请求 Cookie 或 Authorization: Bearer 中提取 Token */
    public String tokenFromRequest(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie c : cookies) {
                if (COOKIE_NAME.equals(c.getName())) {
                    return c.getValue();
                }
            }
        }
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return authorization.substring(7).trim();
        }
        return null;
    }

    /** 从原始 Cookie 请求头提取 Token（WebSocket 握手用） */
    public String tokenFromCookieHeader(String cookieHeader) {
        if (cookieHeader == null || cookieHeader.isEmpty()) {
            return null;
        }
        for (String part : cookieHeader.split(";")) {
            int idx = part.indexOf('=');
            if (idx > 0 && COOKIE_NAME.equals(part.substring(0, idx).trim())) {
                return part.substring(idx + 1).trim();
            }
        }
        return null;
    }

    public ResponseCookie buildCookie(String token, HttpServletRequest request) {
        return ResponseCookie.from(COOKIE_NAME, token)
                .httpOnly(true)
                .secure(isSecure(request))
                .sameSite("Lax")
                .path("/")
                .maxAge(Duration.ofHours(expireHours))
                .build();
    }

    public ResponseCookie clearCookie(HttpServletRequest request) {
        return ResponseCookie.from(COOKIE_NAME, "")
                .httpOnly(true)
                .secure(isSecure(request))
                .sameSite("Lax")
                .path("/")
                .maxAge(Duration.ZERO)
                .build();
    }

    /** 修改 Token 有效期并持久化到数据目录，重启后保持 */
    public synchronized int updateExpireHours(int hours) {
        int value = clampExpireHours(hours);
        Path file = DataDir.root().resolve("auth.properties");
        Properties properties = new Properties();
        properties.setProperty("token.expire.hours", String.valueOf(value));
        try {
            Files.createDirectories(file.getParent());
            try (OutputStream out = Files.newOutputStream(file,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
                properties.store(out, "DeepShell auth settings");
            }
        } catch (Exception e) {
            throw new IllegalStateException("保存 Token 有效期失败: " + e.getMessage(), e);
        }
        expireHours = value;
        log.info("Token 有效期已调整为 {} 小时", value);
        return value;
    }

    /** 登录状态（不包含密码等敏感信息） */
    public Map<String, Object> status(TokenInfo info) {
        long now = Instant.now().getEpochSecond();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", enabled);
        m.put("defaultPassword", isDefaultPassword());
        m.put("loggedIn", !enabled || info != null);
        m.put("username", (!enabled || info != null) ? username : "");
        m.put("tokenExpireHours", expireHours);
        m.put("defaultTokenExpireHours", defaultExpireHours);
        if (info != null) {
            m.put("tokenExpiresAt", info.expiresAt * 1000L);
            m.put("tokenRemainingSeconds", Math.max(0L, info.expiresAt - now));
        }
        return m;
    }

    public static int clampExpireHours(int hours) {
        return Math.max(MIN_EXPIRE_HOURS, Math.min(MAX_EXPIRE_HOURS, hours));
    }

    public static class TokenInfo {
        public final String subject;
        public final long issuedAt;
        public final long expiresAt;

        TokenInfo(String subject, long issuedAt, long expiresAt) {
            this.subject = subject;
            this.issuedAt = issuedAt;
            this.expiresAt = expiresAt;
        }
    }

    /* ---------- 内部实现 ---------- */

    private byte[] loadOrCreateSecret() throws Exception {
        Path file = DataDir.root().resolve("auth.key");
        if (Files.isRegularFile(file)) {
            byte[] existing = Base64.getMimeDecoder().decode(Files.readAllBytes(file));
            if (existing.length >= 32) {
                return existing;
            }
        }
        byte[] key = new byte[32];
        random.nextBytes(key);
        Files.createDirectories(file.getParent());
        try {
            Files.write(file, Base64.getEncoder().encode(key),
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        } catch (FileAlreadyExistsException e) {
            byte[] existing = Base64.getMimeDecoder().decode(Files.readAllBytes(file));
            if (existing.length >= 32) {
                return existing;
            }
            Files.write(file, Base64.getEncoder().encode(key),
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        }
        try {
            Files.setPosixFilePermissions(file,
                    java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (Exception ignore) {
            // Windows 等不支持 POSIX 权限的文件系统忽略
        }
        return key;
    }

    private int loadExpireHours() {
        Path file = DataDir.root().resolve("auth.properties");
        if (Files.isRegularFile(file)) {
            try (InputStream in = Files.newInputStream(file)) {
                Properties properties = new Properties();
                properties.load(in);
                return clampExpireHours(Integer.parseInt(
                        properties.getProperty("token.expire.hours", String.valueOf(defaultExpireHours)).trim()));
            } catch (Exception e) {
                log.warn("读取 auth.properties 失败，使用默认 Token 有效期: {}", e.getMessage());
            }
        }
        return clampExpireHours(defaultExpireHours);
    }

    private String credentialVersion() {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest((username + "\n" + password).getBytes(StandardCharsets.UTF_8));
            return b64(digest).substring(0, 22);
        } catch (Exception e) {
            return "";
        }
    }

    private byte[] hmac(String data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
    }

    private static String b64(byte[] data) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(data);
    }

    private static boolean isSecure(HttpServletRequest request) {
        return request.isSecure() || "https".equalsIgnoreCase(request.getHeader("X-Forwarded-Proto"));
    }
}
