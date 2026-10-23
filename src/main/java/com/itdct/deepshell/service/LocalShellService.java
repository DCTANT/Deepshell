package com.itdct.deepshell.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 本机 Shell 进程（本地桌面的「终端」）：
 * - Windows 使用 cmd.exe 管道，输入输出按系统控制台编码转换，避免中文乱码；
 * - Linux 优先通过 script 分配伪终端（支持提示符 / 交互式命令），失败时回退普通管道；
 * - 仅由 /ws/local-shell 调用，WebSocket 握手层限制回环访问。
 */
@Slf4j
@Service
public class LocalShellService {

    @Value("${deepshell.local-shell.command:}")
    private String configuredCommand;

    public ShellProcess start(int cols, int rows) throws IOException {
        int safeCols = Math.max(20, Math.min(cols, 400));
        int safeRows = Math.max(5, Math.min(rows, 200));
        boolean windows = isWindows();
        String shell = resolveShell(windows);
        List<String> command = new ArrayList<>();
        Charset charset;
        boolean pty = false;
        if (windows) {
            command.add(shell);
            command.add("/D");
            // /Q 关闭命令行回显：前端做本地行编辑，否则每个字符会被 cmd 再回显一遍
            command.add("/Q");
            charset = windowsConsoleCharset();
        } else {
            String script = findOnPath("script");
            String shellCommand = "stty rows " + safeRows + " cols " + safeCols
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
            charset = StandardCharsets.UTF_8;
        }
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        pb.directory(new File(System.getProperty("user.home", ".")));
        pb.environment().put("TERM", "xterm-256color");
        pb.environment().put("COLORTERM", "truecolor");
        Process process = pb.start();
        String name = new File(shell).getName();
        log.info("本地终端已启动: {} (pty={})", command, pty);
        return new ShellProcess(process, charset, pty, name);
    }

    private String resolveShell(boolean windows) {
        String configured = configuredCommand == null ? "" : configuredCommand.trim();
        if (!configured.isEmpty()) {
            return configured;
        }
        if (windows) {
            String comspec = System.getenv("COMSPEC");
            return comspec != null && !comspec.trim().isEmpty() ? comspec.trim() : "cmd.exe";
        }
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
        private final String shellName;

        ShellProcess(Process process, Charset charset, boolean pty, String shellName) {
            this.process = process;
            this.charset = charset;
            this.pty = pty;
            this.shellName = shellName;
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

        public String getShellName() {
            return shellName;
        }
    }
}
