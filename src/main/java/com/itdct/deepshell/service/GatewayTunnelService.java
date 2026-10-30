package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.entity.GatewayEndpoint;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import javax.websocket.ContainerProvider;
import javax.websocket.WebSocketContainer;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 本地执行网关隧道：在 127.0.0.1 上开一个临时端口，把接进来的 TCP 字节流
 * 通过 WebSocket 转发给远端 DeepShell，由远端拨号到目标 host:port。
 * JSch 直接连这个本地端口，SSH 协议端到端到目标机，因此终端、SFTP、监控、端口转发都能复用。
 */
@Slf4j
@Service
public class GatewayTunnelService {

    private static final int WS_BUFFER_BYTES = 2 * 1024 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int ACCEPT_TIMEOUT_MS = 20000;
    private static final int MAX_PENDING_BYTES = 4 * 1024 * 1024;

    private final GatewayEndpointService gateways;
    private final ObjectMapper om = new ObjectMapper();

    private volatile StandardWebSocketClient secureClient;
    private volatile StandardWebSocketClient insecureClient;

    public GatewayTunnelService(GatewayEndpointService gateways) {
        this.gateways = gateways;
    }

    /**
     * 建立隧道并返回已就绪的本地端口。远端拨号失败会在握手阶段抛出，错误信息直接可展示。
     */
    public Tunnel open(GatewayEndpoint gateway, String targetHost, int targetPort) throws Exception {
        if (gateway == null) {
            throw new IllegalArgumentException("未选择执行网关");
        }
        if (gateway.getEnabled() != null && !gateway.getEnabled()) {
            throw new IllegalStateException("执行网关「" + gateway.getName() + "」已停用");
        }
        String token = gateways.tokenOf(gateway);
        if (token == null || token.trim().isEmpty()) {
            throw new IllegalStateException("执行网关「" + gateway.getName() + "」缺少 Token");
        }
        boolean insecure = gateway.getInsecureTls() != null && gateway.getInsecureTls();
        StandardWebSocketClient client = insecure ? insecureClient() : secureClient();

        ServerSocket listener = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
        listener.setSoTimeout(ACCEPT_TIMEOUT_MS);
        int localPort = listener.getLocalPort();
        TunnelState state = new TunnelState(listener);
        TunnelHandler handler = new TunnelHandler(state);

        WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
        headers.add(GatewaySettingsService.HEADER, token.trim());
        headers.add("X-DeepShell-Gateway-Client", "local");
        WebSocketSession ws;
        try {
            ws = client.doHandshake(handler, headers,
                            GatewayClient.tunnelUri(gateway.getBaseUrl(), targetHost, targetPort))
                    .get(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            state.close();
            throw new IllegalStateException("连接执行网关「" + gateway.getName() + "」失败：" + friendly(e), e);
        }
        state.attachSession(ws);
        try {
            if (!handler.ready.await(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                String failure = handler.failure;
                state.close();
                throw new IllegalStateException(failure == null
                        ? "执行网关未在 " + (CONNECT_TIMEOUT_MS / 1000) + " 秒内就绪"
                        : failure);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            state.close();
            throw new IllegalStateException("等待执行网关就绪被中断");
        }
        if (handler.failure != null) {
            state.close();
            throw new IllegalStateException(handler.failure);
        }

        Thread acceptor = new Thread(() -> {
            try {
                Socket socket = listener.accept();
                socket.setTcpNoDelay(true);
                socket.setKeepAlive(true);
                state.acceptPeer(socket);
            } catch (SocketTimeoutException e) {
                state.close();
            } catch (Exception e) {
                state.close();
            }
        }, "gateway-tunnel-accept-" + localPort);
        acceptor.setDaemon(true);
        state.bindAcceptor(acceptor);
        acceptor.start();
        log.info("执行网关隧道已就绪: {} -> {}:{} (local 127.0.0.1:{})",
                gateway.getName(), targetHost, targetPort, localPort);
        return new Tunnel(localPort, state);
    }

    private StandardWebSocketClient secureClient() {
        StandardWebSocketClient c = secureClient;
        if (c == null) {
            synchronized (this) {
                if (secureClient == null) {
                    secureClient = newClient(false);
                }
                c = secureClient;
            }
        }
        return c;
    }

    private StandardWebSocketClient insecureClient() {
        StandardWebSocketClient c = insecureClient;
        if (c == null) {
            synchronized (this) {
                if (insecureClient == null) {
                    insecureClient = newClient(true);
                }
                c = insecureClient;
            }
        }
        return c;
    }

    private static WebSocketContainer newContainer() {
        WebSocketContainer container = ContainerProvider.getWebSocketContainer();
        container.setDefaultMaxBinaryMessageBufferSize(WS_BUFFER_BYTES);
        container.setDefaultMaxTextMessageBufferSize(WS_BUFFER_BYTES);
        return container;
    }

    private static StandardWebSocketClient newClient(boolean insecureTls) {
        StandardWebSocketClient client = new StandardWebSocketClient(newContainer());
        Map<String, Object> props = new HashMap<>();
        props.put("org.apache.tomcat.websocket.IO_TIMEOUT_MS", String.valueOf(CONNECT_TIMEOUT_MS));
        props.put("org.apache.tomcat.websocket.BLOCKING_SEND_TIMEOUT", String.valueOf(CONNECT_TIMEOUT_MS));
        if (insecureTls) {
            try {
                props.put("org.apache.tomcat.websocket.SSL_CONTEXT", GatewayClient.insecureSslContext());
            } catch (Exception e) {
                throw new IllegalStateException("初始化自签证书信任失败：" + e.getMessage(), e);
            }
        }
        client.setUserProperties(props);
        return client;
    }

    public final class Tunnel implements AutoCloseable {
        private final int localPort;
        private final TunnelState state;

        Tunnel(int localPort, TunnelState state) {
            this.localPort = localPort;
            this.state = state;
        }

        public int localPort() {
            return localPort;
        }

        @Override
        public void close() {
            state.close();
        }
    }

    private final class TunnelHandler extends AbstractWebSocketHandler {
        private final TunnelState state;
        final CountDownLatch ready = new CountDownLatch(1);
        volatile String failure;

        TunnelHandler(TunnelState state) {
            this.state = state;
        }

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            String type;
            String error = null;
            try {
                com.fasterxml.jackson.databind.JsonNode node = om.readTree(message.getPayload());
                type = node.path("type").asText("");
                error = node.path("message").asText("执行网关拒绝了连接");
            } catch (Exception e) {
                return;
            }
            if ("ready".equals(type)) {
                ready.countDown();
            } else if ("error".equals(type)) {
                failure = error;
                fail();
            } else if ("eof".equals(type)) {
                state.closePeer();
            }
        }

        @Override
        protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
            ByteBuffer payload = message.getPayload();
            byte[] data = new byte[payload.remaining()];
            payload.get(data);
            state.toPeer(data);
        }

        @Override
        public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
            failWith("执行网关连接已关闭" + (status == null ? "" : "：" + status));
        }

        @Override
        public void handleTransportError(WebSocketSession session, Throwable exception) {
            failWith("执行网关连接中断：" + friendly(exception));
        }

        private void failWith(String message) {
            if (failure == null) {
                failure = message;
            }
            fail();
        }

        private void fail() {
            ready.countDown();
            state.closePeer();
        }
    }

