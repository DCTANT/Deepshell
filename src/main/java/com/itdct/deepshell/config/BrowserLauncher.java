package com.itdct.deepshell.config;

import com.itdct.deepshell.service.TlsService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

/**
 * 启动完成后自动打开系统浏览器访问首页（双击 jar 启动的默认体验）。
 * 关闭：-Ddeepshell.open-browser=false；自定义打开命令：-Ddeepshell.browser-cmd=...（{url} 为地址占位符）。
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
        if (!openBrowser) {
            return;
        }
        final String url = tls.localUrl() + "/";
        Thread t = new Thread(() -> {
            try {
                Thread.sleep(600);
                open(url);
                log.info("已自动打开浏览器: {}", url);
            } catch (Exception e) {
                log.warn("自动打开浏览器失败（可手动访问 {}）: {}", url, e.getMessage());
            }
        }, "open-browser");
        t.setDaemon(true);
        t.start();
    }

    private void open(String url) throws Exception {
        if (browserCmd != null && !browserCmd.trim().isEmpty()) {
            Runtime.getRuntime().exec(browserCmd.trim().replace("{url}", url));
            return;
        }
        try {
            if (java.awt.Desktop.isDesktopSupported()
                    && java.awt.Desktop.getDesktop().isSupported(java.awt.Desktop.Action.BROWSE)) {
                java.awt.Desktop.getDesktop().browse(new java.net.URI(url));
                return;
            }
        } catch (Throwable ignore) {
            // 无桌面环境（服务器/无头模式）时走命令行回退
        }
        String os = System.getProperty("os.name", "").toLowerCase();
        if (os.contains("win")) {
            new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", url).start();
        } else if (os.contains("mac")) {
            new ProcessBuilder("open", url).start();
        } else {
            new ProcessBuilder("xdg-open", url).start();
        }
    }
}
