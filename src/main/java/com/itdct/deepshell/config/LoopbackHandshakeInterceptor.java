package com.itdct.deepshell.config;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.Locale;
import java.util.Map;

/** 本地终端只能从本机回环访问，并校验浏览器 Origin，避免任意网页连上本机 Shell。 */
@Component
public class LoopbackHandshakeInterceptor implements HandshakeInterceptor {

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        if (isLoopback(request) && originAllowed(request)) {
            return true;
        }
        response.setStatusCode(HttpStatus.FORBIDDEN);
        return false;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // 无需处理
    }

    private static boolean isLoopback(ServerHttpRequest request) {
        try {
            InetSocketAddress remote = request.getRemoteAddress();
            if (remote == null) {
                return false;
            }
            InetAddress address = remote.getAddress();
            return address != null && address.isLoopbackAddress();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * WebSocket 不受 CORS 限制，必须显式校验 Origin：
     * 允许 DeepShell 自身页面（主机为回环、端口为当前服务端口）；无 Origin 的本机客户端（如桌面协议启动器）放行。
     */
    private static boolean originAllowed(ServerHttpRequest request) {
        try {
            String origin = request.getHeaders().getFirst(HttpHeaders.ORIGIN);
            if (origin == null || origin.trim().isEmpty() || "null".equalsIgnoreCase(origin.trim())) {
                return origin == null || origin.trim().isEmpty();
            }
            URI uri = URI.create(origin.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!"http".equals(scheme) && !"https".equals(scheme)) {
                return false;
            }
            String host = uri.getHost();
            if (host != null && host.startsWith("[") && host.endsWith("]")) {
                host = host.substring(1, host.length() - 1);
            }
            if (host == null || !InetAddress.getByName(host).isLoopbackAddress()) {
                return false;
            }
            int localPort = request.getLocalAddress() == null
                    ? -1 : request.getLocalAddress().getPort();
            int originPort = uri.getPort();
            if (originPort < 0) {
                originPort = "https".equals(scheme) ? 443 : 80;
            }
            return localPort <= 0 || originPort == localPort;
        } catch (Exception e) {
            return false;
        }
    }
}
