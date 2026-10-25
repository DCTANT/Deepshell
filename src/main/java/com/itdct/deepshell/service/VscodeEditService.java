package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * VSCode 联动编辑：远端文件下载到本地编辑目录并用 VSCode 打开，
 * 轮询本地副本（内容哈希比对）并在保存后自动上传回服务器。
 *
 * <p>不使用 WatchService：部分平台（尤其是 VSCode 的原子保存：先写临时文件再重命名）
 * 可能丢失目录变更事件，导致保存后远端仍是旧文件。轮询 + 哈希可以可靠地发现
 * “内容变了但大小 / 时间戳未变”的情况，并在上传失败时自动重试。</p>
 */
@Slf4j
@Service
public class VscodeEditService {

    private static final long POLL_MS = 700;
    private static final long STABLE_MS = 500;
    private static final long RETRY_MS = 2000;
    private static final long FULL_CHECK_MS = 5000;
    /** 只有较小的文件才周期性做全量哈希，避免大文件被反复整读 */
    private static final long FULL_CHECK_MAX_BYTES = 4L * 1024 * 1024;

    private final SshSessionManager sessions;
    private final SftpService sftpService;

    @Value("${deepshell.vscode-command:code}")
    private String vscodeCommand = "code";

    private final Map<String, WatchRec> watches = new ConcurrentHashMap<>();

    public VscodeEditService(SshSessionManager sessions, SftpService sftpService) {
        this.sessions = sessions;
        this.sftpService = sftpService;
    }

    private static class WatchRec {
        String sessionId;
        String remotePath;
        Path localPath;
        volatile String syncedHash;
        volatile long lastAttemptAt;
        volatile boolean running = true;
    }