    /** 隧道共享状态：WebSocket 会话、目标侧 socket、待发送缓冲与关闭动作。 */
    private final class TunnelState {
        private final ServerSocket listener;
        private final AtomicReference<WebSocketSession> session = new AtomicReference<>();
        private final AtomicReference<Socket> peer = new AtomicReference<>();
        private final AtomicBoolean closed = new AtomicBoolean();
        private final ByteArrayOutputStream pending = new ByteArrayOutputStream();
        private final Object lock = new Object();
        private volatile Thread acceptor;
        private volatile Thread pump;
        private volatile OutputStream peerOut;

        TunnelState(ServerSocket listener) {
            this.listener = listener;
        }

        void attachSession(WebSocketSession ws) {
            session.set(ws);
        }

        void bindAcceptor(Thread thread) {
            this.acceptor = thread;
        }

        void acceptPeer(Socket socket) {
            if (closed.get()) {
                closeQuietly(socket);
                return;
            }
            try {
                peerOut = socket.getOutputStream();
            } catch (Exception e) {
                closeQuietly(socket);
                close();
                return;
            }
            peer.set(socket);
            synchronized (lock) {
                try {
                    if (pending.size() > 0) {
                        peerOut.write(pending.toByteArray());
                        peerOut.flush();
                        pending.reset();
                    }
                } catch (Exception e) {
                    // 写入失败按连接关闭处理
                }
            }
            Thread t = new Thread(() -> pumpFromPeer(socket), "gateway-tunnel-peer-" + socket.getPort());
            t.setDaemon(true);
            pump = t;
            t.start();
        }

