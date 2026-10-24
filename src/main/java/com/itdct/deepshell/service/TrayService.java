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
import javax.swing.JCheckBoxMenuItem;
import javax.swing.JMenuItem;
import javax.swing.JPopupMenu;
import javax.swing.JWindow;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;
import javax.swing.event.PopupMenuEvent;
import javax.swing.event.PopupMenuListener;
import java.awt.AWTException;
import java.awt.Font;
import java.awt.GraphicsEnvironment;
import java.awt.Image;
import java.awt.MouseInfo;
import java.awt.Point;
import java.awt.SystemTray;
import java.awt.Toolkit;
import java.awt.TrayIcon;
import java.awt.datatransfer.StringSelection;
import java.awt.event.ItemEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.InputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 绿色版在后台提供服务时的系统托盘入口：打开界面、开机启动、检查更新、重启 / 退出。
 *
 * <p>菜单使用 Swing JPopupMenu 而不是 AWT PopupMenu：JDK 18+ 默认 file.encoding=UTF-8 时，
 * AWT 原生菜单在中文 Windows 上会把菜单文字传成无法渲染的方框（实测 JDK 21 + UTF-8 复现）。</p>
 */
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
    private volatile JCheckBoxMenuItem startupItem;
    private volatile JPopupMenu popupMenu;
    /** JPopupMenu 需要一个已显示的组件作为 invoker；用 1x1 的透明窗口承载 */
    private volatile JWindow menuInvoker;

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
            final JPopupMenu menu = createMenuOnEdt();
            popupMenu = menu;

            TrayIcon icon = new TrayIcon(image, "DeepShell · " + serverInfo.baseUrl());
            icon.setImageAutoSize(true);
            icon.addActionListener(e -> openApp());
            icon.addMouseListener(new MouseAdapter() {
                @Override
                public void mouseReleased(MouseEvent e) {
                    if (e.isPopupTrigger()) {
                        showMenu(e);
                    }
                }

                @Override
                public void mousePressed(MouseEvent e) {
                    if (e.isPopupTrigger()) {
                        showMenu(e);
                    }
                }
            });
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

    private JPopupMenu buildMenu() {
        JPopupMenu menu = new JPopupMenu();
        Font font = menuFont();
        menu.setFont(font);

        JMenuItem open = item("打开 DeepShell", font, this::openApp);
        menu.add(open);

        JMenuItem copy = item("复制访问地址", font, this::copyAddress);
        menu.add(copy);

        menu.addSeparator();

        JCheckBoxMenuItem startup = new JCheckBoxMenuItem("开机启动");
        startup.setFont(font);
        try {
            startup.setSelected(autoStart.isEnabled());
        } catch (Exception ignore) {
            startup.setSelected(false);
        }
        startup.addItemListener(e -> {
            boolean want = e.getStateChange() == ItemEvent.SELECTED;
            try {
                autoStart.setEnabled(want);
                notifyMessage("开机启动", want ? "已开启，下次登录系统会自动启动 DeepShell"
                        : "已关闭开机启动");
            } catch (Exception ex) {
                startup.setSelected(!want);
                notifyMessage("开机启动设置失败", ex.getMessage());
            }
        });
        menu.add(startup);
        startupItem = startup;

        JMenuItem update = item("检查更新", font, this::checkUpdateAsync);
        menu.add(update);

        menu.addSeparator();

        JMenuItem restart = item("重启 DeepShell", font, () -> {
            try {
                lifecycle.restart();
            } catch (Exception ex) {
                notifyMessage("重启失败", ex.getMessage());
            }
        });
        menu.add(restart);

        JMenuItem exit = item("退出 DeepShell", font, lifecycle::shutdown);
        menu.add(exit);

        JWindow invoker = new JWindow();
        invoker.setSize(1, 1);
        invoker.setLocation(-2, -2);
        invoker.setFocusableWindowState(false);
        invoker.setAutoRequestFocus(false);
        invoker.setVisible(true);
        menuInvoker = invoker;
        menu.addPopupMenuListener(new PopupMenuListener() {
            @Override
            public void popupMenuWillBecomeVisible(PopupMenuEvent e) {
                // 无需处理
            }

            @Override
            public void popupMenuWillBecomeInvisible(PopupMenuEvent e) {
                // 菜单关闭后把 1x1 的 invoker 挪开，避免挡住鼠标点击
                invoker.setLocation(-2, -2);
            }

            @Override
            public void popupMenuCanceled(PopupMenuEvent e) {
                invoker.setLocation(-2, -2);
            }
        });
        return menu;
    }

    /** Swing 组件与外观初始化放到 EDT，避免和 JFileChooser 等 Swing 操作并发 */
    private JPopupMenu createMenuOnEdt() throws Exception {
        if (SwingUtilities.isEventDispatchThread()) {
            initLookAndFeel();
            return buildMenu();
        }
        final JPopupMenu[] holder = new JPopupMenu[1];
        SwingUtilities.invokeAndWait(() -> {
            initLookAndFeel();
            holder[0] = buildMenu();
        });
        return holder[0];
    }

    private static JMenuItem item(String text, Font font, Runnable action) {
        JMenuItem item = new JMenuItem(text);
        item.setFont(font);
        item.addActionListener(e -> action.run());
        return item;
    }

    private static void initLookAndFeel() {
        try {
            UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
        } catch (Exception ignore) {
            // 使用默认外观
        }
    }

    /** 选一个能显示中文的字体；Swing 绘制文字不经过 AWT 原生菜单的编码转换 */
    private static Font menuFont() {
        int size = 12;
        try {
            Font base = UIManager.getFont("MenuItem.font");
            if (base != null && base.getSize() > 0) {
                size = base.getSize();
            }
        } catch (Exception ignore) {
            // 使用默认字号
        }
        try {
            Set<String> available = new HashSet<>(Arrays.asList(
                    GraphicsEnvironment.getLocalGraphicsEnvironment()
                            .getAvailableFontFamilyNames(Locale.getDefault())));
            for (String name : new String[]{"Microsoft YaHei UI", "Microsoft YaHei", "SimSun", "宋体",
                    "Noto Sans CJK SC", "WenQuanYi Micro Hei", "PingFang SC"}) {
                if (available.contains(name)) {
                    return new Font(name, Font.PLAIN, size);
                }
            }
        } catch (Throwable ignore) {
            // 回退到逻辑字体
        }
        return new Font(Font.DIALOG, Font.PLAIN, size);
    }

    private void showMenu(MouseEvent e) {
        JPopupMenu menu = popupMenu;
        JWindow invoker = menuInvoker;
        if (menu == null || invoker == null || menu.isVisible()) {
            return;
        }
        try {
            Point point = null;
            if (MouseInfo.getPointerInfo() != null) {
                point = MouseInfo.getPointerInfo().getLocation();
            }
            if (point == null) {
                point = e.getLocationOnScreen();
            }
            invoker.setLocation(point.x, point.y);
            SwingUtilities.invokeLater(() -> {
                if (!menu.isVisible()) {
                    menu.show(invoker, 0, 0);
                }
            });
        } catch (Exception ex) {
            log.debug("显示托盘菜单失败: {}", ex.getMessage());
        }
    }

    private synchronized void uninstall() {
        if (trayIcon != null && tray != null) {
            tray.remove(trayIcon);
            trayIcon = null;
            startupItem = null;
            final JPopupMenu menu = popupMenu;
            final JWindow invoker = menuInvoker;
            popupMenu = null;
            menuInvoker = null;
            if (menu != null || invoker != null) {
                Runnable cleanup = () -> {
                    if (menu != null) {
                        menu.setVisible(false);
                    }
                    if (invoker != null) {
                        invoker.dispose();
                    }
                };
                if (SwingUtilities.isEventDispatchThread()) {
                    cleanup.run();
                } else {
                    SwingUtilities.invokeLater(cleanup);
                }
            }
            log.info("系统托盘已关闭");
        }
    }

    /** 网页端修改开机启动后同步托盘菜单的勾选状态。 */
    public void refreshStartupState() {
        final JCheckBoxMenuItem item = startupItem;
        if (item == null) {
            return;
        }
        Runnable update = () -> {
            try {
                item.setSelected(autoStart.isEnabled());
            } catch (Exception ignore) {
                // 读取失败保持原状态
            }
        };
        if (SwingUtilities.isEventDispatchThread()) {
            update.run();
        } else {
            SwingUtilities.invokeLater(update);
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
