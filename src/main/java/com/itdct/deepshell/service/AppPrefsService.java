package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/** 本机应用偏好：托盘、自动检查更新、开机引导完成标记（数据目录 app.properties）。 */
@Service
public class AppPrefsService {

    public static final String TRAY_ENABLED = "tray.enabled";
    public static final String AUTO_UPDATE_CHECK = "update.auto-check";
    public static final String LAST_UPDATE_CHECK = "update.last-check";
    public static final String ONBOARDING_DONE = "onboarding.done";

    private final Path file = DataDir.root().resolve("app.properties");

    public synchronized Properties load() {
        Properties p = new Properties();
        try {
            if (Files.exists(file)) {
                try (InputStream in = Files.newInputStream(file)) {
                    p.load(in);
                }
            }
        } catch (Exception ignore) {
            // 读取失败按默认值处理
        }
        return p;
    }

    public synchronized String get(String key, String def) {
        String v = load().getProperty(key);
        return v == null ? def : v;
    }

    public boolean getBoolean(String key, boolean def) {
        String v = get(key, null);
        return v == null ? def : "true".equalsIgnoreCase(v.trim());
    }

    public synchronized void set(String key, String value) {
        Properties p = load();
        if (value == null) {
            p.remove(key);
        } else {
            p.setProperty(key, value);
        }
        try {
            Files.createDirectories(file.getParent());
            try (OutputStream out = Files.newOutputStream(file)) {
                p.store(out, "DeepShell application preferences");
            }
        } catch (Exception e) {
            throw new IllegalStateException("保存应用设置失败: " + e.getMessage());
        }
    }

    public void setBoolean(String key, boolean value) {
        set(key, value ? "true" : "false");
    }

    public boolean trayEnabled() {
        return getBoolean(TRAY_ENABLED, true);
    }

    public boolean autoUpdateCheck() {
        return getBoolean(AUTO_UPDATE_CHECK, true);
    }

    public long lastUpdateCheck() {
        try {
            return Long.parseLong(get(LAST_UPDATE_CHECK, "0"));
        } catch (NumberFormatException e) {
            return 0L;
        }
    }

    public boolean onboardingDone() {
        return getBoolean(ONBOARDING_DONE, false);
    }
}