        private void pumpFromPeer(Socket socket) {
            try {
                InputStream in = socket.getInputStream();
                byte[] buf = new byte[32768];
                int n;
                while ((n = in.read(buf)) != -1) {
                    WebSocketSession ws = session.get();
                    if (ws == null || !ws.isOpen()) {
                        break;
                    }
                    byte[] data = Arrays.copyOf(buf, n);
                    synchronized (ws) {
                        ws.sendMessage(new BinaryMessage(data));
                    }
                }
            } catch (Exception e) {
                // 本地 JSch 断开或网关中断
            } finally {
                closePeer();
                close();
            }
        }

        void toPeer(byte[] data) {
            if (closed.get() || data == null || data.length == 0) {
                return;
            }
            synchronized (lock) {
                OutputStream out = peerOut;
                if (out == null) {
                    if (pending.size() + data.length > MAX_PENDING_BYTES) {
                        return;
                    }
                    pending.write(data, 0, data.length);
                    return;
                }
                try {
                    out.write(data);
                    out.flush();
                } catch (Exception e) {
                    closePeer();
                    close();
                }
            }
        }

        void closePeer() {
            Socket s = peer.getAndSet(null);
            if (s != null) {
                closeQuietly(s);
            }
        }

        void close() {
            if (!closed.compareAndSet(false, true)) {
                return;
            }
            WebSocketSession ws = session.get();
            if (ws != null && ws.isOpen()) {
                try {
                    synchronized (ws) {
                        ws.sendMessage(new TextMessage("{\"type\":\"close\"}"));
                    }
                } catch (Exception ignore) {
                    // 忽略
                }
                try {
                    ws.close(CloseStatus.NORMAL);
                } catch (Exception ignore) {
                    // 忽略
                }
            }
            closePeer();
            try {
                listener.close();
            } catch (Exception ignore) {
                // 忽略
            }
            Thread t = acceptor;
            if (t != null) {
                t.interrupt();
            }
            Thread p = pump;
            if (p != null) {
                p.interrupt();
            }
        }
    }

    private static String friendly(Throwable e) {
        Throwable cause = e;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        String message = cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage();
        String lower = message.toLowerCase();
        if (lower.contains("401") || lower.contains("unauthorized")) {
            return "网关 Token 无效";
        }
        if (lower.contains("403") || lower.contains("forbidden")) {
            return "对方 DeepShell 未启用执行网关，或拒绝了这个目标";
        }
        if (lower.contains("refused")) {
            return "网关地址未监听或拒绝连接";
        }
        if (lower.contains("timeout") || lower.contains("timed out")) {
            return "连接网关超时";
        }
        if (lower.contains("ssl") || lower.contains("handshake")) {
            return "网关 HTTPS 证书校验失败；自签证书请勾选「跳过证书校验」";
        }
        return message;
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (Exception ignore) {
            // 忽略
        }
    }
}
