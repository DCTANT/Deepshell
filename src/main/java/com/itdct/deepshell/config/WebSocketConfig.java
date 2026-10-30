package com.itdct.deepshell.config;

import com.itdct.deepshell.ws.GatewayTunnelWebSocketHandler;
import com.itdct.deepshell.ws.LocalShellWebSocketHandler;
import com.itdct.deepshell.ws.SshWebSocketHandler;
import com.itdct.deepshell.ws.WorkspaceEventWebSocketHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final SshWebSocketHandler handler;
    private final LocalShellWebSocketHandler localShellHandler;
    private final GatewayTunnelWebSocketHandler gatewayTunnelHandler;
    private final WorkspaceEventWebSocketHandler eventHandler;
    private final AuthHandshakeInterceptor authHandshakeInterceptor;
    private final LoopbackHandshakeInterceptor loopbackHandshakeInterceptor;
    private final SameOriginHandshakeInterceptor sameOriginHandshakeInterceptor;
    private final GatewayHandshakeInterceptor gatewayHandshakeInterceptor;

    public WebSocketConfig(SshWebSocketHandler handler,
                           LocalShellWebSocketHandler localShellHandler,
                           GatewayTunnelWebSocketHandler gatewayTunnelHandler,
                           WorkspaceEventWebSocketHandler eventHandler,
                           AuthHandshakeInterceptor authHandshakeInterceptor,
                           LoopbackHandshakeInterceptor loopbackHandshakeInterceptor,
                           SameOriginHandshakeInterceptor sameOriginHandshakeInterceptor,
                           GatewayHandshakeInterceptor gatewayHandshakeInterceptor) {
        this.handler = handler;
        this.localShellHandler = localShellHandler;
        this.gatewayTunnelHandler = gatewayTunnelHandler;
        this.eventHandler = eventHandler;
        this.authHandshakeInterceptor = authHandshakeInterceptor;
        this.loopbackHandshakeInterceptor = loopbackHandshakeInterceptor;
        this.sameOriginHandshakeInterceptor = sameOriginHandshakeInterceptor;
        this.gatewayHandshakeInterceptor = gatewayHandshakeInterceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // 终端会使用库中保存的凭据建连：必须校验 Origin，避免任意网页借浏览器直连本机 SSH
        registry.addHandler(handler, "/ws/ssh")
                .addInterceptors(authHandshakeInterceptor, sameOriginHandshakeInterceptor);
        // 本机终端只接受回环连接；开启登录时仍需携带有效 Cookie
        registry.addHandler(localShellHandler, "/ws/local-shell")
                .addInterceptors(authHandshakeInterceptor, loopbackHandshakeInterceptor);
        // 工作台事件：外部 HTTP 接口打开连接时通知在线页面
        registry.addHandler(eventHandler, "/ws/events")
                .addInterceptors(authHandshakeInterceptor, sameOriginHandshakeInterceptor);
        // 执行网关隧道：服务端客户端携带网关注入 Token，不接受浏览器 Origin
        registry.addHandler(gatewayTunnelHandler, "/ws/gateway/tunnel")
                .addInterceptors(gatewayHandshakeInterceptor);
    }

    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(2 * 1024 * 1024);
        container.setMaxBinaryMessageBufferSize(2 * 1024 * 1024);
        return container;
    }
}
