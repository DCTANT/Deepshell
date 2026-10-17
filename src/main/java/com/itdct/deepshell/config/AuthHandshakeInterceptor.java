package com.itdct.deepshell.config;

import com.itdct.deepshell.service.AuthService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.Map;

/**
 * WebSocket 握手鉴权：开启登录后，浏览器必须在握手请求中携带有效的登录 Cookie，
 * 否则直接返回 401，避免绕过页面登录直接连接 /ws/ssh。
 */
@Component
public class AuthHandshakeInterceptor implements HandshakeInterceptor {

    private final AuthService auth;

    public AuthHandshakeInterceptor(AuthService auth) {
        this.auth = auth;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        if (!auth.isEnabled()) {
            return true;
        }
        String cookieHeader = request.getHeaders().getFirst(HttpHeaders.COOKIE);
        String token = auth.tokenFromCookieHeader(cookieHeader);
        if (auth.verify(token) == null) {
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
