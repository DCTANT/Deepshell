package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * 终端手动命令审计：写入审计库（可在「审计日志」中筛选）并追加到数据目录
 * logs/terminal-commands.log。AI 命令由 AI_COMMAND 负责，这里只处理终端通道。
 */
@Slf4j
@Service
public class TerminalAuditService {

    private static final int MAX_DB_COMMAND = 1800;
    private static final int MAX_FILE_COMMAND = 8000;
    private static final long MAX_LOG_BYTES = 5L * 1024 * 1024;

    private final AuditService audit;
    private final AuthService auth;

    public TerminalAuditService(AuditService audit, AuthService auth) {
        this.audit = audit;
        this.auth = auth;
    }

    /**
     * @param connectionName SSH 连接名称；本地终端传 null
     * @param connectionId   SSH 连接 ID；本地终端传 null
     * @param clientIp       WebSocket 对端地址
     */
    public void recordCommand(String connectionName, Long connectionId, String command,
                              String clientIp, boolean local) {
        String text = sanitize(command);
        if (text.isEmpty()) {
            return;
        }
        String username = auth.isEnabled() ? auth.getUsername() : "local";
        String target = local ? "本地终端"
                : (connectionName == null || connectionName.trim().isEmpty()
                ? ("连接 #" + connectionId) : connectionName.trim());
        String detail = (local ? "本地 Shell" : "连接 #" + connectionId) + " | " + truncate(text, MAX_DB_COMMAND);
        audit.record("TERMINAL_COMMAND", target, "OK", detail, username, normalizeIp(clientIp));
        appendFile(username, normalizeIp(clientIp), target, truncate(text, MAX_FILE_COMMAND));
    }

    private synchronized void appendFile(String username, String ip, String target, String command) {
        Path file = DataDir.root().resolve("logs").resolve("terminal-commands.log");
        try {
            Files.createDirectories(file.getParent());
            if (Files.isRegularFile(file) && Files.size(file) > MAX_LOG_BYTES) {
                Path old = file.resolveSibling(file.getFileName() + ".1");
                Files.deleteIfExists(old);
                Files.move(file, old, StandardCopyOption.REPLACE_EXISTING);
            }
            String time = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());
            String line = time + " | " + username + " | " + ip + " | " + target
                    + " | " + command + System.lineSeparator();
            Files.write(file, line.getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND, StandardOpenOption.WRITE);
        } catch (Exception e) {
            log.warn("写入终端命令日志失败: {}", e.getMessage());
        }
    }

    private static String sanitize(String command) {
        if (command == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(command.length());
        for (int i = 0; i < command.length(); i++) {
            char c = command.charAt(i);
            if (c == '\r' || c == '\n' || c == '\t') {
                sb.append(' ');
            } else if (!Character.isISOControl(c)) {
                sb.append(c);
            }
        }
        return sb.toString().trim();
    }

    private static String normalizeIp(String ip) {
        if (ip == null || ip.trim().isEmpty()) {
            return "system";
        }
        String value = ip.trim();
        if ("0:0:0:0:0:0:0:1".equals(value) || "::1".equals(value)) {
            return "127.0.0.1";
        }
        if (value.startsWith("::ffff:")) {
            return value.substring(7);
        }
        return value;
    }

    private static String truncate(String value, int max) {
        if (value.length() <= max) {
            return value;
        }
        return value.substring(0, max - 1) + "…";
    }
}
