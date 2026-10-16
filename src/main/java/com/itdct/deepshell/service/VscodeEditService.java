package com.itdct.deepshell.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * VSCode 联动编辑：远端文件下载到本地编辑目录并用 VSCode 打开，
 * 监听本地保存事件防抖后自动上传回服务器（会话断开自动停止监听）。
 */
@Slf4j
@Service
public class VscodeEditService {

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
        volatile long lastUploadAt;
    }

    public Map<String, Object> open(String sessionId, String remotePath) throws Exception {
        sessions.get(sessionId);
        String hash = sha1(remotePath).substring(0, 8);
        Path dir = Paths.get(System.getProperty("user.home"), ".deepshell", "edit", sessionId, hash);
        Files.createDirectories(dir);
        Path local = dir.resolve(safeFileName(remotePath));

        boolean existed = Files.exists(local);
        if (!existed) {
            try (OutputStream out = Files.newOutputStream(local,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
                sftpService.download(sessionId, remotePath, out);
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

    private void startWatchIfAbsent(String sessionId, String remotePath, Path local) {
        String key = local.toString();
        if (watches.containsKey(key)) {
            return;
        }
        WatchRec rec = new WatchRec();
        rec.sessionId = sessionId;
        rec.remotePath = remotePath;
        rec.localPath = local;
        watches.put(key, rec);
        Thread t = new Thread(() -> watchLoop(rec), "vscode-sync-" + local.getFileName());
        t.setDaemon(true);
        t.start();
        log.info("开始监听 VSCode 本地副本: {}", local);
    }

    private void watchLoop(WatchRec rec) {
        Path dir = rec.localPath.getParent();
        try (WatchService ws = FileSystems.getDefault().newWatchService()) {
            dir.register(ws, StandardWatchEventKinds.ENTRY_CREATE, StandardWatchEventKinds.ENTRY_MODIFY);
            String name = rec.localPath.getFileName().toString();
            while (true) {
                WatchKey key = ws.poll(20, TimeUnit.SECONDS);
                if (!sessions.exists(rec.sessionId)) {
                    log.info("会话已关闭，停止 VSCode 文件监听: {}", rec.localPath);
                    break;
                }
                if (key == null) {
                    continue;
                }
                boolean touched = false;
                for (WatchEvent<?> ev : key.pollEvents()) {
                    Object ctx = ev.context();
                    if (ctx != null && name.equals(ctx.toString())) {
                        touched = true;
                    }
                }
                key.reset();
                if (!touched) {
                    continue;
                }
                // 编辑器保存可能触发多次事件，防抖合并
                Thread.sleep(700);
                if (System.currentTimeMillis() - rec.lastUploadAt < 500) {
                    continue;
                }
                try {
                    byte[] data = Files.readAllBytes(rec.localPath);
                    sftpService.putBytes(rec.sessionId, rec.remotePath, data);
                    rec.lastUploadAt = System.currentTimeMillis();
                    log.info("VSCode 保存已同步回服务器: {} -> {}", rec.localPath.getFileName(), rec.remotePath);
                } catch (Exception e) {
                    log.warn("VSCode 保存同步失败: {}", e.getMessage());
                }
            }
        } catch (Exception e) {
            log.warn("VSCode 文件监听退出: {}", e.getMessage());
        } finally {
            watches.remove(rec.localPath.toString());
        }
    }

    private void launchVscode(Path file) throws IOException {
        boolean win = System.getProperty("os.name").toLowerCase().contains("win");
        List<String> cmd = win
                ? Arrays.asList("cmd", "/c", vscodeCommand, file.toString())
                : Arrays.asList(vscodeCommand, file.toString());
        Process p;
        try {
            p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        } catch (IOException e) {
            throw new IOException("未找到 VSCode 命令（" + vscodeCommand
                    + "），请先安装 VSCode 并执行 'Shell Command: Install code command'，或在配置中指定 deepshell.vscode-command 完整路径");
        }
        try {
            if (!p.waitFor(15, TimeUnit.SECONDS)) {
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
        String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        return safe.isEmpty() ? "file" : safe;
    }

    private static String sha1(String s) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : d) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
