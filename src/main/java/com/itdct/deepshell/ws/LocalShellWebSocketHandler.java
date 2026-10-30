package com.itdct.deepshell.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.itdct.deepshell.service.LocalShellService;
import com.itdct.deepshell.service.TerminalAuditService;
import com.itdct.deepshell.service.TerminalCommandTracker;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 本地桌面终端：/ws/local-shell?cols=120&rows=30&shell=powershell。
 * 每个 WebSocket 对应一个本机 Shell 进程；支持选择 cmd / Windows PowerShell / PowerShell 7。
 * 输出按系统控制台编码解码后以 UTF-8 二进制帧发送。仅回环 + 登录校验（由握手拦截器完成），
 * 不会向局域网用户暴露本机 Shell。
 */
@Slf4j
@Component
public class LocalShellWebSocketHandler extends TextWebSocketHandler {

    private final LocalShellService localShell;
    private final TerminalAuditService terminalAudit;
    private final ObjectMapper om = new ObjectMapper();

    public LocalShellWebSocketHandler(LocalShellService localShell, TerminalAuditService terminalAudit) {
        this.localShell = localShell;
        this.terminalAudit = terminalAudit;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession ws) {
        int cols = 120;
        int rows = 30;
        String shellId = "";
        try {
            URI uri = ws.getUri();
            String rawCols = UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("cols");
            String rawRows = UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("rows");
            String rawShell = UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("shell");
            if (rawCols != null) {
                cols = Integer.parseInt(rawCols);
            }
            if (rawRows != null) {
                rows = Integer.parseInt(rawRows);
            }
            if (rawShell != null) {
                shellId = rawShell;
            }
        } catch (Exception ignore) {
            // 使用默认尺寸 / 默认 Shell
        }
        String sessionId = UUID.randomUUID().toString().replace("-", "");
        ws.getAttributes().put("localShellSessionId", sessionId);
        ws.getAttributes().put("cmdTracker", new TerminalCommandTracker());
        ws.getAttributes().put("clientIp", clientIp(ws));
        try {
            LocalShellService.ShellProcess shell = localShell.start(cols, rows, shellId);
            ws.getAttributes().put("localShell", shell);
            ObjectNode open = om.createObjectNode();
            open.put("type", "open");
            open.put("sessionId", sessionId);
            open.put("name", "本地 Shell · " + shell.getShellName());
            open.put("shell", shell.getShellId());
            open.put("shellName", shell.getShellName());
            open.put("pty", shell.isPty());
            sendText(ws, open.toString());
            startReader(ws, shell);
        } catch (Exception e) {
            log.warn("启动本地终端失败: {}", e.getMessage());
            sendError(ws, friendly(e));
            closeQuietly(ws);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession ws, TextMessage message) {
        Object raw = ws.getAttributes().get("localShell");
        if (!(raw instanceof LocalShellService.ShellProcess)) {
            return;
        }
        LocalShellService.ShellProcess shell = (LocalShellService.ShellProcess) raw;
        try {
            JsonNode node = om.readTree(message.getPayload());
            String type = node.path("type").asText();
            if ("data".equals(type)) {
                String data = node.path("data").asText("");
                if (!shell.isPty()) {
                    // cmd / 普通管道需要 LF；PTY 保留 CR 由终端驱动处理
                    data = data.replace("\r\n", "\n").replace('\r', '\n');
                }
                OutputStream in = shell.getProcess().getOutputStream();
                in.write(data.getBytes(shell.getCharset()));
                in.flush();
                auditInput(ws, node, data);
            } else if ("resize".equals(type)) {
                shell.resize(node.path("cols").asInt(120), node.path("rows").asInt(30));
            } else if ("close".equals(type)) {
                closeQuietly(ws);
            }
        } catch (Exception e) {
            log.debug("本地终端消息处理失败: {}", e.getMessage());
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession ws, CloseStatus status) {
        Object raw = ws.getAttributes().get("localShell");
        if (raw instanceof LocalShellService.ShellProcess) {
            Process process = ((LocalShellService.ShellProcess) raw).getProcess();
            process.destroy();
            try {
                if (!process.waitFor(1200, TimeUnit.MILLISECONDS)) {
                    process.destroyForcibly();
                }
            } catch (Exception ignore) {
                process.destroyForcibly();
            }
        }
        ws.getAttributes().remove("localShell");
        ws.getAttributes().remove("cmdTracker");
    }

    private void startReader(final WebSocketSession ws, final LocalShellService.ShellProcess shell) {
        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                try (Reader reader = new InputStreamReader(
                        shell.getProcess().getInputStream(), shell.getCharset())) {
                    char[] buffer = new char[4096];
                    int read;
                    while ((read = reader.read(buffer)) >= 0) {
                        if (read == 0) {
                            continue;
                        }
                        String text = new String(buffer, 0, read);
                        sendBinary(ws, text.getBytes(StandardCharsets.UTF_8));
                    }
                } catch (Exception e) {
                    if (ws.isOpen()) {
                        sendText(ws, text("error", "message", "本地终端读取失败：" + e.getMessage()));
                    }
                } finally {
                    Integer exit = null;
                    try {
                        if (shell.getProcess().waitFor(800, TimeUnit.MILLISECONDS)) {
                            exit = shell.getProcess().exitValue();
                        }
                    } catch (Exception ignore) {
                        // 进程信息不可用时只发送关闭提示
                    }
                    if (ws.isOpen()) {
                        ObjectNode n = om.createObjectNode();
                        n.put("type", "closed");
                        n.put("message", exit == null
                                ? "本地 Shell 已退出"
                                : "本地 Shell 已退出（退出码 " + exit + "）");
                        sendText(ws, n.toString());
                        closeQuietly(ws);
                    }
                }
            }
        }, "local-shell-" + ws.getId());
        thread.setDaemon(true);
        thread.start();
    }

    /** 与 SSH 终端一致的审计规则：打字行由前端附带，整段发送由后端按行识别。 */
    private void auditInput(WebSocketSession ws, JsonNode node, String data) {
        Object raw = ws.getAttributes().get("cmdTracker");
        if (!(raw instanceof TerminalCommandTracker)) {
            return;
        }
        TerminalCommandTracker tracker = (TerminalCommandTracker) raw;
        boolean auditEnabled = !node.has("audit") || node.path("audit").asBoolean(true);
        if (!auditEnabled) {
            tracker.reset();
            return;
        }
        String clientIp = String.valueOf(ws.getAttributes().get("clientIp"));
        boolean typed = node.path("auditTyped").asBoolean(false);
        if (typed) {
            if (node.path("auditSkip").asBoolean(false)) {
                tracker.reset();
                return;
            }
            java.util.List<String> commands = tracker.feed(data);
            String line = node.has("auditLine") ? node.path("auditLine").asText("").trim() : "";
            if (!line.isEmpty()) {
                tracker.reset();
                terminalAudit.recordCommand(null, null, line, clientIp, true);
            } else {
                for (String command : commands) {
                    terminalAudit.recordCommand(null, null, command, clientIp, true);
                }
            }
            return;
        }
        if (node.path("auditSkip").asBoolean(false)) {
            tracker.reset();
            return;
        }
        for (String command : tracker.feed(data)) {
            terminalAudit.recordCommand(null, null, command, clientIp, true);
        }
    }

    private void sendBinary(WebSocketSession ws, byte[] data) {
        try {
            synchronized (ws) {
                if (ws.isOpen()) {
                    ws.sendMessage(new BinaryMessage(data));
                }
            }
        } catch (Exception ignore) {
            // 浏览器已关闭
        }
    }

    private void sendText(WebSocketSession ws, String message) {
        try {
            synchronized (ws) {
                if (ws.isOpen()) {
                    ws.sendMessage(new TextMessage(message));
                }
            }
        } catch (Exception ignore) {
            // 浏览器已关闭
        }
    }

    private void sendError(WebSocketSession ws, String message) {
        sendText(ws, text("error", "message", message));
    }

    private String text(String type, String key, String value) {
        ObjectNode n = om.createObjectNode();
        n.put("type", type);
        n.put(key, value);
        return n.toString();
    }

    private static String clientIp(WebSocketSession ws) {
        try {
            if (ws.getRemoteAddress() instanceof InetSocketAddress) {
                InetAddress address = ((InetSocketAddress) ws.getRemoteAddress()).getAddress();
                if (address != null) {
                    return address.getHostAddress();
                }
            }
        } catch (Exception ignore) {
            // 回退到地址字符串
        }
        return String.valueOf(ws.getRemoteAddress());
    }

    private static String friendly(Exception e) {
        String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        return "启动本机 Shell 失败：" + message;
    }

    private void closeQuietly(WebSocketSession ws) {
        try {
            ws.close();
        } catch (Exception ignore) {
            // ignore
        }
    }
}
