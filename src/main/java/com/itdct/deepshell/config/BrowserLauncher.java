package com.itdct.deepshell.config;

import com.itdct.deepshell.common.RuntimeSupport;
import com.itdct.deepshell.common.SystemBrowser;
import com.itdct.deepshell.protocol.ProtocolLaunchSupport;
import com.itdct.deepshell.service.TlsService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

/**
 * 启动完成后自动打开系统浏览器访问首页（双击 jar 启动的默认体验）。
 * 关闭：-Ddeepshell.open-browser=false；自定义打开命令：-Ddeepshell.browser-cmd=...（{url} 为地址占位符）。
 * 带 deepshell:// 外部调用启动时跳过首页，由 ProtocolBootstrap 打开调用目标。
 */
@Slf4j
@Component
public class BrowserLauncher implements ApplicationListener<ApplicationReadyEvent> {

    @Value("${server.port:17777}")
    private int port;

    @Value("${deepshell.open-browser:true}")
    private boolean openBrowser;

    @Value("${deepshell.browser-cmd:}")
    private String browserCmd;

    private final TlsService tls;

    public BrowserLauncher(TlsService tls) {
        this.tls = tls;
    }

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        if (ProtocolLaunchSupport.hasPending()) {
            // 外部调用自己会打开工作台 / 错误提示页
            return;
        }
        if (!openBrowser || RuntimeSupport.isBackground()) {
            return;
        }
        openUrl(tls.localUrl() + "/", 600);
    }

    /** 在独立线程中延迟打开地址，避免阻塞 Spring 就绪与 HTTP 响应。 */
    public void openUrl(final String url) {
        openUrl(url, 300);
    }

    public void openUrl(final String url, final long delayMs) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Thread.sleep(delayMs);
                    SystemBrowser.open(url, browserCmd);
                    log.info("已自动打开浏览器: {}", url);
                } catch (Exception e) {
                    log.warn("自动打开浏览器失败（可手动访问 {}）: {}", url, e.getMessage());
                }
            }
        }, "open-browser");
        t.setDaemon(true);
        t.start();
    }
}