    public Map<String, Object> open(String sessionId, String remotePath) throws Exception {
        sessions.get(sessionId);
        String hash = sha1(remotePath).substring(0, 8);
        Path dir = DataDir.root().resolve("edit").resolve(sessionId).resolve(hash);
        Files.createDirectories(dir);
        Path local = dir.resolve(safeFileName(remotePath));

        boolean existed = Files.exists(local);
        if (!existed) {
            try (OutputStream out = Files.newOutputStream(local,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
                sftpService.download(sessionId, remotePath, out);
            } catch (Exception e) {
                Files.deleteIfExists(local);
                throw e;
            }
        }
        startWatchIfAbsent(sessionId, remotePath, local);
        launchVscode(local);

        Map<String, Object> r = new HashMap<>();
        r.put("localPath", local.toString());
        r.put("message", existed
                ? "已用 VSCode 打开本地副本，保存将自动同步回服务器"
                : "已下载并用 VSCode 打开，保存将自动同步回服务器");
        return r;
    }

    void startWatchIfAbsent(String sessionId, String remotePath, Path local) throws Exception {
        String key = local.toString();
        synchronized (watches) {
            WatchRec existing = watches.get(key);
            if (existing != null && existing.running) {
                existing.sessionId = sessionId;
                existing.remotePath = remotePath;
                return;
            }
            WatchRec rec = new WatchRec();
            rec.sessionId = sessionId;
            rec.remotePath = remotePath;
            rec.localPath = local;
            rec.syncedHash = sha256File(local);
            watches.put(key, rec);
            Thread t = new Thread(() -> watchLoop(rec), "vscode-sync-" + local.getFileName());
            t.setDaemon(true);
            t.start();
            log.info("开始监听 VSCode 本地副本: {}", local);
        }
    }

    private void watchLoop(WatchRec rec) {
        long seenSize = -1;
        long seenMtime = -1;
        long stableSince = System.currentTimeMillis();
        long uploadedSize = -1;
        long uploadedMtime = -1;
        long lastFullCheck = 0;
        try {
            while (true) {
                if (!alive(rec.sessionId)) {
                    log.info("会话已关闭，停止 VSCode 文件监听: {}", rec.localPath);
                    break;
                }
                BasicFileAttributes attrs;
                try {
                    attrs = Files.readAttributes(rec.localPath, BasicFileAttributes.class);
                } catch (NoSuchFileException e) {
                    // 原子保存的极短窗口内文件可能暂时不存在，下一轮再试
                    seenSize = -1;
                    seenMtime = -1;
                    Thread.sleep(POLL_MS);
                    continue;
                }
                long size = attrs.size();
                long mtime = attrs.lastModifiedTime().toMillis();
                long now = System.currentTimeMillis();
                if (size != seenSize || mtime != seenMtime) {
                    seenSize = size;
                    seenMtime = mtime;
                    stableSince = now;
                    Thread.sleep(POLL_MS);
                    continue;
                }
                boolean fullCheck = now - lastFullCheck >= FULL_CHECK_MS
                        && size <= FULL_CHECK_MAX_BYTES;
                if (size == uploadedSize && mtime == uploadedMtime && !fullCheck) {
                    Thread.sleep(POLL_MS);
                    continue;
                }
                // 等待写入稳定，避免把保存到一半的内容上传
                if (now - stableSince < STABLE_MS) {
                    Thread.sleep(POLL_MS);
                    continue;
                }
                if (now - rec.lastAttemptAt < RETRY_MS) {
                    Thread.sleep(POLL_MS);
                    continue;
                }

                byte[] data;
                try {
                    data = Files.readAllBytes(rec.localPath);
                } catch (IOException e) {
                    Thread.sleep(POLL_MS);
                    continue;
                }
                lastFullCheck = now;
                String hash = sha256(data);
                if (hash.equals(rec.syncedHash)) {
                    uploadedSize = size;
                    uploadedMtime = mtime;
                    Thread.sleep(POLL_MS);
                    continue;
                }

                rec.lastAttemptAt = now;
                if (upload(rec, data)) {
                    rec.syncedHash = hash;
                    uploadedSize = size;
                    uploadedMtime = mtime;
                }
                Thread.sleep(POLL_MS);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.warn("VSCode 文件监听退出: {}", e.getMessage());
        } finally {
            rec.running = false;
            watches.remove(rec.localPath.toString(), rec);
        }
    }

    private boolean alive(String sessionId) {
        try {
            sessions.get(sessionId);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 上传失败时在下一轮轮询继续重试，不丢用户的保存 */
    private boolean upload(WatchRec rec, byte[] data) {
        Exception last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                sftpService.putBytes(rec.sessionId, rec.remotePath, data);
                log.info("VSCode 保存已同步回服务器: {} -> {}（{} 字节）",
                        rec.localPath.getFileName(), rec.remotePath, data.length);
                return true;
            } catch (Exception e) {
                last = e;
                if (attempt < 3) {
                    try {
                        Thread.sleep(300L * attempt);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        return false;
                    }
                }
            }
        }
        log.warn("VSCode 保存同步失败，稍后自动重试: {} -> {}: {}",
                rec.localPath.getFileName(), rec.remotePath,
                last == null ? "未知错误" : last.getMessage());
        return false;
    }

    private void launchVscode(Path file) throws IOException {
        boolean win = System.getProperty("os.name").toLowerCase().contains("win");
        List<String> cmd;
        ProcessBuilder builder;
        if (win) {
            // 远端文件名不可信：只把净化后的相对文件名交给 cmd，工作目录单独设置，
            // 避免 & % ^ 等字符在 cmd 命令行里被当作命令分隔符。
            cmd = Arrays.asList("cmd", "/c", vscodeCommand, file.getFileName().toString());
            builder = new ProcessBuilder(cmd)
                    .directory(file.toAbsolutePath().getParent().toFile());
        } else {
            cmd = Arrays.asList(vscodeCommand, file.toString());
            builder = new ProcessBuilder(cmd);
        }
        Process p;
        try {
            p = builder.redirectErrorStream(true).start();
        } catch (IOException e) {
            throw new IOException("未找到 VSCode 命令（" + vscodeCommand
                    + "），请先安装 VSCode 并执行 'Shell Command: Install code command'，或在配置中指定 deepshell.vscode-command 完整路径");
        }
        try {
            if (!p.waitFor(15, java.util.concurrent.TimeUnit.SECONDS)) {
                p.destroy();
                return;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }
        if (p.exitValue() != 0) {
            String out = "";
            try {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = p.getInputStream().read(buf)) != -1) {
                    bos.write(buf, 0, n);
                }
                out = new String(bos.toByteArray(), StandardCharsets.UTF_8).trim();
            } catch (Exception ignore) {
            }
            throw new IOException("VSCode 启动失败（exit=" + p.exitValue() + "）" + (out.isEmpty() ? "" : ": " + out));
        }
    }

    private static String safeFileName(String remotePath) {
        String name = remotePath.substring(remotePath.lastIndexOf('/') + 1);
        // 只保留字母 / 数字 / . _ -，其余（含 & | < > ^ % ! 空格等）统一下划线，
        // 防止远端恶意文件名在 Windows cmd / 批处理参数中注入命令
        String safe = name.replaceAll("[^\\p{L}\\p{N}._-]", "_");
        while (safe.endsWith(".") || safe.endsWith(" ")) {
            safe = safe.substring(0, safe.length() - 1);
        }
        if (safe.isEmpty() || ".".equals(safe) || "..".equals(safe)) {
            safe = "file";
        }
        if (safe.startsWith("-")) {
            safe = "_" + safe;
        }
        if (safe.length() > 120) {
            safe = safe.substring(0, 120);
        }
        return safe;
    }

    private static String sha1(String s) throws Exception {
        return digest("SHA-1", s.getBytes(StandardCharsets.UTF_8));
    }

    private static String sha256(byte[] data) throws Exception {
        return digest("SHA-256", data);
    }

    private static String sha256File(Path file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = Files.newInputStream(file)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                md.update(buf, 0, n);
            }
        }
        return hex(md.digest());
    }

    private static String digest(String algorithm, byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance(algorithm);
        return hex(md.digest(data));
    }

    private static String hex(byte[] d) {
        StringBuilder sb = new StringBuilder();
        for (byte b : d) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
