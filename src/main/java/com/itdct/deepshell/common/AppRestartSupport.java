package com.itdct.deepshell.common;

import java.io.File;
import java.lang.management.ManagementFactory;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * DeepShell 自重启支持。
 * 重启时先启动一个同 jar 的「重启助手」进程（main 里识别 {@link #HELPER_PREFIX} 参数后直接进入本类），
 * 助手持有一个由旧进程加锁的锁文件，等旧进程退出、锁释放后再按原 JVM 参数与启动参数拉起新进程，
 * 避免新旧进程同时占用端口，也不依赖 start.sh / start.cmd 等外部脚本。
 */
public final class AppRestartSupport {

    public static final String HELPER_PREFIX = "--deepshell-restart-helper=";

    private static final long PARENT_EXIT_TIMEOUT_MS = 60_000L;

    /** 旧进程退出前一直持有，靠操作系统在进程结束时释放 */
    private static FileChannel heldChannel;
    private static FileLock heldLock;

    private AppRestartSupport() {
    }

    public static boolean isHelper(String[] args) {
        if (args == null) {
            return false;
        }
        for (String arg : args) {
            if (arg != null && arg.startsWith(HELPER_PREFIX)) {
                return true;
            }
        }
        return false;
    }

    /** 在当前进程内启动重启助手；成功后调用方再让当前进程退出。 */
    public static void launchRestart(String[] sourceArgs) throws Exception {
        FileChannel channel = FileChannel.open(lockFile(),
                StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        FileLock lock;
        try {
            lock = channel.tryLock();
        } catch (Exception e) {
            channel.close();
            throw e;
        }
        if (lock == null) {
            channel.close();
            throw new IllegalStateException("已有重启任务正在进行，请稍后再试");
        }
        heldChannel = channel;
        heldLock = lock;

        List<String> command = baseCommand();
        command.add(HELPER_PREFIX + currentPid());
        if (sourceArgs != null) {
            for (int i = 0; i < sourceArgs.length; i++) {
                String arg = sourceArgs[i];
                if (arg == null) {
                    continue;
                }
                // 外部调用链接只在本次启动生效，重启后不应再次自动打开连接
                if (arg.startsWith("--deepshell.protocol-uri")) {
                    if ("--deepshell.protocol-uri".equals(arg)) {
                        i++;
                    }
                    continue;
                }
                if (arg.regionMatches(true, 0, "deepshell:", 0, 10)) {
                    continue;
                }
                command.add(arg);
            }
        }
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(new File(System.getProperty("user.dir")));
        pb.redirectErrorStream(true);
        pb.redirectOutput(ProcessBuilder.Redirect.appendTo(logFile().toFile()));
        pb.start();
        log("已启动重启助手，等待当前进程（pid " + currentPid() + "）退出");
    }

    /** 延迟一小段时间后退出，给 HTTP 响应留出返回时间。 */
    public static void exitAfter(final long delayMs) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                System.exit(0);
            }
        }, "deepshell-exit");
        t.setDaemon(false);
        t.start();
    }

    /** 重启助手入口：等旧进程退出后按原参数启动新的 DeepShell 进程。 */
    public static void runHelper(String[] args) {
        long parentPid = parseHelperPid(args);
        log("重启助手已启动，等待旧进程 " + parentPid + " 退出");
        if (!awaitOldProcessExit()) {
            log("等待旧进程退出超时，已取消重启；请手动启动 DeepShell");
            System.exit(1);
            return;
        }
        List<String> appArgs = new ArrayList<>();
        for (String arg : args) {
            if (arg == null || arg.startsWith(HELPER_PREFIX)) {
                continue;
            }
            // 自动重启不再弹新浏览器窗口，当前页面会在检测到服务恢复后自行刷新
            if (arg.startsWith("--deepshell.open-browser")) {
                continue;
            }
            // 外部调用链接属于一次性启动参数，重启后不再重复打开
            if (arg.startsWith("--deepshell.protocol-uri")
                    || arg.regionMatches(true, 0, "deepshell:", 0, 10)) {
                continue;
            }
            appArgs.add(arg);
        }
        appArgs.add("--deepshell.open-browser=false");

        List<String> command = baseCommand();
        command.addAll(appArgs);
        try {
            Thread.sleep(300);
            ProcessBuilder pb = new ProcessBuilder(command);
            pb.directory(new File(System.getProperty("user.dir")));
            pb.redirectErrorStream(true);
            pb.redirectOutput(ProcessBuilder.Redirect.appendTo(consoleLogFile().toFile()));
            Process process = pb.start();
            long pid = pidOf(process);
            updatePidFile(pid);
            log("DeepShell 已重新启动（新进程 " + (pid > 0 ? "pid " + pid : "已拉起") + "）");
        } catch (Exception e) {
            log("重新启动 DeepShell 失败: " + e);
            System.exit(1);
        }
    }

    private static long parseHelperPid(String[] args) {
        for (String arg : args) {
            if (arg != null && arg.startsWith(HELPER_PREFIX)) {
                try {
                    return Long.parseLong(arg.substring(HELPER_PREFIX.length()).trim());
                } catch (NumberFormatException ignore) {
                    return -1L;
                }
            }
        }
        return -1L;
    }

    private static boolean awaitOldProcessExit() {
        long deadline = System.currentTimeMillis() + PARENT_EXIT_TIMEOUT_MS;
        try (FileChannel channel = FileChannel.open(lockFile(),
                StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
            while (System.currentTimeMillis() < deadline) {
                FileLock lock = null;
                try {
                    lock = channel.tryLock();
                } catch (OverlappingFileLockException ignore) {
                    // 理论上不会出现：助手是独立进程
                } catch (Exception ignore) {
                    // 部分平台在文件被占用时抛 IOException，继续轮询即可
                }
                if (lock != null) {
                    lock.release();
                    return true;
                }
                Thread.sleep(250);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log("检测旧进程状态失败: " + e);
            return false;
        }
        return false;
    }

    private static List<String> baseCommand() {
        List<String> command = new ArrayList<>();
        // 绿色版用 jpackage 启动器重启，避免依赖 java.home / java.class.path 的布局
        java.nio.file.Path launcher = RuntimeSupport.launcher();
        if (launcher != null) {
            command.add(launcher.toAbsolutePath().toString());
            return command;
        }
        command.add(javaExecutable());
        // 复用当前 JVM 的 -D / -X / -javaagent 等参数，重启后的配置与启动方式保持一致
        command.addAll(ManagementFactory.getRuntimeMXBean().getInputArguments());
        String classPath = System.getProperty("java.class.path", "");
        File single = new File(classPath);
        if (single.isFile() && classPath.toLowerCase().endsWith(".jar")) {
            command.add("-jar");
            command.add(single.getAbsolutePath());
        } else {
            command.add("-cp");
            command.add(classPath);
            command.add("com.itdct.deepshell.DeepShellApplication");
        }
        return command;
    }

    private static String javaExecutable() {
        String home = System.getProperty("java.home");
        if (home != null && !home.isEmpty()) {
            File bin = new File(home, "bin");
            // Windows 上用 javaw 拉起，避免弹控制台窗口；新进程也不受原控制台关闭影响
            if (isWindows()) {
                File javaw = new File(bin, "javaw.exe");
                if (javaw.isFile()) {
                    return javaw.getAbsolutePath();
                }
            }
            File exe = new File(bin, isWindows() ? "java.exe" : "java");
            if (exe.isFile()) {
                return exe.getAbsolutePath();
            }
        }
        return "java";
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    private static long currentPid() {
        try {
            String name = ManagementFactory.getRuntimeMXBean().getName();
            int at = name.indexOf('@');
            return Long.parseLong(at > 0 ? name.substring(0, at) : name);
        } catch (Exception e) {
            return -1L;
        }
    }

    private static long pidOf(Process process) {
        try {
            // Java 9+ 公开了 pid()；项目按 Java 8 编译，这里用反射兼容两种运行时
            Method method = Process.class.getMethod("pid");
            Object value = method.invoke(process);
            if (value instanceof Long) {
                return (Long) value;
            }
        } catch (Exception ignore) {
            // Java 8 走下面的字段读取
        }
        try {
            Field field = process.getClass().getDeclaredField("pid");
            field.setAccessible(true);
            return field.getLong(process);
        } catch (Exception e) {
            return -1L;
        }
    }

    /** start.sh 会在数据目录写 pid 文件；重启后同步为新的进程号，保证 stop.sh 仍能停止服务。 */
    private static void updatePidFile(long pid) {
        if (pid <= 0) {
            return;
        }
        Path pidFile = DataDir.root().resolve("deepshell.pid");
        if (!Files.exists(pidFile)) {
            return;
        }
        try {
            Files.write(pidFile, (pid + System.lineSeparator()).getBytes(StandardCharsets.US_ASCII));
        } catch (Exception e) {
            log("更新 " + pidFile + " 失败: " + e);
        }
    }

    private static Path lockFile() {
        return DataDir.root().resolve(".restart.lock");
    }

    private static Path logFile() {
        return DataDir.root().resolve("logs").resolve("restart.log");
    }

    private static Path consoleLogFile() {
        return DataDir.root().resolve("logs").resolve("console.log");
    }

    private static synchronized void log(String message) {
        try {
            Path file = logFile();
            Files.createDirectories(file.getParent());
            String line = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss")
                    .format(new Date()) + " " + message + System.lineSeparator();
            Files.write(file, line.getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (Exception ignore) {
            // 日志写入失败不影响重启流程
        }
    }
}
