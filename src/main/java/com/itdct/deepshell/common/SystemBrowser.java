package com.itdct.deepshell.common;

import java.awt.Desktop;
import java.net.URI;

/** 在系统默认浏览器中打开地址；桌面不可用时按平台命令回退。 */
public final class SystemBrowser {

    private SystemBrowser() {
    }

    public static void open(String url) throws Exception {
        open(url, null);
    }

    /**
     * @param browserCmd 自定义浏览器命令，{url} 为地址占位符；为空时使用系统默认浏览器
     */
    public static void open(String url, String browserCmd) throws Exception {
        if (browserCmd != null && !browserCmd.trim().isEmpty()) {
            Runtime.getRuntime().exec(browserCmd.trim().replace("{url}", url));
            return;
        }
        try {
            if (Desktop.isDesktopSupported()
                    && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(new URI(url));
                return;
            }
        } catch (Throwable ignore) {
            // 无桌面环境（服务器 / 无头模式）时走命令行回退
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
