package com.itdct.deepshell.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.GatewaySettingsService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 执行网关隧道：/ws/gateway/tunnel?target=host:port
 * 握手校验网关 Token 与目标白名单后，向目标 TCP 端口拨号；二进制帧原样写入 socket，
 * socket 输出以二进制帧回传。本地 DeepShell 用它把整条 SSH 协议透传到目标机。
 */
@Slf4j
@Component
public class GatewayTunnelWebSocketHandler extends TextWebSocketHandler {

    private static final String ATTR_TUNNEL = "gatewayTunnel";
    private static final int CONNECT_TIMEOUT_MS = 10000;

    private final GatewaySettingsService settings;
    private final AuditService audit;
    private final ObjectMapper om = new ObjectMapper();

    public GatewayTunnelWebSocketHandler(GatewaySettingsService settings, AuditService audit) {
        this.settings = settings;
        this.audit = audit;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession ws) {
        String host;
        int port;
        try {
            String hostParam = decode(query(ws, "host"));
            String portParam = decode(query(ws, "port"));
            if (hostParam != null && !hostParam.trim().isEmpty()
                    && portParam != null && !portParam.trim().isEmpty()) {
                host = hostParam.trim();
                port = Integer.parseInt(portParam.trim());
            } else {
                String target = decode(query(ws, "target"));
                if (target == null || target.trim().isEmpty()) {
                    throw new IllegalArgumentException("缺少 host / port 参数");
                }
                int split = target.lastIndexOf(':');
                if (split <= 0 || split == target.length() - 1) {
                    throw new IllegalArgumentException("target 需为 host:port");
                }
                host = target.substring(0, split).trim();
                port = Integer.parseInt(target.substring(split + 1).trim());
            }
            if (host.startsWith("[") && host.endsWith("]")) {
                host = host.substring(1, host.length() - 1);
            }
        } catch (Exception e) {
            reject(ws, "参数错误：" + e.getMessage());
            return;
        }

        String clientIp = clientIp(ws);
        if (!settings.isTargetAllowed(host, port)) {
            audit.record("GATEWAY_TUNNEL", host + ":" + port, "FAIL", "目标不在白名单，来源 " + clientIp);
            reject(ws, "目标不在网关白名单内：" + host + ":" + port);
            return;
        }
        if (settings.activeTunnels() >= settings.maxConnections()) {
            audit.record("GATEWAY_TUNNEL", host + ":" + port, "FAIL", "并发连接已达上限，来源 " + clientIp);
            reject(ws, "网关并发连接已达上限（" + settings.maxConnections() + "）");
            return;
        }

        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            socket.setTcpNoDelay(true);
            socket.setKeepAlive(true);
            log.info("网关隧道已建立: {}:{} -> {} (client={})", host, port, ws.getId(), clientIp);
            audit.record("GATEWAY_TUNNEL", host + ":" + port, "OK", "来源 " + clientIp);
        } catch (Exception e) {
            closeQuietly(socket);
            audit.record("GATEWAY_TUNNEL", host + ":" + port, "FAIL", "拨号失败: " + e.getMessage());
            reject(ws, "网关无法连接目标 " + host + ":" + port + "：" + friendly(e));
            return;
        }

