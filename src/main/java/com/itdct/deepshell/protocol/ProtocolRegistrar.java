package com.itdct.deepshell.protocol;

import com.itdct.deepshell.DeepShellApplication;
import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.common.RuntimeSupport;
import com.itdct.deepshell.config.LocalServerInfo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 把 deepshell:// 注册为当前用户的 URL 协议（Windows 写 HKCU，Linux 写 xdg desktop 文件）。
 * 每次启动都会刷新，确保 Java / jar / 数据目录路径变化后调用仍然有效。
 *
 * 不写系统级注册表、不需要管理员权限；分发包（java -jar）才注册，
 * IDE / classes 开发模式会明确返回 DEVELOPMENT。
 */
@Slf4j
@Component
public class ProtocolRegistrar {

    public static final String STATE_PENDING = "PENDING";
    public static final String STATE_REGISTERED = "REGISTERED";
    public static final String STATE_DISABLED = "DISABLED";
    public static final String STATE_UNSUPPORTED = "UNSUPPORTED";
    public static final String STATE_DEVELOPMENT = "DEVELOPMENT";
    public static final String STATE_FAILED = "FAILED";

    private static final Pattern SCHEME_PATTERN = Pattern.compile("[a-z][a-z0-9+.-]*");

    @Value("${deepshell.protocol.enabled:true}")
    private boolean enabled;

    @Value("${deepshell.protocol.scheme:deepshell}")
    private String configuredScheme;

    private volatile String state = STATE_PENDING;
    private volatile String detail = "等待注册";
    private volatile String launcher = "";

    private final LocalServerInfo serverInfo;

    public ProtocolRegistrar(LocalServerInfo serverInfo) {
        this.serverInfo = serverInfo;
    }

