package com.itdct.deepshell.protocol;

import com.itdct.deepshell.common.DataDir;

import java.io.InputStream;
import java.io.OutputStream;
import java.lang.management.ManagementFactory;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Base64;
import java.util.Date;
import java.util.Properties;
import java.util.Set;

/**
 * 外部调用相关的本机文件：运行实例地址、握手密钥与调用日志。
 * 这些文件必须由启动器（同一数据目录）与正在运行的 DeepShell 共享。
 */
public final class ProtocolFiles {

    private static final long LOG_ROTATE_BYTES = 2L * 1024 * 1024;
    private static final SecureRandom RANDOM = new SecureRandom();

    private ProtocolFiles() {
    }

    public static Path dataRoot() {
        return DataDir.root();
    }

    public static Path secretFile() {
        return dataRoot().resolve("protocol.key");
    }

    public static Path runtimeFile() {
        return dataRoot().resolve("runtime.properties");
    }

    public static Path logFile() {
        return dataRoot().resolve("logs").resolve("protocol.log");
    }

    /** 读取（必要时生成）握手密钥；文件不存在时返回 null。 */
    public static String readSecret() {
        Path file = secretFile();
        if (!Files.isRegularFile(file)) {
            return null;
        }
        try {
            byte[] bytes = Files.readAllBytes(file);
            String secret = new String(bytes, StandardCharsets.UTF_8).trim();
            return secret.isEmpty() ? null : secret;
        } catch (Exception e) {
            return null;
        }
    }

    /** 服务端启动时调用：没有密钥就生成一个仅当前用户可读的随机密钥。 */
    public static synchronized String ensureSecret() throws Exception {
        String existing = readSecret();
        if (existing != null) {
            return existing;
        }
        Files.createDirectories(dataRoot());
        byte[] random = new byte[32];
        RANDOM.nextBytes(random);
        String secret = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        Path file = secretFile();
        Files.write(file, (secret + System.lineSeparator()).getBytes(StandardCharsets.UTF_8),
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
        restrictToOwner(file);
        return secret;
    }

    public static void writeRuntime(String baseUrl, int port) {
        Properties props = new Properties();
        props.setProperty("url", baseUrl);
        props.setProperty("port", String.valueOf(port));
        props.setProperty("pid", String.valueOf(currentPid()));
        props.setProperty("startedAt", String.valueOf(System.currentTimeMillis()));
        Path target = runtimeFile();
        Path temp = target.resolveSibling(target.getFileName() + ".tmp");
        try {
            Files.createDirectories(target.getParent());
            try (OutputStream out = Files.newOutputStream(temp, StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
                props.store(out, "DeepShell runtime (managed automatically)");
            }
            try {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception ignore) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception e) {
            log("写入运行信息失败: " + e.getMessage());
        }
    }

    public static String readRuntimeUrl() {
        Path file = runtimeFile();
        if (!Files.isRegularFile(file)) {
            return null;
        }
        try (InputStream in = Files.newInputStream(file)) {
            Properties props = new Properties();
            props.load(in);
            String url = props.getProperty("url");
            return url == null || url.trim().isEmpty() ? null : url.trim();
        } catch (Exception e) {
            return null;
        }
    }

    /** 外部调用进程的日志（javaw 启动时看不到控制台，排错主要看这里）。 */
    public static synchronized void log(String message) {
        Path file = logFile();
        try {
            Files.createDirectories(file.getParent());
            if (Files.isRegularFile(file) && Files.size(file) > LOG_ROTATE_BYTES) {
                Path old = file.resolveSibling(file.getFileName() + ".1");
                Files.deleteIfExists(old);
                Files.move(file, old, StandardCopyOption.REPLACE_EXISTING);
            }
            String line = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss")
                    .format(new Date()) + " " + message + System.lineSeparator();
            Files.write(file, line.getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND, StandardOpenOption.WRITE);
        } catch (Exception ignore) {
            // 日志失败不影响调用
        }
    }

    public static long currentPid() {
        try {
            String name = ManagementFactory.getRuntimeMXBean().getName();
            int at = name.indexOf('@');
            return Long.parseLong(at > 0 ? name.substring(0, at) : name);
        } catch (Exception e) {
            return -1L;
        }
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