        Tunnel tunnel;
        try {
            tunnel = new Tunnel(ws, socket);
        } catch (Exception e) {
            closeQuietly(socket);
            reject(ws, "读取目标连接失败：" + e.getMessage());
            return;
        }
        ws.getAttributes().put(ATTR_TUNNEL, tunnel);
        settings.tunnelOpened();
        sendText(ws, "{\"type\":\"ready\",\"target\":" + quote(host + ":" + port) + "}");
        Thread reader = new Thread(() -> pumpOutput(tunnel), "gateway-tunnel-" + ws.getId());
        reader.setDaemon(true);
        reader.start();
    }

    private void pumpOutput(Tunnel tunnel) {
        WebSocketSession ws = tunnel.ws;
        try {
            InputStream in = tunnel.socket.getInputStream();
            byte[] buf = new byte[32768];
            int n;
            while ((n = in.read(buf)) != -1) {
                sendBinary(ws, Arrays.copyOf(buf, n));
            }
            sendText(ws, "{\"type\":\"eof\"}");
        } catch (Exception e) {
            if (ws.isOpen()) {
                ObjectNode err = om.createObjectNode();
                err.put("type", "error");
                err.put("message", "目标连接中断：" + friendly(e));
                sendText(ws, err.toString());
            }
        } finally {
            tunnel.close();
            closeQuietly(ws);
        }
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession ws, BinaryMessage message) {
        Tunnel tunnel = tunnel(ws);
        if (tunnel == null) {
            return;
        }
        ByteBuffer payload = message.getPayload();
        byte[] data = new byte[payload.remaining()];
        payload.get(data);
        try {
            tunnel.write(data);
        } catch (Exception e) {
            tunnel.close();
            closeQuietly(ws);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession ws, TextMessage message) {
        Tunnel tunnel = tunnel(ws);
        if (tunnel == null) {
            return;
        }
        String type;
        try {
            type = om.readTree(message.getPayload()).path("type").asText("");
        } catch (Exception e) {
            return;
        }
        if ("close".equals(type)) {
            tunnel.close();
            closeQuietly(ws);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession ws, CloseStatus status) {
        Tunnel tunnel = tunnel(ws);
        if (tunnel != null) {
            tunnel.close();
            log.info("网关隧道已关闭: {} status={}", ws.getId(), status);
        }
        ws.getAttributes().remove(ATTR_TUNNEL);
    }

    @Override
    public void handleTransportError(WebSocketSession ws, Throwable exception) {
        Tunnel tunnel = tunnel(ws);
        if (tunnel != null) {
            tunnel.close();
        }
        closeQuietly(ws);
    }

    private static Tunnel tunnel(WebSocketSession ws) {
        Object v = ws.getAttributes().get(ATTR_TUNNEL);
        return v instanceof Tunnel ? (Tunnel) v : null;
    }

    private static String query(WebSocketSession ws, String name) {
        try {
            return UriComponentsBuilder.fromUri(ws.getUri()).build().getQueryParams().getFirst(name);
        } catch (Exception e) {
            return null;
        }
    }

    private static String decode(String value) {
        if (value == null) {
            return null;
        }
        try {
            return java.net.URLDecoder.decode(value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
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
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        String lower = m.toLowerCase();
        if (lower.contains("refused")) {
            return "目标端口未开放";
        }
        if (lower.contains("timeout") || lower.contains("timed out")) {
            return "连接超时";
        }
        if (lower.contains("unknownhost") || lower.contains("unresolved")) {
            return "无法解析目标地址";
        }
        return m;
    }

    private static String quote(String v) {
        return "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private void reject(WebSocketSession ws, String message) {
        ObjectNode n = om.createObjectNode();
        n.put("type", "error");
        n.put("message", message);
        sendText(ws, n.toString());
        closeQuietly(ws);
    }

    private void sendBinary(WebSocketSession ws, byte[] data) {
        try {
            synchronized (ws) {
                if (ws.isOpen()) {
                    ws.sendMessage(new BinaryMessage(data));
                }
            }
        } catch (Exception ignore) {
            // 连接已断开，读线程随 socket 关闭退出
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
            // 忽略发送失败
        }
    }

    private static void closeQuietly(WebSocketSession ws) {
        try {
            ws.close();
        } catch (Exception ignore) {
            // 忽略
        }
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (Exception ignore) {
            // 忽略
        }
    }

    private final class Tunnel {
        final WebSocketSession ws;
        final Socket socket;
        private final OutputStream out;
        private final AtomicBoolean closed = new AtomicBoolean();

        Tunnel(WebSocketSession ws, Socket socket) {
            this.ws = ws;
            this.socket = socket;
            try {
                this.out = socket.getOutputStream();
            } catch (Exception e) {
                throw new IllegalStateException("读取目标连接失败", e);
            }
        }

        void write(byte[] data) throws Exception {
            synchronized (this) {
                if (closed.get()) {
                    return;
                }
                out.write(data);
                out.flush();
            }
        }

        void close() {
            if (!closed.compareAndSet(false, true)) {
                return;
            }
            settings.tunnelClosed();
            closeQuietly(socket);
        }
    }
}
