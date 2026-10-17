package com.itdct.deepshell.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.itdct.deepshell.service.SshSessionManager;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * 终端 WebSocket：/ws/ssh?connId=1&cols=120&rows=30
 * 文本帧 = JSON 控制消息（data/resize），二进制帧 = 终端输出字节流
 */
@Slf4j
@Component
public class SshWebSocketHandler extends TextWebSocketHandler {

    private final SshSessionManager sessions;
    private final ObjectMapper om = new ObjectMapper();

    public SshWebSocketHandler(SshSessionManager sessions) {
        this.sessions = sessions;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession ws) {
        Long connId = null;
        int cols = 120;
        int rows = 30;
        String clientKey = null;
        try {
            URI uri = ws.getUri();
            String rawConn = UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("connId");
            String rawCols = UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("cols");
            String rawRows = UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("rows");
            clientKey = UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("sid");
            if (rawConn != null) {
                connId = Long.parseLong(rawConn);
            }
            if (rawCols != null) {
                cols = Integer.parseInt(rawCols);
            }
            if (rawRows != null) {
                rows = Integer.parseInt(rawRows);
            }
        } catch (Exception ignore) {
        }
        if (connId == null) {
            sendError(ws, "缺少连接参数");
            closeQuietly(ws);
            return;
        }
        String attachmentId = UUID.randomUUID().toString().replace("-", "");
        try {
            SshSessionManager.OpenResult opened =
                    sessions.openOrAttach(connId, cols, rows, clientKey, attachmentId);
            SshSessionManager.SshSession s = opened.session;
            ws.getAttributes().put("sessionId", s.getId());
            ws.getAttributes().put("attachmentId", attachmentId);
            s.onClosed = reason -> {
                sendText(ws, text("closed", "message", reason));
                closeQuietly(ws);
            };
            s.onStats = stats -> {
                ObjectNode n = om.createObjectNode();
                n.put("type", "stats");
                n.set("data", om.valueToTree(stats));
                sendText(ws, n.toString());
            };
            s.onCwd = cwd -> {
                ObjectNode n = om.createObjectNode();
                n.put("type", "cwd");
                n.put("path", cwd);
                sendText(ws, n.toString());
            };
            ObjectNode open = om.createObjectNode();
            open.put("type", "open");
            open.put("sessionId", s.getId());
            open.put("name", s.getName());
            open.put("reattached", opened.reattached);
            sendText(ws, open.toString());
            // 先发 open，再回放最近输出；客户端收到 open 后会重置终端再写入快照
            s.attach(data -> sendBinary(ws, data), snapshot -> sendBinary(ws, snapshot));
        } catch (Exception e) {
            log.warn("SSH 连接失败: {}", e.toString());
            sendError(ws, friendly(e));
            closeQuietly(ws);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession ws, TextMessage message) {
        Object sid = ws.getAttributes().get("sessionId");
        if (sid == null) {
            return;
        }
        SshSessionManager.SshSession s;
        try {
            s = sessions.get((String) sid);
        } catch (Exception e) {
            return;
        }
        try {
            JsonNode node = om.readTree(message.getPayload());
            String type = node.path("type").asText();
            if ("data".equals(type)) {
                s.write(node.path("data").asText("").getBytes(StandardCharsets.UTF_8));
            } else if ("resize".equals(type)) {
                s.resize(node.path("cols").asInt(120), node.path("rows").asInt(30));
            } else if ("close".equals(type)) {
                Object attachmentId = ws.getAttributes().get("attachmentId");
                if (attachmentId == null || s.isAttachment((String) attachmentId)) {
                    sessions.close((String) sid);
                }
                closeQuietly(ws);
            }
        } catch (Exception e) {
            log.debug("WS 消息处理失败: {}", e.getMessage());
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession ws, CloseStatus status) {
        Object sid = ws.getAttributes().get("sessionId");
        if (sid != null) {
            Object attachmentId = ws.getAttributes().get("attachmentId");
            sessions.detach((String) sid,
                    attachmentId == null ? null : (String) attachmentId);
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
        }
    }

    private void sendText(WebSocketSession ws, String text) {
        try {
            synchronized (ws) {
                if (ws.isOpen()) {
                    ws.sendMessage(new TextMessage(text));
                }
            }
        } catch (Exception ignore) {
        }
    }

    private void sendError(WebSocketSession ws, String msg) {
        sendText(ws, text("error", "message", msg));
    }

    private String text(String type, String key, String value) {
        ObjectNode n = om.createObjectNode();
        n.put("type", type);
        n.put(key, value);
        return n.toString();
    }

    private void closeQuietly(WebSocketSession ws) {
        try {
            ws.close();
        } catch (Exception ignore) {
        }
    }

    private String friendly(Exception e) {
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        String lower = m.toLowerCase();
        if (lower.contains("auth fail")) {
            return "认证失败：请检查用户名、密码或密钥配置";
        }
        if (lower.contains("connection refused")) {
            return "连接被拒绝：目标主机未开启 SSH 服务或端口不正确";
        }
        if (lower.contains("unknownhost") || lower.contains("unknown host")) {
            return "无法解析主机名，请检查地址是否正确";
        }
        if (lower.contains("timeout") || lower.contains("timed out")) {
            return "连接超时：请检查网络连通性与防火墙设置";
        }
        if (lower.contains("privatekey")) {
            return "私钥加载失败：" + m;
        }
        return m;
    }
}
