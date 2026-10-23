package com.itdct.deepshell.config;

import com.itdct.deepshell.service.TlsService;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;

/**
 * 当前进程实际提供服务的本机地址。
 * 端口以 WebServer 实际监听值为准（server.port=0 时也能得到正确值），
 * 协议转发、冷启动打开浏览器与发送给启动器的运行信息都使用这里。
 */
@Component
public class LocalServerInfo {

    private final TlsService tls;
    private final WebServerApplicationContext webContext;

    public LocalServerInfo(ApplicationContext context, TlsService tls) {
        this.tls = tls;
        this.webContext = context instanceof WebServerApplicationContext
                ? (WebServerApplicationContext) context : null;
    }

    public int port() {
        if (webContext != null && webContext.getWebServer() != null) {
            return webContext.getWebServer().getPort();
        }
        return 17777;
    }

    public String baseUrl() {
        return tls.getScheme() + "://127.0.0.1:" + port();
    }
}
