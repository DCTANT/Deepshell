import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * DeepShell 插件签名工具（独立运行，不依赖项目 classpath）。
 *
 * 用法：
 *   java tools/PluginSigner.java generate <private.pem> <public.pem> [keyId]
 *   java tools/PluginSigner.java sign <plugin.zip> <private.pem> [keyId]
 *   java tools/PluginSigner.java verify <plugin.zip> <public.pem>
 *
 * 私钥只应保存在本机，不能提交到代码仓库。签名覆盖 ZIP 内除 plugin.sig 外的
 * 全部文件：按相对路径排序，逐个写入路径和 SHA-256，再用 RSA SHA256withRSA 签名。
 */
public final class PluginSigner {

    private static final String PREFIX = "DEEPSHELL-PLUGIN-SIGNATURE-V1\n";
    private static final String ALGORITHM = "SHA256withRSA";
    private static final String DEFAULT_KEY_ID = "deepshell-official-2026-10";
    private static final String SIGNATURE_FILE = "plugin.sig";

    private PluginSigner() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            usage();
            return;
        }
        String command = args[0].toLowerCase();
        if ("generate".equals(command)) {
            if (args.length < 3) {
                usage();
                return;
            }
            generate(Paths.get(args[1]), Paths.get(args[2]),
                    args.length >= 4 ? args[3] : DEFAULT_KEY_ID);
        } else if ("sign".equals(command)) {
            if (args.length < 3) {
                usage();
                return;
            }
            sign(Paths.get(args[1]), Paths.get(args[2]),
                    args.length >= 4 ? args[3] : DEFAULT_KEY_ID);
        } else if ("verify".equals(command)) {
            if (args.length < 3) {
                usage();
                return;
            }
            verify(Paths.get(args[1]), Paths.get(args[2]));
        } else {
            usage();
        }
    }

    private static void usage() {
        System.out.println("Usage:");
        System.out.println("  java tools/PluginSigner.java generate <private.pem> <public.pem> [keyId]");
        System.out.println("  java tools/PluginSigner.java sign <plugin.zip> <private.pem> [keyId]");
        System.out.println("  java tools/PluginSigner.java verify <plugin.zip> <public.pem>");
    }

    private static void generate(Path privateFile, Path publicFile, String keyId) throws Exception {
        validateKeyId(keyId);
        if (Files.exists(privateFile) || Files.exists(publicFile)) {
            throw new IOException("目标密钥文件已存在，拒绝覆盖。请先备份并移走旧密钥。");
        }
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(3072);
        KeyPair pair = generator.generateKeyPair();

        Files.createDirectories(privateFile.toAbsolutePath().getParent());
        Files.createDirectories(publicFile.toAbsolutePath().getParent());
        writePem(privateFile, "PRIVATE KEY", pair.getPrivate().getEncoded());
        writePem(publicFile, "PUBLIC KEY", pair.getPublic().getEncoded());
        try {
            Files.setPosixFilePermissions(privateFile,
                    java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (Exception ignore) {
            // Windows 不支持 POSIX 权限，请自行通过文件系统 ACL 保护私钥
        }
        System.out.println("keyId=" + keyId);
        System.out.println("private=" + privateFile.toAbsolutePath());
        System.out.println("public=" + publicFile.toAbsolutePath());
        System.out.println("Private key must stay local and must never be committed.");
    }

    private static void sign(Path zipFile, Path privateFile, String keyId) throws Exception {
        validateKeyId(keyId);
        if (!Files.isRegularFile(zipFile)) {
            throw new IOException("插件 ZIP 不存在: " + zipFile);
        }
        if (!Files.isRegularFile(privateFile)) {
            throw new IOException("私钥不存在: " + privateFile);
        }
        PrivateKey privateKey = readPrivateKey(privateFile);
        PluginZip zip = readZip(zipFile);
        String base = findBase(zip.names);
        byte[] canonical = canonical(zip.entries, base);
        Signature signer = Signature.getInstance(ALGORITHM);
        signer.initSign(privateKey);
        signer.update(canonical);
        String signature = Base64.getEncoder().encodeToString(signer.sign());
        StringBuilder sigFile = new StringBuilder();
        sigFile.append("format=1\n");
        sigFile.append("keyId=").append(keyId).append('\n');
        sigFile.append("algorithm=").append(ALGORITHM).append('\n');
        sigFile.append("signature=").append(signature).append('\n');
        String sigName = base + SIGNATURE_FILE;
        zip.entries.put(sigName, sigFile.toString().getBytes(StandardCharsets.UTF_8));
        if (!zip.names.contains(sigName)) {
            zip.names.add(sigName);
        }
        writeZip(zipFile, zip);
        System.out.println("signed=" + zipFile.toAbsolutePath());
        System.out.println("keyId=" + keyId);
        System.out.println("files=" + (countFiles(zip.entries, base)));
        System.out.println("digest=" + sha256Hex(canonical));
    }

    private static void verify(Path zipFile, Path publicFile) throws Exception {
        if (!Files.isRegularFile(zipFile)) {
            throw new IOException("插件 ZIP 不存在: " + zipFile);
        }
        PublicKey publicKey = readPublicKey(publicFile);
        PluginZip zip = readZip(zipFile);
        String base = findBase(zip.names);
        byte[] sigBytes = zip.entries.get(base + SIGNATURE_FILE);
        if (sigBytes == null) {
            throw new IOException("插件未签名（缺少 " + SIGNATURE_FILE + "）");
        }
        Properties props = new Properties();
        props.load(new java.io.StringReader(new String(sigBytes, StandardCharsets.UTF_8)));
        String keyId = props.getProperty("keyId", "");
        String alg = props.getProperty("algorithm", "");
        if (!ALGORITHM.equals(alg)) {
            throw new IOException("不支持的签名算法: " + alg);
        }
        byte[] signature = Base64.getDecoder().decode(props.getProperty("signature", ""));
        Signature verifier = Signature.getInstance(ALGORITHM);
        verifier.initVerify(publicKey);
        verifier.update(canonical(zip.entries, base));
        if (!verifier.verify(signature)) {
            throw new IOException("插件签名无效");
        }
        System.out.println("verified=true keyId=" + keyId + " files=" + countFiles(zip.entries, base));
    }

    private static PluginZip readZip(Path file) throws Exception {
        PluginZip zip = new PluginZip();
        try (ZipFile zf = new ZipFile(file.toFile(), StandardCharsets.UTF_8)) {
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                ZipEntry entry = en.nextElement();
                String name = entry.getName().replace('\\', '/');
                if (name.isEmpty()) {
                    continue;
                }
                zip.names.add(name);
                if (entry.isDirectory() || name.endsWith("/")) {
                    zip.directories.add(name);
                    continue;
                }
                try (InputStream in = zf.getInputStream(entry)) {
                    zip.entries.put(name, readAll(in));
                }
            }
        }
        return zip;
    }

    private static void writeZip(Path target, PluginZip zip) throws Exception {
        Path tmp = target.resolveSibling(target.getFileName().toString() + ".signed.tmp");
        try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(tmp), StandardCharsets.UTF_8)) {
            for (String name : zip.names) {
                if (zip.directories.contains(name)) {
                    ZipEntry e = new ZipEntry(name);
                    out.putNextEntry(e);
                    out.closeEntry();
                    continue;
                }
                byte[] data = zip.entries.get(name);
                if (data == null) {
                    continue;
                }
                ZipEntry e = new ZipEntry(name);
                out.putNextEntry(e);
                out.write(data);
                out.closeEntry();
            }
        }
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
    }

    private static String findBase(List<String> names) throws IOException {
        for (String name : names) {
            if ("plugin.json".equals(name)) {
                return "";
            }
        }
        List<String> candidates = new ArrayList<>();
        for (String name : names) {
            if (!name.endsWith("/plugin.json")) {
                continue;
            }
            String prefix = name.substring(0, name.length() - "plugin.json".length());
            if (prefix.endsWith("/") && prefix.substring(0, prefix.length() - 1).indexOf('/') < 0) {
                candidates.add(prefix);
            }
        }
        if (candidates.size() == 1) {
            return candidates.get(0);
        }
        throw new IOException("ZIP 根目录或唯一顶层文件夹中必须包含 plugin.json");
    }

    private static byte[] canonical(Map<String, byte[]> entries, String base) throws Exception {
        TreeMap<String, byte[]> files = new TreeMap<>();
        String sigName = base + SIGNATURE_FILE;
        for (Map.Entry<String, byte[]> e : entries.entrySet()) {
            String name = e.getKey();
            if (!name.startsWith(base) || name.equals(sigName)) {
                continue;
            }
            files.put(name.substring(base.length()), e.getValue());
        }
        StringBuilder sb = new StringBuilder(PREFIX);
        for (Map.Entry<String, byte[]> e : files.entrySet()) {
            sb.append(e.getKey()).append('\n');
            sb.append(sha256Hex(e.getValue())).append('\n');
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static int countFiles(Map<String, byte[]> entries, String base) {
        int n = 0;
        String sigName = base + SIGNATURE_FILE;
        for (String name : entries.keySet()) {
            if (name.startsWith(base) && !name.equals(sigName)) {
                n++;
            }
        }
        return n;
    }

    private static String sha256Hex(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] digest = md.digest(data);
        StringBuilder sb = new StringBuilder(64);
        for (byte b : digest) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) >= 0) {
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private static void writePem(Path file, String label, byte[] der) throws Exception {
        String body = Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(der);
        String pem = "-----BEGIN " + label + "-----\n" + body + "\n-----END " + label + "-----\n";
        Files.write(file, pem.getBytes(StandardCharsets.US_ASCII));
    }

    private static PrivateKey readPrivateKey(Path file) throws Exception {
        String pem = new String(Files.readAllBytes(file), StandardCharsets.US_ASCII);
        byte[] der = Base64.getMimeDecoder().decode(cleanPem(pem, "PRIVATE KEY"));
        return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    private static PublicKey readPublicKey(Path file) throws Exception {
        String pem = new String(Files.readAllBytes(file), StandardCharsets.US_ASCII);
        byte[] der = Base64.getMimeDecoder().decode(cleanPem(pem, "PUBLIC KEY"));
        return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
    }

    private static String cleanPem(String pem, String label) {
        return pem.replace("-----BEGIN " + label + "-----", "")
                .replace("-----END " + label + "-----", "")
                .replaceAll("\\s", "");
    }

    private static void validateKeyId(String keyId) throws IOException {
        if (keyId == null || !keyId.matches("[A-Za-z0-9._-]{1,64}")) {
            throw new IOException("keyId 只能使用字母、数字、点、下划线、短横线，最长 64 个字符");
        }
    }

    private static final class PluginZip {
        private final List<String> names = new ArrayList<>();
        private final List<String> directories = new ArrayList<>();
        private final Map<String, byte[]> entries = new TreeMap<>();
    }
}