    /** 启动完成时异步注册，避免注册表 / xdg 查询拖慢就绪。 */
    public void registerAsync() {
        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                register();
            }
        }, "protocol-registrar");
        thread.setDaemon(true);
        thread.start();
    }

    public synchronized Map<String, Object> register() {
        Map<String, Object> result = status();
        if (!enabled) {
            state = STATE_DISABLED;
            detail = "已在配置中关闭 deepshell.protocol.enabled（已存在的系统注册需手动删除）";
            return fill(result);
        }
        String scheme = scheme();
        if (!SCHEME_PATTERN.matcher(scheme).matches()) {
            state = STATE_FAILED;
            detail = "deepshell.protocol.scheme 不是合法的 URL 协议名";
            return fill(result);
        }
        if (!hasDesktopSession()) {
            state = STATE_UNSUPPORTED;
            detail = "当前没有可用的桌面会话，不注册 URL 协议";
            return fill(result);
        }
        File jar = resolvePackagedJar();
        if (jar == null && !RuntimeSupport.isPackaged()) {
            state = STATE_DEVELOPMENT;
            detail = "当前以 classes / IDE 模式运行，未注册系统协议；使用绿色版或分发包启动后会自动注册";
            return fill(result);
        }
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        try {
            if (os.contains("win")) {
                registerWindows(scheme, jar);
            } else if (os.contains("linux")) {
                registerLinux(scheme, jar);
            } else {
                state = STATE_UNSUPPORTED;
                detail = "当前系统暂不支持自动注册 URL 协议（支持 Windows / Linux）";
                return fill(result);
            }
        } catch (Exception e) {
            state = STATE_FAILED;
            detail = "注册失败：" + shorten(e.getMessage());
            launcher = "";
            log.warn("注册 {}:// 协议失败: {}", scheme, e.getMessage());
            ProtocolFiles.log("注册协议失败: " + e.getMessage());
            return fill(result);
        }
        log.info("已注册 URL 协议 {}:// → {}", scheme, launcher);
        ProtocolFiles.log("已注册 URL 协议 " + scheme + ":// → " + launcher);
        return fill(result);
    }

    public Map<String, Object> status() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("enabled", enabled);
        map.put("scheme", scheme());
        map.put("state", state);
        map.put("detail", detail);
        map.put("launcher", launcher);
        map.put("platform", System.getProperty("os.name", "") + " " + System.getProperty("os.arch", ""));
        map.put("linkExample", scheme() + "://connect?id=1");
        return map;
    }

    private Map<String, Object> fill(Map<String, Object> map) {
        map.put("state", state);
        map.put("detail", detail);
        map.put("launcher", launcher);
        return map;
    }

    private String scheme() {
        String value = configuredScheme == null ? "" : configuredScheme.trim().toLowerCase(Locale.ROOT);
        return value.isEmpty() ? "deepshell" : value;
    }

    /* ---------------- Windows ---------------- */

    private void registerWindows(String scheme, File jar) throws Exception {
        String key = "HKCU\\Software\\Classes\\" + scheme;
        String fullKey = "HKEY_CURRENT_USER\\Software\\Classes\\" + scheme;
        String command = windowsCommand(jar);
        Path icon = extractIcon();
        Path regFile = Files.createTempFile(DataDir.root(), "protocol-register-", ".reg");
        try {
            StringBuilder content = new StringBuilder();
            content.append("Windows Registry Editor Version 5.00\r\n\r\n");
            content.append('[').append(fullKey).append("]\r\n");
            content.append("@=\"").append(escapeReg("URL:DeepShell 外部调用")).append("\"\r\n");
            content.append("\"URL Protocol\"=\"\"\r\n\r\n");
            if (icon != null) {
                content.append('[').append(fullKey).append("\\DefaultIcon]\r\n");
                content.append("@=\"").append(escapeReg(icon.toAbsolutePath() + ",0")).append("\"\r\n\r\n");
            }
            content.append('[').append(fullKey).append("\\shell\\open\\command]\r\n");
            content.append("@=\"").append(escapeReg(command)).append("\"\r\n");
            writeUtf16Le(regFile, content.toString());
            exec("reg", "import", regFile.toAbsolutePath().toString());
            exec("reg", "query", key + "\\shell\\open\\command", "/ve");
        } finally {
            try {
                Files.deleteIfExists(regFile);
            } catch (Exception ignore) {
                // 临时文件残留不影响功能
            }
        }
        state = STATE_REGISTERED;
        detail = "已注册到当前用户：" + key + "（无需管理员权限）";
        launcher = RuntimeSupport.isPackaged() && RuntimeSupport.launcher() != null
                ? RuntimeSupport.launcher().toAbsolutePath().toString()
                : jar.getAbsolutePath();
    }

    private static void writeUtf16Le(Path file, String text) throws Exception {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_16LE);
        byte[] bom = {(byte) 0xFF, (byte) 0xFE};
        byte[] all = new byte[bom.length + bytes.length];
        System.arraycopy(bom, 0, all, 0, bom.length);
        System.arraycopy(bytes, 0, all, bom.length, bytes.length);
        Files.write(file, all);
    }

    private static String escapeReg(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private String windowsCommand(File jar) {
        List<String> args = RuntimeSupport.launchCommand(serverInfo.port(), false);
        if (args.isEmpty()) {
            args.add(javaExecutable(true));
            args.add("-Dfile.encoding=UTF-8");
            args.add("-jar");
            args.add(jar.getAbsolutePath());
            addSharedArgs(args, jar);
        }
        args.add("--deepshell.protocol-uri=%1");

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < args.size(); i++) {
            if (i > 0) {
                sb.append(' ');
            }
            String arg = args.get(i);
            if (arg.equals("--deepshell.protocol-uri=%1")) {
                // 由 Windows 在启动时替换为实际 URL；保留引号避免空格拆参
                sb.append('"').append(arg).append('"');
            } else {
                sb.append(quoteWindows(arg));
            }
        }
        return sb.toString();
    }

    private void addSharedArgs(List<String> args, File jar) {
        args.add("--deepshell.data-dir=" + DataDir.root().toString());
        args.add("--server.port=" + serverInfo.port());
        File config = externalConfig(jar);
        if (config != null) {
            args.add("--spring.config.additional-location=optional:file:"
                    + config.getAbsolutePath().replace('\\', '/'));
        }
    }

    private File externalConfig(File jar) {
        List<File> candidates = new ArrayList<>();
        String userDir = System.getProperty("user.dir");
        if (userDir != null && !userDir.trim().isEmpty()) {
            File cwd = new File(userDir);
            candidates.add(new File(cwd, "application.yml"));
            candidates.add(new File(cwd, "config/application.yml"));
        }
        File parent = jar.getParentFile();
        if (parent != null) {
            candidates.add(new File(parent, "application.yml"));
            candidates.add(new File(parent, "config/application.yml"));
        }
        for (File file : candidates) {
            if (file.isFile()) {
                return file;
            }
        }
        return null;
    }

    private Path extractIcon() {
        Path icon = DataDir.root().resolve("protocol-icon.ico");
        if (Files.isRegularFile(icon)) {
            return icon;
        }
        try (InputStream in = DeepShellApplication.class.getResourceAsStream("/static/favicon.ico")) {
            if (in == null) {
                return null;
            }
            Files.createDirectories(icon.getParent());
            Files.copy(in, icon);
            return icon;
        } catch (Exception e) {
            return null;
        }
    }

    /* ---------------- Linux ---------------- */

    private void registerLinux(String scheme, File jar) throws Exception {
        String home = System.getProperty("user.home");
        Path applications = new File(home, ".local/share/applications").toPath();
        Files.createDirectories(applications);
        String desktopName = scheme.replaceAll("[^a-z0-9+.-]", "-") + "-protocol.desktop";
        Path desktopFile = applications.resolve(desktopName);

        List<String> args = RuntimeSupport.launchCommand(serverInfo.port(), false);
        if (args.isEmpty()) {
            args.add(javaExecutable(false));
            args.add("-Dfile.encoding=UTF-8");
            args.add("-jar");
            args.add(jar.getAbsolutePath());
            addSharedArgs(args, jar);
        }
        args.add("--deepshell.protocol-uri");
        args.add("%u");

        StringBuilder exec = new StringBuilder();
        for (int i = 0; i < args.size(); i++) {
            if (i > 0) {
                exec.append(' ');
            }
            String arg = args.get(i);
            if ("%u".equals(arg)) {
                exec.append("%u");
            } else {
                exec.append(quoteDesktop(arg));
            }
        }

        StringBuilder content = new StringBuilder();
        content.append("[Desktop Entry]\n");
        content.append("Type=Application\n");
        content.append("Name=DeepShell 外部调用\n");
        content.append("Comment=由网页或运维门户呼起 DeepShell 并连接服务器\n");
        content.append("Exec=").append(exec).append('\n');
        content.append("Terminal=false\n");
        content.append("NoDisplay=true\n");
        content.append("MimeType=x-scheme-handler/").append(scheme).append(";\n");
        content.append("Categories=Network;\n");
        Files.write(desktopFile, content.toString().getBytes(StandardCharsets.UTF_8));

        boolean ok = false;
        String detailText;
        try {
            exec("update-desktop-database", applications.toString());
        } catch (Exception ignore) {
            // 可选命令，缺失时 xdg-mime 仍可工作
        }
        try {
            exec("xdg-mime", "default", desktopName, "x-scheme-handler/" + scheme);
            String current = exec("xdg-mime", "query", "default", "x-scheme-handler/" + scheme);
            ok = current != null && current.trim().contains(desktopName);
            detailText = ok ? "已注册到当前用户：" + desktopFile
                    : "已写入 " + desktopFile + "，但 xdg-mime 未将其设为默认程序";
        } catch (Exception e) {
            try {
                exec("gio", "mime", "x-scheme-handler/" + scheme, desktopName);
                ok = true;
                detailText = "已通过 gio 注册：" + desktopFile;
            } catch (Exception e2) {
                detailText = "已写入 " + desktopFile + "，但未能设置默认程序（缺少 xdg-mime / gio）";
            }
        }
        if (!ok) {
            state = STATE_FAILED;
            detail = detailText;
            launcher = desktopFile.toString();
            return;
        }
        state = STATE_REGISTERED;
        detail = detailText;
        launcher = desktopFile.toString();
    }

    /* ---------------- helpers ---------------- */

    /**
     * 注册协议需要桌面会话。不能直接用 GraphicsEnvironment.isHeadless()：
     * Spring Boot 会按 spring.main.headless（默认 true）设置 java.awt.headless，
     * 而它绑定得比 URL 协议注册早，会把正常的 Windows 桌面误判成无界面。
     */
    private static boolean hasDesktopSession() {
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        if (os.contains("win")) {
            return true;
        }
        if (os.contains("linux")) {
            String display = System.getenv("DISPLAY");
            String wayland = System.getenv("WAYLAND_DISPLAY");
            return (display != null && !display.trim().isEmpty())
                    || (wayland != null && !wayland.trim().isEmpty());
        }
        return false;
    }

    private File resolvePackagedJar() {
        try {
            URL location = DeepShellApplication.class.getProtectionDomain()
                    .getCodeSource().getLocation();
            File file = fileFromLocation(location);
            if (file != null && file.isFile() && file.getName().toLowerCase(Locale.ROOT).endsWith(".jar")) {
                return file;
            }
        } catch (Exception ignore) {
            // 继续尝试 java.class.path
        }
        String classPath = System.getProperty("java.class.path", "");
        if (classPath.indexOf(File.pathSeparatorChar) < 0) {
            File single = new File(classPath);
            if (single.isFile() && single.getName().toLowerCase(Locale.ROOT).endsWith(".jar")) {
                return single;
            }
        }
        return null;
    }

    private File fileFromLocation(URL location) throws Exception {
        if (location == null) {
            return null;
        }
        String spec = location.toString();
        if (spec.startsWith("jar:")) {
            int bang = spec.indexOf("!/");
            String inner = bang > 0 ? spec.substring(4, bang) : spec.substring(4);
            return new File(URI.create(inner));
        }
        if ("file".equals(location.getProtocol())) {
            return new File(location.toURI());
        }
        return null;
    }

    private String javaExecutable(boolean windows) {
        String home = System.getProperty("java.home");
        if (home != null && !home.isEmpty()) {
            File bin = new File(home, "bin");
            if (windows) {
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

    private static String quoteWindows(String value) {
        return "\"" + value.replace("\"", "\\\"") + "\"";
    }

    private static String quoteDesktop(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("`", "\\`").replace("$", "\\$") + "\"";
    }

    private static String exec(String... command) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(Arrays.asList(command));
        pb.redirectErrorStream(true);
        Process process = pb.start();
        byte[] output;
        try (InputStream in = process.getInputStream()) {
            output = readAll(in);
        }
        int code = process.waitFor();
        String text = new String(output, StandardCharsets.UTF_8).trim();
        if (code != 0) {
            throw new IllegalStateException("命令 " + command[0] + " 失败（" + code + "）"
                    + (text.isEmpty() ? "" : "：" + shorten(text)));
        }
        return text;
    }

    private static byte[] readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[1024];
        int n;
        while ((n = in.read(buf)) >= 0) {
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private static String shorten(String text) {
        if (text == null) {
            return "";
        }
        String oneLine = text.replace('\r', ' ').replace('\n', ' ').trim();
        return oneLine.length() > 300 ? oneLine.substring(0, 300) + "…" : oneLine;
    }
}
