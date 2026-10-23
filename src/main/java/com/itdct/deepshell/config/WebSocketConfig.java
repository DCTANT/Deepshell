package com.itdct.deepshell.config;

import com.itdct.deepshell.ws.LocalShellWebSocketHandler;
import com.itdct.deepshell.ws.SshWebSocketHandler;
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
    private final AuthHandshakeInterceptor authHandshakeInterceptor;
    private final LoopbackHandshakeInterceptor loopbackHandshakeInterceptor;

    public WebSocketConfig(SshWebSocketHandler handler,
                           LocalShellWebSocketHandler localShellHandler,
                           AuthHandshakeInterceptor authHandshakeInterceptor,
                           LoopbackHandshakeInterceptor loopbackHandshakeInterceptor) {
        this.handler = handler;
        this.localShellHandler = localShellHandler;
        this.authHandshakeInterceptor = authHandshakeInterceptor;
        this.loopbackHandshakeInterceptor = loopbackHandshakeInterceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws/ssh")
                .addInterceptors(authHandshakeInterceptor)
                .setAllowedOrigins("*");
        // 本机终端只接受回环连接；开启登录时仍需携带有效 Cookie
        registry.addHandler(localShellHandler, "/ws/local-shell")
                .addInterceptors(authHandshakeInterceptor, loopbackHandshakeInterceptor)
                .setAllowedOrigins("*");
    }

    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(2 * 1024 * 1024);
        container.setMaxBinaryMessageBufferSize(2 * 1024 * 1024);
        return container;
    }
}
