package com.itdct.deepshell.service;

import com.pty4j.PtyProcess;
import com.pty4j.PtyProcessBuilder;
import com.pty4j.WinSize;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 本机 Shell 进程（本地桌面的「终端」）：
 * - Windows 优先通过 ConPTY 启动真正的交互式终端（支持提示符、颜色、Tab 补全、全屏程序和窗口尺寸），
 *   不可用时回退 winpty，最后回退 cmd 管道；输出按系统控制台编码转换，避免中文乱码；
 * - Linux / macOS 优先通过 script 分配伪终端（支持提示符 / 交互式命令），失败时回退普通管道；
 * - 仅由 /ws/local-shell 调用，WebSocket 握手层限制回环访问。
 */
@Slf4j
@Service
public class LocalShellService {

    public static final String SHELL_CMD = "cmd";
    public static final String SHELL_POWERSHELL = "powershell";
    public static final String SHELL_PWSH = "pwsh";
    public static final String SHELL_CUSTOM = "custom";
    public static final String SHELL_DEFAULT = "default";

    @Value("${deepshell.local-shell.command:}")
    private String configuredCommand;

    @Value("${deepshell.local-shell.default:}")
    private String configuredDefault;

    /** 一个可选的本机 Shell。 */
    public static final class ShellOption {
        private final String id;
        private final String name;
        private final String executable;
        private final List<String> arguments;
        private final boolean available;

        ShellOption(String id, String name, String executable, List<String> arguments, boolean available) {
            this.id = id;
            this.name = name;
            this.executable = executable;
            this.arguments = arguments == null ? Collections.<String>emptyList() : arguments;
            this.available = available;
        }

        public String getId() {
            return id;
        }

        public String getName() {
            return name;
        }

        public String getExecutable() {
            return executable;
        }

        public List<String> getArguments() {
            return arguments;
        }

        public boolean isAvailable() {
            return available;
        }
    }

    /** 当前系统可选的 Shell（不可用的选项也返回，便于前端置灰展示）。 */
    public List<ShellOption> shells() {
        List<ShellOption> list = new ArrayList<>();
        String custom = trim(configuredCommand);
        String customPath = null;
        if (!custom.isEmpty()) {
            customPath = resolveExecutable(custom);
            String name = executableName(customPath == null ? custom : customPath);
            list.add(new ShellOption(SHELL_CUSTOM, name, customPath == null ? custom : customPath,
                    Collections.<String>emptyList(), customPath != null));
        }
        if (isWindows()) {
            String powerShell = windowsPowerShell();
            if (powerShell != null && !samePath(powerShell, customPath)) {
                list.add(new ShellOption(SHELL_POWERSHELL, "Windows PowerShell", powerShell,
                        Collections.singletonList("-NoLogo"), true));
            }
            String pwsh = findPwsh();
            if (pwsh != null && !samePath(pwsh, customPath)) {
                list.add(new ShellOption(SHELL_PWSH, "PowerShell 7", pwsh,
                        Collections.singletonList("-NoLogo"), true));
            }
            String cmd = cmdExecutable();
            if (!samePath(cmd, customPath)) {
                list.add(new ShellOption(SHELL_CMD, "命令提示符", cmd,
                        Collections.<String>emptyList(), cmd != null));
            }
        } else {
            String shell = unixShell();
            if (!samePath(shell, customPath)) {
                list.add(new ShellOption(SHELL_DEFAULT, executableName(shell), shell,
                        Collections.<String>emptyList(), new File(shell).canExecute()));
            }
        }
        return list;
    }

    /** 默认 Shell：优先 deepshell.local-shell.default，其次自定义命令，Windows 优先 PowerShell。 */
    public String defaultShellId() {
        List<ShellOption> options = shells();
        String configured = trim(configuredDefault);
        if (!configured.isEmpty()) {
            for (ShellOption option : options) {
                if (option.getId().equalsIgnoreCase(configured) && option.isAvailable()) {
                    return option.getId();
                }
            }
            log.warn("deepshell.local-shell.default={} 不可用，使用内置默认 Shell", configured);
        }
        String custom = trim(configuredCommand);
        if (!custom.isEmpty()) {
            for (ShellOption option : options) {
                if (SHELL_CUSTOM.equals(option.getId()) && option.isAvailable()) {
                    return option.getId();
                }
            }
        }
        if (isWindows()) {
            for (ShellOption option : options) {
                if (SHELL_POWERSHELL.equals(option.getId()) && option.isAvailable()) {
                    return option.getId();
                }
            }
        }
        for (ShellOption option : options) {
            if (option.isAvailable()) {
                return option.getId();
            }
        }
        return isWindows() ? SHELL_CMD : SHELL_DEFAULT;
    }

