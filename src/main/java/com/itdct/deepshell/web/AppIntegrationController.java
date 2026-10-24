package com.itdct.deepshell.web;

import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.common.LocalRequest;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.common.RuntimeSupport;
import com.itdct.deepshell.service.AppPrefsService;
import com.itdct.deepshell.service.AutoStartService;
import com.itdct.deepshell.service.ShortcutService;
import com.itdct.deepshell.service.TrayService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;

/** 绿色版的桌面集成：快捷方式、开机启动、托盘、自动检查更新与首次运行引导。 */
@RestController
@RequestMapping("/api/app-integration")
public class AppIntegrationController {

    private final AppPrefsService prefs;
    private final AutoStartService autoStart;
    private final ShortcutService shortcuts;
    private final TrayService tray;

    @Value("${deepshell.version:1.5.1}")
    private String version;

    public AppIntegrationController(AppPrefsService prefs, AutoStartService autoStart,
                                    ShortcutService shortcuts, TrayService tray) {
        this.prefs = prefs;
        this.autoStart = autoStart;
        this.shortcuts = shortcuts;
        this.tray = tray;
    }

    @GetMapping("/status")
    public R<Map<String, Object>> status(HttpServletRequest request) {
        Map<String, Object> m = new LinkedHashMap<>();
        boolean local = LocalRequest.isLoopback(request);
        m.put("local", local);
        if (!local) {
            // 局域网访问时不暴露本机路径，也不触发 PowerShell / 注册表查询
            m.put("message", "快捷方式、开机启动和更新只能在运行 DeepShell 的这台电脑上管理");
            return R.ok(m);
        }
        m.put("packaged", RuntimeSupport.isPackaged());
        m.put("version", version);
        m.put("java", System.getProperty("java.version"));
        m.put("os", System.getProperty("os.name") + " " + System.getProperty("os.arch"));
        m.put("dataDir", DataDir.root().toString());
        m.put("launcher", RuntimeSupport.launcher() == null ? ""
                : RuntimeSupport.launcher().toAbsolutePath().toString());
        m.put("installDir", RuntimeSupport.appDir() == null ? ""
                : RuntimeSupport.appDir().toAbsolutePath().toString());
        m.put("traySupported", tray.isSupported());
        m.put("trayEnabled", prefs.trayEnabled());
        m.put("trayVisible", tray.isVisible());
        m.put("startupSupported", autoStart.isSupported());
        boolean startup = false;
        try {
            startup = autoStart.isEnabled();
        } catch (Exception ignore) {
            // 读取失败按关闭处理
        }
        m.put("startupEnabled", startup);
        m.put("autoUpdateCheck", prefs.autoUpdateCheck());
        m.put("firstRun", RuntimeSupport.isPackaged() && !prefs.onboardingDone());
        m.put("shortcuts", shortcuts.status());
        return R.ok(m);
    }

    @PostMapping("/shortcuts")
    public R<Map<String, Object>> shortcuts(@RequestBody Map<String, Object> body,
                                            HttpServletRequest request) {
        LocalRequest.requireLocal(request, "创建桌面 / 开始菜单快捷方式");
        boolean desktop = Boolean.parseBoolean(String.valueOf(body.get("desktop")));
        boolean startMenu = Boolean.parseBoolean(String.valueOf(body.get("startMenu")));
        boolean remove = "remove".equalsIgnoreCase(String.valueOf(body.get("action")));
        Map<String, Object> result = remove
                ? shortcuts.remove(desktop, startMenu)
                : shortcuts.create(desktop, startMenu);
        return R.ok(result);
    }

    @PostMapping("/startup")
    public R<Map<String, Object>> startup(@RequestBody Map<String, Object> body,
                                          HttpServletRequest request) {
        LocalRequest.requireLocal(request, "修改开机启动");
        boolean enabled = Boolean.parseBoolean(String.valueOf(body.get("enabled")));
        autoStart.setEnabled(enabled);
        tray.refreshStartupState();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", autoStart.isEnabled());
        return R.ok(m);
    }

    @PostMapping("/tray")
    public R<Map<String, Object>> tray(@RequestBody Map<String, Object> body,
                                       HttpServletRequest request) {
        LocalRequest.requireLocal(request, "修改托盘图标设置");
        boolean enabled = Boolean.parseBoolean(String.valueOf(body.get("enabled")));
        tray.setEnabled(enabled);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", prefs.trayEnabled());
        m.put("visible", tray.isVisible());
        m.put("supported", tray.isSupported());
        return R.ok(m);
    }

    @PostMapping("/auto-update")
    public R<Map<String, Object>> autoUpdate(@RequestBody Map<String, Object> body,
                                             HttpServletRequest request) {
        LocalRequest.requireLocal(request, "修改自动检查更新");
        boolean enabled = Boolean.parseBoolean(String.valueOf(body.get("enabled")));
        prefs.setBoolean(AppPrefsService.AUTO_UPDATE_CHECK, enabled);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", enabled);
        return R.ok(m);
    }

    @PostMapping("/onboarding")
    public R<Map<String, Object>> onboarding(@RequestBody(required = false) Map<String, Object> body,
                                             HttpServletRequest request) {
        LocalRequest.requireLocal(request, "完成首次运行引导");
        prefs.setBoolean(AppPrefsService.ONBOARDING_DONE, true);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("done", true);
        return R.ok(m);
    }
}
