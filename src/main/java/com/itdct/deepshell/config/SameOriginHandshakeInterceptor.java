package com.itdct.deepshell.config;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.net.InetSocketAddress;
import java.net.URI;
import java.util.Map;

/**
 * 工作台事件 WebSocket 的同源校验：允许无 Origin 的非浏览器客户端，
 * 浏览器只允许与当前 Host 同主机的页面连接，避免任意网页窃听连接打开事件。
 */
@Component
public class SameOriginHandshakeInterceptor implements HandshakeInterceptor {

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        if (originAllowed(request)) {
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

    private static boolean originAllowed(ServerHttpRequest request) {
        try {
            String origin = request.getHeaders().getFirst(HttpHeaders.ORIGIN);
            if (origin == null || origin.trim().isEmpty()) {
                return true;
            }
            if ("null".equalsIgnoreCase(origin.trim())) {
                return false;
            }
            URI originUri = URI.create(origin.trim());
            String originHost = normalizeHost(originUri.getHost());
            if (originHost == null) {
                return false;
            }
            String hostHeader = request.getHeaders().getFirst(HttpHeaders.HOST);
            if (hostHeader != null && !hostHeader.trim().isEmpty()) {
                URI hostUri = URI.create("http://" + hostHeader.trim());
                String requestHost = normalizeHost(hostUri.getHost());
                return requestHost != null && originHost.equalsIgnoreCase(requestHost);
            }
            InetSocketAddress local = request.getLocalAddress();
            return local != null && originHost.equalsIgnoreCase(normalizeHost(local.getHostString()));
        } catch (Exception e) {
            return false;
        }
    }

    private static String normalizeHost(String host) {
        if (host == null) {
            return null;
        }
        String value = host.trim();
        if (value.startsWith("[") && value.endsWith("]")) {
            value = value.substring(1, value.length() - 1);
        }
        return value.isEmpty() ? null : value;
    }
}
