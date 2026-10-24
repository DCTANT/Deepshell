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
import java.util.Locale;
import java.util.Map;

/**
 * 工作台事件 / SSH 终端 WebSocket 的同源校验：允许无 Origin 的非浏览器客户端，
 * 浏览器只允许与当前 Host（主机 + 端口）同源的页面连接，避免任意网页窃听事件或直连本机 SSH。
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
            String scheme = originUri.getScheme() == null
                    ? "" : originUri.getScheme().toLowerCase(Locale.ROOT);
            if (!"http".equals(scheme) && !"https".equals(scheme)) {
                return false;
            }
            String originHost = normalizeHost(originUri.getHost());
            if (originHost == null) {
                return false;
            }
            int originPort = originUri.getPort() < 0
                    ? ("https".equals(scheme) ? 443 : 80) : originUri.getPort();
            int defaultPort = "https".equals(scheme) ? 443 : 80;
            String hostHeader = request.getHeaders().getFirst(HttpHeaders.HOST);
            if (hostMatches(hostHeader, originHost, originPort, defaultPort)) {
                return true;
            }
            String forwarded = request.getHeaders().getFirst("X-Forwarded-Host");
            if (forwarded != null && !forwarded.trim().isEmpty()) {
                return hostMatches(forwarded.split(",")[0].trim(), originHost, originPort, defaultPort);
            }
            InetSocketAddress local = request.getLocalAddress();
            if (local == null) {
                return false;
            }
            String requestHost = normalizeHost(local.getHostString());
            return requestHost != null && originHost.equalsIgnoreCase(requestHost)
                    && local.getPort() == originPort;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean hostMatches(String hostHeader, String originHost, int originPort,
                                       int defaultPort) {
        if (hostHeader == null || hostHeader.trim().isEmpty()) {
            return false;
        }
        URI hostUri = URI.create("http://" + hostHeader.trim());
        String requestHost = normalizeHost(hostUri.getHost());
        int requestPort = hostUri.getPort() < 0 ? defaultPort : hostUri.getPort();
        return requestHost != null && originHost.equalsIgnoreCase(requestHost)
                && originPort == requestPort;
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
