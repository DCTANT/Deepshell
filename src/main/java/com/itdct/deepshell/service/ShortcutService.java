package com.itdct.deepshell.service;

import com.itdct.deepshell.common.RuntimeSupport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Base64;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 绿色版没有安装程序，由应用自己创建桌面 / 开始菜单快捷方式。
 * Windows 用当前用户 WScript.Shell（无需管理员权限），Linux 写 .desktop 文件。
 */
@Service
public class ShortcutService {

    private static final Logger log = LoggerFactory.getLogger(ShortcutService.class);

    private volatile Map<String, String> folderCache;
    private volatile long folderCacheAt;

    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        Path launcher = RuntimeSupport.launcher();
        m.put("supported", RuntimeSupport.isWindows() || RuntimeSupport.isLinux());
        m.put("available", launcher != null);
        m.put("launcher", launcher == null ? "" : launcher.toAbsolutePath().toString());
        if (launcher == null) {
            m.put("desktopExists", false);
            m.put("startMenuExists", false);
            m.put("desktopPath", "");
            m.put("startMenuPath", "");
            m.put("note", "仅绿色版 / 分发包运行时可以创建快捷方式");
            return m;
        }
        try {
            Path desktop;
            Path startMenu;
            if (RuntimeSupport.isWindows()) {
                Map<String, String> folders = folders();
                desktop = Paths.get(folders.get("desktop")).resolve("DeepShell.lnk");
                startMenu = Paths.get(folders.get("programs")).resolve("DeepShell.lnk");
            } else {
                String home = System.getProperty("user.home");
                desktop = Paths.get(home, "Desktop", "DeepShell.desktop");
                startMenu = Paths.get(home, ".local", "share", "applications",
                        "deepshell.desktop");
            }
            m.put("desktopPath", desktop.toString());
            m.put("startMenuPath", startMenu.toString());
            m.put("desktopExists", Files.isRegularFile(desktop));
            m.put("startMenuExists", Files.isRegularFile(startMenu));
            m.put("note", "");
        } catch (Exception e) {
            m.put("desktopExists", false);
            m.put("startMenuExists", false);
            m.put("note", "无法读取桌面目录: " + e.getMessage());
        }
        return m;
    }

    public Map<String, Object> create(boolean desktop, boolean startMenu) {
        Path launcher = RuntimeSupport.launcher();
        if (launcher == null) {
            throw new IllegalStateException("仅绿色版 / 分发包运行时可以创建快捷方式");
        }
        if (!desktop && !startMenu) {
            throw new IllegalArgumentException("请选择要创建快捷方式的位置");
        }
        try {
            if (RuntimeSupport.isWindows()) {
                createWindows(launcher, desktop, startMenu);
            } else if (RuntimeSupport.isLinux()) {
                createLinux(launcher, desktop, startMenu);
            } else {
                throw new IllegalStateException("当前系统暂不支持创建快捷方式");
            }
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("创建快捷方式失败: " + e.getMessage());
        }
        return status();
    }

    public Map<String, Object> remove(boolean desktop, boolean startMenu) {
        if (RuntimeSupport.isWindows()) {
            Map<String, String> folders = folders();
            if (desktop) {
                deleteQuietly(Paths.get(folders.get("desktop")).resolve("DeepShell.lnk"));
            }
            if (startMenu) {
                deleteQuietly(Paths.get(folders.get("programs")).resolve("DeepShell.lnk"));
            }
        } else if (RuntimeSupport.isLinux()) {
            String home = System.getProperty("user.home");
            if (desktop) {
                deleteQuietly(Paths.get(home, "Desktop", "DeepShell.desktop"));
            }
            if (startMenu) {
                deleteQuietly(Paths.get(home, ".local", "share", "applications",
                        "deepshell.desktop"));
            }
        }
        return status();
    }

    private void createWindows(Path launcher, boolean desktop, boolean startMenu) {
        Map<String, String> folders = folders();
        Path launcherAbs = launcher.toAbsolutePath();
        Path dir = launcherAbs.getParent();
        String script = "$ErrorActionPreference = 'Stop'\n"
                + "[Console]::OutputEncoding = [Text.Encoding]::UTF8\n"
                + "$ws = New-Object -ComObject WScript.Shell\n";
        if (desktop) {
            Path target = Paths.get(folders.get("desktop")).resolve("DeepShell.lnk");
            script += shortcutScript("$ws", target, launcherAbs, dir);
        }
        if (startMenu) {
            Path target = Paths.get(folders.get("programs")).resolve("DeepShell.lnk");
            script += shortcutScript("$ws", target, launcherAbs, dir);
        }
        try {
            execEncodedPowerShell(script);
            log.info("已创建快捷方式: desktop={}, startMenu={}", desktop, startMenu);
        } catch (Exception e) {
            throw new IllegalStateException("创建快捷方式失败: " + e.getMessage());
        }
    }

    private static String shortcutScript(String ws, Path link, Path launcher, Path workingDir) {
        return "$s = " + ws + ".CreateShortcut('" + psLiteral(link.toAbsolutePath().toString()) + "')\n"
                + "$s.TargetPath = '" + psLiteral(launcher.toString()) + "'\n"
                + "$s.WorkingDirectory = '" + psLiteral(workingDir.toString()) + "'\n"
                + "$s.IconLocation = '" + psLiteral(launcher.toString()) + ",0'\n"
                + "$s.Description = 'DeepShell SSH 终端'\n"
                + "$s.Save()\n";
    }

    private void createLinux(Path launcher, boolean desktop, boolean startMenu) {
        String exec = RuntimeSupport.quoteDesktop(launcher.toAbsolutePath().toString());
        String content = "[Desktop Entry]\n"
                + "Type=Application\n"
                + "Name=DeepShell\n"
                + "Comment=SSH 终端与 AI 运维助手\n"
                + "Exec=" + exec + "\n"
                + "Path=" + launcher.toAbsolutePath().getParent() + "\n"
                + "Terminal=false\n"
                + "Categories=Network;TerminalEmulator;\n"
                + "StartupWMClass=DeepShell\n";
        String home = System.getProperty("user.home");
        try {
            if (desktop) {
                Path file = Paths.get(home, "Desktop", "DeepShell.desktop");
                writeDesktopFile(file, content);
            }
            if (startMenu) {
                Path file = Paths.get(home, ".local", "share", "applications",
                        "deepshell.desktop");
                writeDesktopFile(file, content);
            }
            log.info("已创建快捷方式: desktop={}, startMenu={}", desktop, startMenu);
        } catch (Exception e) {
            throw new IllegalStateException("创建快捷方式失败: " + e.getMessage());
        }
    }

    private static void writeDesktopFile(Path file, String content) throws Exception {
        Files.createDirectories(file.getParent());
        Files.write(file, content.getBytes(StandardCharsets.UTF_8));
        try {
            Set<PosixFilePermission> perms = EnumSet.of(
                    PosixFilePermission.OWNER_READ,
                    PosixFilePermission.OWNER_WRITE,
                    PosixFilePermission.OWNER_EXECUTE,
                    PosixFilePermission.GROUP_READ,
                    PosixFilePermission.GROUP_EXECUTE,
                    PosixFilePermission.OTHERS_READ,
                    PosixFilePermission.OTHERS_EXECUTE);
            Files.setPosixFilePermissions(file, perms);
        } catch (UnsupportedOperationException ignore) {
            // 非 POSIX 文件系统
        }
    }

    private static void deleteQuietly(Path file) {
        try {
            Files.deleteIfExists(file);
        } catch (Exception ignore) {
            // 文件被占用时保留，下次可覆盖
        }
    }

    private Map<String, String> folders() {
        Map<String, String> cached = folderCache;
        if (cached != null && System.currentTimeMillis() - folderCacheAt < 60_000L) {
            return cached;
        }
        Map<String, String> result = new LinkedHashMap<>();
        if (RuntimeSupport.isWindows()) {
            String script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8\n"
                    + "[Environment]::GetFolderPath('Desktop')\n"
                    + "[Environment]::GetFolderPath('Programs')\n";
            String desktop = "";
            String programs = "";
            try {
                String output = execEncodedPowerShell(script);
                String[] lines = output.replace("\r", "").split("\n");
                desktop = lines.length > 0 ? lines[0].trim() : "";
                programs = lines.length > 1 ? lines[1].trim() : "";
            } catch (Exception e) {
                log.warn("读取 Windows 已知文件夹失败: {}", e.getMessage());
            }
            if (desktop.isEmpty()) {
                String profile = System.getenv("USERPROFILE");
                desktop = Paths.get(profile == null ? System.getProperty("user.home") : profile,
                        "Desktop").toString();
            }
            if (programs.isEmpty()) {
                String appData = System.getenv("APPDATA");
                programs = Paths.get(appData == null ? System.getProperty("user.home") : appData,
                        "Microsoft", "Windows", "Start Menu", "Programs").toString();
            }
            result.put("desktop", desktop);
            result.put("programs", programs);
        } else {
            String home = System.getProperty("user.home");
            result.put("desktop", Paths.get(home, "Desktop").toString());
            result.put("programs", Paths.get(home, ".local", "share", "applications").toString());
        }
        folderCache = result;
        folderCacheAt = System.currentTimeMillis();
        return result;
    }

    private static String psLiteral(String value) {
        return value.replace("'", "''");
    }

    private static String execEncodedPowerShell(String script) throws Exception {
        String encoded = Base64.getEncoder().encodeToString(
                script.getBytes(StandardCharsets.UTF_16LE));
        ProcessBuilder pb = new ProcessBuilder("powershell.exe", "-NoProfile",
                "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-EncodedCommand", encoded);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        String output;
        try (InputStream in = process.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[2048];
            int n;
            while ((n = in.read(buf)) >= 0) {
                out.write(buf, 0, n);
            }
            output = new String(out.toByteArray(), StandardCharsets.UTF_8).trim();
        }
        int code = process.waitFor();
        if (code != 0) {
            throw new IllegalStateException(output.isEmpty()
                    ? "PowerShell 返回 " + code : output);
        }
        return output;
    }
}