    public ShellProcess start(int cols, int rows, String shellId) throws IOException {
        int safeCols = Math.max(20, Math.min(cols, 400));
        int safeRows = Math.max(5, Math.min(rows, 200));
        ShellOption option = resolveOption(shellId);
        if (isWindows()) {
            return startWindows(option, safeCols, safeRows);
        }
        return startUnix(option, safeCols, safeRows);
    }

    private ShellOption resolveOption(String shellId) throws IOException {
        List<ShellOption> options = shells();
        String wanted = trim(shellId);
        if (!wanted.isEmpty()) {
            for (ShellOption option : options) {
                if (option.getId().equalsIgnoreCase(wanted) && option.isAvailable()) {
                    return option;
                }
            }
            log.warn("请求的本地 Shell 不可用: {}，回退默认 Shell", wanted);
        }
        String defaultId = defaultShellId();
        for (ShellOption option : options) {
            if (option.getId().equalsIgnoreCase(defaultId) && option.isAvailable()) {
                return option;
            }
        }
        throw new IOException("当前系统没有可用的本地 Shell");
    }

    private ShellProcess startWindows(ShellOption option, int cols, int rows) throws IOException {
        // winpty 对 Ctrl+C / 传统控制台程序更稳，优先使用；ConPTY 作为兜底
        Throwable winPtyError;
        try {
            return startWindowsPty(option, cols, rows, false);
        } catch (Throwable e) {
            winPtyError = e;
            log.warn("winpty 启动失败（{}），尝试 ConPTY", e.getMessage());
        }
        try {
            return startWindowsPty(option, cols, rows, true);
        } catch (Throwable e) {
            log.warn("ConPTY 启动失败（{}），{}", e.getMessage(), pipeFallbackHint(option));
        }
        if (SHELL_CMD.equals(option.getId())) {
            return startWindowsPipe(option, winPtyError);
        }
        throw new IOException("无法启动 " + option.getName()
                + " 的交互式终端，请确认系统支持伪终端后重试", winPtyError);
    }

    private ShellProcess startWindowsPty(ShellOption option, int cols, int rows, boolean conPty)
            throws IOException {
        List<String> command = new ArrayList<>();
        command.add(option.getExecutable());
        command.addAll(option.getArguments());
        Map<String, String> env = new HashMap<>(System.getenv());
        env.put("TERM", "xterm-256color");
        env.put("COLORTERM", "truecolor");
        PtyProcess process = new PtyProcessBuilder(command.toArray(new String[0]))
                .setEnvironment(env)
                .setDirectory(userHome())
                .setConsole(false)
                .setUseWinConPty(conPty)
                .setRedirectErrorStream(true)
                .setInitialColumns(cols)
                .setInitialRows(rows)
                .start();
        // ConPTY / winpty 的 VT 流统一是 UTF-8（与控制台代码页无关）
        log.info("本地终端已启动: {} (conpty={})", command, conPty);
        return new ShellProcess(process, StandardCharsets.UTF_8, true, option);
    }

    /** 老系统最后兜底：cmd 管道 + 前端行编辑（与旧版行为一致）。 */
    private ShellProcess startWindowsPipe(ShellOption option, Throwable cause) throws IOException {
        List<String> command = new ArrayList<>();
        command.add(option.getExecutable());
        command.add("/D");
        // /Q 关闭命令行回显：前端做本地行编辑，否则每个字符会被 cmd 再回显一遍
        command.add("/Q");
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        pb.directory(new File(userHome()));
        pb.environment().put("TERM", "xterm-256color");
        pb.environment().put("COLORTERM", "truecolor");
        try {
            Process process = pb.start();
            log.info("本地终端已启动（管道回退）: {}", command);
            return new ShellProcess(process, windowsConsoleCharset(), false, option);
        } catch (IOException e) {
            if (cause != null) {
                e.addSuppressed(cause);
            }
            throw e;
        }
    }

    private ShellProcess startUnix(ShellOption option, int cols, int rows) throws IOException {
        String shell = option.getExecutable();
        List<String> command = new ArrayList<>();
        boolean pty = false;
        String script = findOnPath("script");
        String shellCommand = "stty rows " + rows + " cols " + cols
                + " 2>/dev/null; exec " + quoteShell(shell) + " -i";
        if (script != null) {
            pty = true;
            if (isMac()) {
                command.add(script);
                command.add("-q");
                command.add("/dev/null");
                command.add("/bin/sh");
                command.add("-c");
                command.add(shellCommand);
            } else {
                command.add(script);
                command.add("-qfc");
                command.add(shellCommand);
                command.add("/dev/null");
            }
        } else {
            command.add(shell);
            command.add("-i");
        }
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        pb.directory(new File(userHome()));
        pb.environment().put("TERM", "xterm-256color");
        pb.environment().put("COLORTERM", "truecolor");
        Process process = pb.start();
        log.info("本地终端已启动: {} (pty={})", command, pty);
        return new ShellProcess(process, StandardCharsets.UTF_8, pty, option);
    }

