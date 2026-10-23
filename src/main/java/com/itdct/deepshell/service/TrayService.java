package com.itdct.deepshell.service;

import com.itdct.deepshell.common.RuntimeSupport;
import com.itdct.deepshell.config.BrowserLauncher;
import com.itdct.deepshell.config.LocalServerInfo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.AWTException;
import java.awt.CheckboxMenuItem;
import java.awt.Image;
import java.awt.MenuItem;
import java.awt.PopupMenu;
import java.awt.SystemTray;
import java.awt.Toolkit;
import java.awt.TrayIcon;
import java.awt.datatransfer.StringSelection;
import java.awt.event.ItemEvent;
import java.io.InputStream;
import java.util.Map;

/** 绿色版在后台提供服务时的系统托盘入口：打开界面、开机启动、检查更新、重启 / 退出。 */
@Slf4j
@Service
public class TrayService implements ApplicationListener<ApplicationReadyEvent>, DisposableBean {

    private final AppPrefsService prefs;
    private final AutoStartService autoStart;
    private final UpdateService updateService;
    private final AppLifecycleService lifecycle;
    private final BrowserLauncher browserLauncher;
    private final LocalServerInfo serverInfo;

    private volatile TrayIcon trayIcon;
    private volatile SystemTray tray;
    private volatile CheckboxMenuItem startupItem;

    public TrayService(AppPrefsService prefs, AutoStartService autoStart,
                       UpdateService updateService, AppLifecycleService lifecycle,
                       BrowserLauncher browserLauncher, LocalServerInfo serverInfo) {
        this.prefs = prefs;
        this.autoStart = autoStart;
        this.updateService = updateService;
        this.lifecycle = lifecycle;
        this.browserLauncher = browserLauncher;
        this.serverInfo = serverInfo;
    }

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        if (prefs.trayEnabled()) {
            install();
        }
    }

    public boolean isSupported() {
        try {
            return RuntimeSupport.hasDesktopSession() && SystemTray.isSupported();
        } catch (Throwable e) {
            return false;
        }
    }

    public synchronized boolean isVisible() {
        return trayIcon != null;
    }

    public synchronized void setEnabled(boolean enabled) {
        prefs.setBoolean(AppPrefsService.TRAY_ENABLED, enabled);
        if (enabled) {
            install();
        } else {
            uninstall();
        }
    }

    private synchronized void install() {
        if (trayIcon != null) {
            return;
        }
        if (!isSupported()) {
            log.info("当前环境不支持系统托盘，跳过托盘图标");
            return;
        }
        try {
            Image image = loadImage();
            if (image == null) {
                log.warn("托盘图标资源读取失败");
                return;
            }
            PopupMenu menu = new PopupMenu();

            MenuItem open = new MenuItem("打开 DeepShell");
            open.addActionListener(e -> openApp());
            menu.add(open);

            MenuItem copy = new MenuItem("复制访问地址");
            copy.addActionListener(e -> copyAddress());
            menu.add(copy);

            menu.addSeparator();

            CheckboxMenuItem startup = new CheckboxMenuItem("开机启动");
            try {
                startup.setState(autoStart.isEnabled());
            } catch (Exception ignore) {
                startup.setState(false);
            }
            startup.addItemListener(e -> {
                boolean want = e.getStateChange() == ItemEvent.SELECTED;
                try {
                    autoStart.setEnabled(want);
                    notifyMessage("开机启动", want ? "已开启，下次登录系统会自动启动 DeepShell"
                            : "已关闭开机启动");
                } catch (Exception ex) {
                    startup.setState(!want);
                    notifyMessage("开机启动设置失败", ex.getMessage());
                }
            });
            menu.add(startup);
            startupItem = startup;

            MenuItem update = new MenuItem("检查更新");
            update.addActionListener(e -> checkUpdateAsync());
            menu.add(update);

            menu.addSeparator();

            MenuItem restart = new MenuItem("重启 DeepShell");
            restart.addActionListener(e -> {
                try {
                    lifecycle.restart();
                } catch (Exception ex) {
                    notifyMessage("重启失败", ex.getMessage());
                }
            });
            menu.add(restart);

            MenuItem exit = new MenuItem("退出 DeepShell");
            exit.addActionListener(e -> lifecycle.shutdown());
            menu.add(exit);

            TrayIcon icon = new TrayIcon(image, "DeepShell · " + serverInfo.baseUrl(), menu);
            icon.setImageAutoSize(true);
            icon.addActionListener(e -> openApp());
            tray = SystemTray.getSystemTray();
            tray.add(icon);
            trayIcon = icon;
            log.info("系统托盘已启用");
            if (!prefs.getBoolean("tray.hint", false)) {
                prefs.setBoolean("tray.hint", true);
                icon.displayMessage("DeepShell 正在后台运行",
                        "双击托盘图标打开界面；右键可打开 / 开机启动 / 检查更新 / 退出。",
                        TrayIcon.MessageType.INFO);
            }
        } catch (AWTException | java.awt.HeadlessException e) {
            log.warn("创建系统托盘失败: {}", e.getMessage());
        } catch (Throwable e) {
            log.warn("创建系统托盘失败: {}", e.toString());
        }
    }

    private synchronized void uninstall() {
        if (trayIcon != null && tray != null) {
            tray.remove(trayIcon);
            trayIcon = null;
            startupItem = null;
            log.info("系统托盘已关闭");
        }
    }

    /** 网页端修改开机启动后同步托盘菜单的勾选状态。 */
    public void refreshStartupState() {
        CheckboxMenuItem item = startupItem;
        if (item == null) {
            return;
        }
        try {
            item.setState(autoStart.isEnabled());
        } catch (Exception ignore) {
            // 读取失败保持原状态
        }
    }

    private void openApp() {
        try {
            browserLauncher.openUrl(serverInfo.baseUrl() + "/", 100);
        } catch (Exception e) {
            log.warn("从托盘打开界面失败: {}", e.getMessage());
        }
    }

    private void copyAddress() {
        try {
            Toolkit.getDefaultToolkit().getSystemClipboard()
                    .setContents(new StringSelection(serverInfo.baseUrl() + "/"), null);
            notifyMessage("已复制访问地址", serverInfo.baseUrl() + "/");
        } catch (Exception e) {
            log.warn("复制访问地址失败: {}", e.getMessage());
        }
    }

    private void checkUpdateAsync() {
        Thread t = new Thread(() -> {
            Map<String, Object> r = updateService.check();
            if (!Boolean.TRUE.equals(r.get("ok"))) {
                notifyMessage("检查更新失败", String.valueOf(r.get("message")));
                return;
            }
            if (Boolean.TRUE.equals(r.get("updateAvailable"))) {
                notifyMessage("发现新版本 " + r.get("latestVersion"),
                        "打开 DeepShell → 关于 / 应用设置中下载并更新。");
            } else {
                notifyMessage("检查更新", "当前已是最新版本 " + r.get("currentVersion"));
            }
        }, "tray-update-check");
        t.setDaemon(true);
        t.start();
    }

    public void notifyMessage(String title, String text) {
        TrayIcon icon = trayIcon;
        if (icon == null) {
            return;
        }
        try {
            icon.displayMessage(title, text == null ? "" : text, TrayIcon.MessageType.INFO);
        } catch (Exception ignore) {
            // 托盘消息失败不影响功能
        }
    }

    private static Image loadImage() {
        try (InputStream in = TrayService.class.getResourceAsStream("/static/favicon-32.png")) {
            return in == null ? null : ImageIO.read(in);
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public void destroy() {
        uninstall();
    }
}
