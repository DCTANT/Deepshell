package com.itdct.deepshell.common;

import java.io.File;
import java.net.URI;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 运行形态识别：绿色版（jpackage app-image）与普通 jar 分发包的启动器、外部配置和数据目录。
 * 打包后的绿色版由 jpackage 启动器设置 jpackage.app-path，优先用它重启 / 开机启动 / 注册 URL 协议，
 * 这样即使 JDK 被卸载或目录位置变化，deepshell:// 也能重新拉起应用。
 */
public final class RuntimeSupport {

    public static final String BACKGROUND_ARG = "--deepshell.background";

    private RuntimeSupport() {
    }

    /** jpackage 绿色版的启动器（DeepShell.exe / DeepShell） */
    public static Path launcher() {
        String[] keys = {"deepshell.launcher", "jpackage.app-path"};
        for (String key : keys) {
            String value = System.getProperty(key);
            if (value == null || value.trim().isEmpty()) {
                continue;
            }
            try {
                Path path = Paths.get(value.trim()).toAbsolutePath().normalize();
                if (Files.isRegularFile(path)) {
                    return path;
                }
            } catch (Exception ignore) {
                // 继续尝试下一个属性
            }
        }
        // 某些 jpackage 版本 / 启动方式不提供 jpackage.app-path，按 runtime 的目录结构反推
        try {
            Path javaHome = Paths.get(System.getProperty("java.home", "")).toAbsolutePath().normalize();
            Path runtime = javaHome.getFileName();
            Path root = javaHome.getParent();
            if (runtime != null && "runtime".equalsIgnoreCase(runtime.toString()) && root != null) {
                Path exe = root.resolve(isWindows() ? "DeepShell.exe" : "DeepShell");
                if (Files.isRegularFile(exe)) {
                    return exe;
                }
            }
        } catch (Exception ignore) {
            // 非绿色版
        }
        return null;
    }

    public static boolean isPackaged() {
        return launcher() != null;
    }

    public static Path appDir() {
        Path launcher = launcher();
        return launcher == null ? null : launcher.getParent();
    }

    /** 当前运行的 jar（开发模式或 classes 目录返回 null） */
    public static Path jar() {
        try {
            URL location = RuntimeSupport.class.getProtectionDomain().getCodeSource().getLocation();
            Path file = fromLocation(location);
            if (file != null && Files.isRegularFile(file)
                    && file.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".jar")) {
                return file;
            }
        } catch (Exception ignore) {
            // 继续尝试 java.class.path
        }
        String classPath = System.getProperty("java.class.path", "");
        if (classPath.indexOf(File.pathSeparatorChar) < 0) {
            try {
                Path single = Paths.get(classPath).toAbsolutePath().normalize();
                if (Files.isRegularFile(single)
                        && single.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".jar")) {
                    return single;
                }
            } catch (Exception ignore) {
                // 无可用 jar
            }
        }
        return null;
    }

    private static Path fromLocation(URL location) throws Exception {
        if (location == null) {
            return null;
        }
        String spec = location.toString();
        if (spec.startsWith("jar:")) {
            int bang = spec.indexOf("!/");
            String inner = bang > 0 ? spec.substring(4, bang) : spec.substring(4);
            return Paths.get(URI.create(inner));
        }
        if ("file".equals(location.getProtocol())) {
            return Paths.get(location.toURI());
        }
        return null;
    }

    /** 外置 application.yml：绿色版根目录优先，其次启动目录 / jar 目录。 */
    public static Path externalConfig() {
        List<Path> candidates = new ArrayList<>();
        Path appDir = appDir();
        if (appDir != null) {
            candidates.add(appDir.resolve("application.yml"));
            candidates.add(appDir.resolve("config").resolve("application.yml"));
        }
        Path jar = jar();
        if (jar != null && jar.getParent() != null) {
            candidates.add(jar.getParent().resolve("application.yml"));
            candidates.add(jar.getParent().resolve("config").resolve("application.yml"));
        }
        String userDir = System.getProperty("user.dir");
        if (userDir != null && !userDir.trim().isEmpty()) {
            Path cwd = Paths.get(userDir);
            candidates.add(cwd.resolve("application.yml"));
            candidates.add(cwd.resolve("config").resolve("application.yml"));
        }
        for (Path file : candidates) {
            if (Files.isRegularFile(file)) {
                return file.toAbsolutePath().normalize();
            }
        }
        return null;
    }

    public static String javaExecutable() {
        String home = System.getProperty("java.home");
        if (home != null && !home.isEmpty()) {
            File bin = new File(home, "bin");
            if (isWindows()) {
                File javaw = new File(bin, "javaw.exe");
                if (javaw.isFile()) {
                    return javaw.getAbsolutePath();
                }
                File java = new File(bin, "java.exe");
                if (java.isFile()) {
                    return java.getAbsolutePath();
                }
            } else {
                File java = new File(bin, "java");
                if (java.isFile()) {
                    return java.getAbsolutePath();
                }
            }
        }
        return "java";
    }

    /**
     * 拉起本应用的命令：绿色版直接用 jpackage 启动器，普通分发包回退到 javaw -jar。
     * 返回空列表表示当前开发模式无法自启动。
     */
    public static List<String> launchCommand(Integer port, boolean background) {
        List<String> command = new ArrayList<>();
        Path launcher = launcher();
        if (launcher != null) {
            command.add(launcher.toAbsolutePath().toString());
        } else {
            Path jar = jar();
            if (jar == null) {
                return command;
            }
            command.add(javaExecutable());
            command.add("-Dfile.encoding=UTF-8");
            command.add("-jar");
            command.add(jar.toAbsolutePath().toString());
        }
        command.add("--deepshell.data-dir=" + DataDir.root());
        if (port != null && port > 0) {
            command.add("--server.port=" + port);
        }
        Path config = externalConfig();
        if (config != null) {
            command.add("--spring.config.additional-location=optional:file:"
                    + config.toString().replace('\\', '/'));
        }
        if (background) {
            command.add(BACKGROUND_ARG);
        }
        return command;
    }

    public static boolean isBackground() {
        String prop = System.getProperty("deepshell.background");
        return prop != null && !"false".equalsIgnoreCase(prop.trim());
    }

    public static boolean hasBackgroundArg(String[] args) {
        if (args == null) {
            return false;
        }
        for (String arg : args) {
            if (arg != null && (BACKGROUND_ARG.equals(arg)
                    || arg.startsWith(BACKGROUND_ARG + "="))) {
                return true;
            }
        }
        return false;
    }

    public static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }

    public static boolean isLinux() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("linux");
    }

    public static boolean isMac() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("mac");
    }

    /** 是否有可用的桌面会话（用于托盘与 AWT；无显示器的 Linux 服务器不启用）。 */
    public static boolean hasDesktopSession() {
        if (isWindows() || isMac()) {
            return true;
        }
        if (isLinux()) {
            String display = System.getenv("DISPLAY");
            String wayland = System.getenv("WAYLAND_DISPLAY");
            return (display != null && !display.trim().isEmpty())
                    || (wayland != null && !wayland.trim().isEmpty());
        }
        return false;
    }

    public static String quoteWindows(String value) {
        return "\"" + value.replace("\"", "\\\"") + "\"";
    }

    public static String quoteDesktop(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("`", "\\`").replace("$", "\\$") + "\"";
    }

    public static String joinQuoted(List<String> command) {
        StringBuilder sb = new StringBuilder();
        for (String arg : command) {
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(quoteWindows(arg));
        }
        return sb.toString();
    }
}