    private static String pipeFallbackHint(ShellOption option) {
        return SHELL_CMD.equals(option.getId()) ? "改用 cmd 管道模式" : "当前 Shell 无法降级为管道模式";
    }

    private static String windowsPowerShell() {
        File file = new File(windowsDir(), "System32\\WindowsPowerShell\\v1.0\\powershell.exe");
        return file.isFile() ? file.getAbsolutePath() : null;
    }

    private static String cmdExecutable() {
        String comspec = System.getenv("COMSPEC");
        if (comspec != null && !comspec.trim().isEmpty()) {
            return comspec.trim();
        }
        File file = new File(windowsDir(), "System32\\cmd.exe");
        return file.isFile() ? file.getAbsolutePath() : "cmd.exe";
    }

    private static String findPwsh() {
        String onPath = findOnPath("pwsh");
        if (onPath != null) {
            return onPath;
        }
        String programFiles = System.getenv("ProgramFiles");
        if (programFiles != null) {
            for (String version : new String[]{"7", "6"}) {
                File file = new File(programFiles, "PowerShell\\" + version + "\\pwsh.exe");
                if (file.isFile()) {
                    return file.getAbsolutePath();
                }
            }
        }
        return null;
    }

    private static String unixShell() {
        String envShell = System.getenv("SHELL");
        if (envShell != null && new File(envShell).canExecute()) {
            return envShell;
        }
        File bash = new File("/bin/bash");
        if (bash.canExecute()) {
            return bash.getAbsolutePath();
        }
        return "/bin/sh";
    }

    private static String resolveExecutable(String command) {
        String value = trim(command);
        if (value.isEmpty()) {
            return null;
        }
        File direct = new File(value);
        if (direct.isAbsolute() || value.indexOf('/') >= 0 || value.indexOf('\\') >= 0) {
            return direct.isFile() ? direct.getAbsolutePath() : null;
        }
        String name = value.toLowerCase(Locale.ROOT).endsWith(".exe")
                ? value.substring(0, value.length() - 4) : value;
        return findOnPath(name);
    }

    private static String executableName(String path) {
        String name = new File(path).getName();
        if (name.toLowerCase(Locale.ROOT).endsWith(".exe")) {
            name = name.substring(0, name.length() - 4);
        }
        return name.isEmpty() ? path : name;
    }

    private static boolean samePath(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        try {
            return new File(a).getCanonicalPath().equalsIgnoreCase(new File(b).getCanonicalPath());
        } catch (IOException e) {
            return a.equalsIgnoreCase(b);
        }
    }

    private static String windowsDir() {
        String root = System.getenv("SystemRoot");
        return root == null || root.trim().isEmpty() ? "C:\\Windows" : root.trim();
    }

    private static String userHome() {
        return System.getProperty("user.home", ".");
    }

    private static Charset windowsConsoleCharset() {
        String[] candidates = {
                System.getProperty("native.encoding"),
                System.getProperty("sun.jnu.encoding"),
                System.getProperty("stdout.encoding")
        };
        for (String name : candidates) {
            if (name == null || name.trim().isEmpty()) {
                continue;
            }
            try {
                if (Charset.isSupported(name)) {
                    return Charset.forName(name);
                }
            } catch (Exception ignore) {
                // 继续尝试
            }
        }
        return Charset.defaultCharset();
    }

    private static String findOnPath(String name) {
        String path = System.getenv("PATH");
        if (path == null || path.isEmpty()) {
            return null;
        }
        String suffix = isWindows() ? ".exe" : "";
        for (String dir : path.split(File.pathSeparator)) {
            File file = new File(dir == null ? "" : dir, name + suffix);
            if (file.isFile() && file.canExecute()) {
                return file.getAbsolutePath();
            }
        }
        return null;
    }

    private static String quoteShell(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }

    private static boolean isMac() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("mac");
    }

    public static final class ShellProcess {
        private final Process process;
        private final Charset charset;
        private final boolean pty;
        private final String shellId;
        private final String shellName;

        ShellProcess(Process process, Charset charset, boolean pty, ShellOption option) {
            this.process = process;
            this.charset = charset;
            this.pty = pty;
            this.shellId = option.getId();
            this.shellName = option.getName();
        }

        public Process getProcess() {
            return process;
        }

        public Charset getCharset() {
            return charset;
        }

        public boolean isPty() {
            return pty;
        }

        public String getShellId() {
            return shellId;
        }

        public String getShellName() {
            return shellName;
        }

        /** 调整伪终端尺寸；管道模式忽略。 */
        public void resize(int cols, int rows) {
            if (!(process instanceof PtyProcess)) {
                return;
            }
            int safeCols = Math.max(20, Math.min(cols, 400));
            int safeRows = Math.max(5, Math.min(rows, 200));
            try {
                ((PtyProcess) process).setWinSize(new WinSize(safeCols, safeRows));
            } catch (Exception e) {
                log.debug("调整本地终端尺寸失败: {}", e.getMessage());
            }
        }
    }
}
