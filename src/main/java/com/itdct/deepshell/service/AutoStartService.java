package com.itdct.deepshell.service;

import com.itdct.deepshell.common.RuntimeSupport;
import com.itdct.deepshell.config.LocalServerInfo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

/** Windows 当前用户 Run 注册表 / Linux ~/.config/autostart 的开机启动开关。 */
@Service
public class AutoStartService {

    private static final Logger log = LoggerFactory.getLogger(AutoStartService.class);
    private static final String WINDOWS_RUN_KEY =
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    /** .reg 文件里的根必须写完整 HKEY_CURRENT_USER（HKCU 简写只适用于 reg.exe 参数） */
    private static final String WINDOWS_RUN_KEY_REG =
            "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    private static final String WINDOWS_VALUE = "DeepShell";

    private final LocalServerInfo serverInfo;

    public AutoStartService(LocalServerInfo serverInfo) {
        this.serverInfo = serverInfo;
    }

    public boolean isSupported() {
        return RuntimeSupport.isWindows() || RuntimeSupport.isLinux();
    }

    public boolean isEnabled() {
        if (RuntimeSupport.isWindows()) {
            try {
                exec(regExe(), "query", WINDOWS_RUN_KEY, "/v", WINDOWS_VALUE);
                return true;
            } catch (Exception e) {
                return false;
            }
        }
        if (RuntimeSupport.isLinux()) {
            return Files.isRegularFile(linuxDesktopFile());
        }
        return false;
    }

    public void setEnabled(boolean enabled) {
        if (enabled) {
            enable();
        } else {
            disable();
        }
    }

    private void enable() {
        List<String> command = RuntimeSupport.launchCommand(serverInfo.port(), true);
        if (command.isEmpty()) {
            throw new IllegalStateException("当前运行方式无法配置开机启动，请使用绿色版或分发包");
        }
        if (RuntimeSupport.isWindows()) {
            String value = RuntimeSupport.joinQuoted(command);
            Path regFile = null;
            try {
                // Java 的 ProcessBuilder 不能安全传递内含双引号的 reg /d 参数，改用 .reg 导入
                regFile = Files.createTempFile(com.itdct.deepshell.common.DataDir.root(),
                        "deepshell-autostart-", ".reg");
                StringBuilder content = new StringBuilder();
                content.append("Windows Registry Editor Version 5.00\r\n\r\n");
                content.append('[').append(WINDOWS_RUN_KEY_REG).append("]\r\n");
                content.append('"').append(WINDOWS_VALUE).append("\"=\"")
                        .append(escapeReg(value)).append("\"\r\n");
                writeUtf16Le(regFile, content.toString());
                exec(regExe(), "import", regFile.toAbsolutePath().toString());
                log.info("已开启开机启动: {}", value);
                return;
            } catch (Exception e) {
                throw new IllegalStateException("写入开机启动注册表失败: " + e.getMessage());
            } finally {
                if (regFile != null) {
                    try {
                        Files.deleteIfExists(regFile);
                    } catch (Exception ignore) {
                        // 临时文件残留不影响功能
                    }
                }
            }
        }
        if (RuntimeSupport.isLinux()) {
            Path file = linuxDesktopFile();
            StringBuilder sb = new StringBuilder();
            for (String arg : command) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(RuntimeSupport.quoteDesktop(arg));
            }
            String content = "[Desktop Entry]\n"
                    + "Type=Application\n"
                    + "Name=DeepShell\n"
                    + "Comment=DeepShell 终端工具（后台启动）\n"
                    + "Exec=" + sb + "\n"
                    + "Terminal=false\n"
                    + "X-GNOME-Autostart-enabled=true\n";
            try {
                Files.createDirectories(file.getParent());
                Files.write(file, content.getBytes(StandardCharsets.UTF_8));
                log.info("已开启开机启动: {}", file);
            } catch (Exception e) {
                throw new IllegalStateException("写入开机启动文件失败: " + e.getMessage());
            }
            return;
        }
        throw new IllegalStateException("当前系统不支持配置开机启动");
    }

    private void disable() {
        if (RuntimeSupport.isWindows()) {
            try {
                exec(regExe(), "delete", WINDOWS_RUN_KEY, "/v", WINDOWS_VALUE, "/f");
            } catch (Exception e) {
                // 本来就不存在
            }
            return;
        }
        if (RuntimeSupport.isLinux()) {
            try {
                Files.deleteIfExists(linuxDesktopFile());
            } catch (Exception e) {
                throw new IllegalStateException("关闭开机启动失败: " + e.getMessage());
            }
            return;
        }
        throw new IllegalStateException("当前系统不支持配置开机启动");
    }

    private static Path linuxDesktopFile() {
        return Paths.get(System.getProperty("user.home"),
                ".config", "autostart", "deepshell.desktop").toAbsolutePath().normalize();
    }

    private static String regExe() {
        Path exe = Paths.get(System.getenv().getOrDefault("SystemRoot", "C:\\Windows"),
                "System32", "reg.exe");
        return Files.isRegularFile(exe) ? exe.toString() : "reg";
    }

    private static String escapeReg(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static void writeUtf16Le(Path file, String text) throws Exception {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_16LE);
        byte[] bom = {(byte) 0xFF, (byte) 0xFE};
        byte[] all = new byte[bom.length + bytes.length];
        System.arraycopy(bom, 0, all, 0, bom.length);
        System.arraycopy(bytes, 0, all, bom.length, bytes.length);
        Files.write(file, all);
    }

    private static String exec(String... command) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
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
            output = new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
        int code = process.waitFor();
        if (code != 0) {
            throw new IllegalStateException(command[0] + " 返回 " + code
                    + (output.trim().isEmpty() ? "" : "：" + output.trim()));
        }
        return output;
    }
}
