package com.itdct.deepshell.config;

import com.itdct.deepshell.service.GatewaySettingsService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.Map;

/**
 * 执行网关隧道握手：只接受携带网关 Token 的服务端客户端。
 * 浏览器一律拒绝（发送 Origin），避免页面通过同源 Cookie 借用网关能力。
 */
@Component
public class GatewayHandshakeInterceptor implements HandshakeInterceptor {

    private final GatewaySettingsService settings;

    public GatewayHandshakeInterceptor(GatewaySettingsService settings) {
        this.settings = settings;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        if (!settings.isEnabled()) {
            response.setStatusCode(HttpStatus.FORBIDDEN);
            return false;
        }
        String origin = request.getHeaders().getFirst(HttpHeaders.ORIGIN);
        if (origin != null && !origin.trim().isEmpty()) {
            response.setStatusCode(HttpStatus.FORBIDDEN);
            return false;
        }
        String supplied = request.getHeaders().getFirst(GatewaySettingsService.HEADER);
        if (supplied == null || supplied.trim().isEmpty()) {
            String authorization = request.getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
            if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
                supplied = authorization.substring(7).trim();
            }
        }
        if (!settings.verifyToken(supplied)) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // 无需处理
    }
}
