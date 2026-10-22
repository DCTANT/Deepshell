package com.itdct.deepshell.plugin;

import java.io.InputStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Properties;
import java.util.stream.Stream;

/**
 * 官方插件签名验证。公钥随程序分发，私钥只保存在 DeepShell 维护者本机。
 *
 * <p>签名覆盖插件目录内除 plugin.sig 以外的全部文件：按相对路径排序，
 * 依次写入路径和文件 SHA-256，再由官方 RSA 私钥签名。任何修改
 * plugin.json / 前端文件 / 后端 JAR 的行为都会导致验签失败。</p>
 */
public final class PluginSignatureService {

    public static final String KEY_ID = "deepshell-official-2026-10";
    private static final String PUBLIC_KEY_RESOURCE = "plugin-signing/deepshell-plugin-public.pem";
    private static final String ALGORITHM = "SHA256withRSA";
    private static final String PREFIX = "DEEPSHELL-PLUGIN-SIGNATURE-V1\n";
    private static final String SIGNATURE_FILE = "plugin.sig";

    private PluginSignatureService() {
    }

    public enum Status {
        VERIFIED,
        UNSIGNED,
        INVALID
    }

    public static final class Verification {
        private final Status status;
        private final String keyId;
        private final String message;

        private Verification(Status status, String keyId, String message) {
            this.status = status;
            this.keyId = keyId;
            this.message = message;
        }

        public Status getStatus() {
            return status;
        }

        public String getKeyId() {
            return keyId;
        }

        public String getMessage() {
            return message;
        }

        public boolean isVerified() {
            return status == Status.VERIFIED;
        }
    }

    public static Verification verify(Path pluginDir) {
        if (pluginDir == null || !Files.isDirectory(pluginDir)) {
            return invalid("", "插件目录不存在");
        }
        Path sigFile = pluginDir.resolve(SIGNATURE_FILE);
        if (!Files.isRegularFile(sigFile, LinkOption.NOFOLLOW_LINKS)) {
            return new Verification(Status.UNSIGNED, "", "未签名插件");
        }
        try {
            Properties props = new Properties();
            try (InputStream in = Files.newInputStream(sigFile)) {
                props.load(new StringReader(new String(readAll(in), StandardCharsets.UTF_8)));
            }
            if (!"1".equals(props.getProperty("format"))) {
                return invalid("", "签名文件格式不支持");
            }
            if (!ALGORITHM.equals(props.getProperty("algorithm"))) {
                return invalid("", "不支持的签名算法");
            }
            String keyId = props.getProperty("keyId", "");
            if (!KEY_ID.equals(keyId)) {
                return invalid(keyId, "未知的签名密钥");
            }
            PublicKey publicKey = loadPublicKey();
            if (publicKey == null) {
                return invalid(keyId, "程序缺少官方公钥");
            }
            Signature verifier = Signature.getInstance(ALGORITHM);
            verifier.initVerify(publicKey);
            verifier.update(canonical(pluginDir));
            byte[] signature = Base64.getDecoder().decode(props.getProperty("signature", ""));
            if (!verifier.verify(signature)) {
                return invalid(keyId, "插件文件已被修改或签名无效");
            }
            return new Verification(Status.VERIFIED, keyId, "官方签名有效");
        } catch (IllegalArgumentException e) {
            return invalid("", "签名数据格式不正确");
        } catch (Exception e) {
            return invalid("", "验签失败: " + safeMessage(e));
        }
    }

    /**
     * 未签名插件不能声明 DeepShell 官方作者，避免仅改 plugin.json 就冒充官方。
     * 真正可信的官方标识以 RSA 签名验证结果为准。
     */
    public static boolean claimsOfficialAuthor(String author) {
        if (author == null) {
            return false;
        }
        String lower = author.toLowerCase(java.util.Locale.ROOT);
        return lower.contains("deepshell")
                || lower.contains("deep shell")
                || lower.contains("官方")
                || lower.contains("official");
    }

    private static Verification invalid(String keyId, String message) {
        return new Verification(Status.INVALID, keyId, message);
    }

    private static PublicKey loadPublicKey() throws Exception {
        try (InputStream in = PluginSignatureService.class.getClassLoader()
                .getResourceAsStream(PUBLIC_KEY_RESOURCE)) {
            if (in == null) {
                return null;
            }
            String pem = new String(readAll(in), StandardCharsets.US_ASCII);
            String body = pem.replace("-----BEGIN PUBLIC KEY-----", "")
                    .replace("-----END PUBLIC KEY-----", "")
                    .replaceAll("\\s", "");
            byte[] der = Base64.getMimeDecoder().decode(body);
            return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
        }
    }

    private static byte[] canonical(Path pluginDir) throws Exception {
        List<Path> files = new ArrayList<>();
        try (Stream<Path> stream = Files.walk(pluginDir)) {
            stream.filter(p -> Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS))
                    .filter(p -> !p.equals(pluginDir.resolve(SIGNATURE_FILE)))
                    .forEach(files::add);
        }
        files.sort(Comparator.comparing(p -> relative(pluginDir, p)));
        StringBuilder sb = new StringBuilder(PREFIX);
        for (Path file : files) {
            sb.append(relative(pluginDir, file)).append('\n');
            sb.append(sha256Hex(Files.readAllBytes(file))).append('\n');
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static String relative(Path base, Path file) {
        return base.relativize(file).toString().replace('\\', '/');
    }

    private static String sha256Hex(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        StringBuilder sb = new StringBuilder(64);
        for (byte b : md.digest(data)) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static byte[] readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) >= 0) {
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private static String safeMessage(Exception e) {
        String msg = e.getMessage();
        return msg == null || msg.trim().isEmpty() ? e.getClass().getSimpleName() : msg;
    }
}
