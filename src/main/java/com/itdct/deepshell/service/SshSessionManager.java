package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.StatsSnapshot;
import com.itdct.deepshell.entity.SshConnection;
import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * SSH 会话管理：建立连接、Shell 通道、输出泵线程、保活与资源回收
 */
@Slf4j
@Service
public class SshSessionManager {

    private final ConnectionService connectionService;
    private final CryptoService cryptoService;
    private final Map<String, SshSession> sessions = new ConcurrentHashMap<>();

    public SshSessionManager(ConnectionService connectionService, CryptoService cryptoService) {
        this.connectionService = connectionService;
        this.cryptoService = cryptoService;
    }

    public static class SshSession {
        @Getter
        private final String id = UUID.randomUUID().toString().replace("-", "");
        @Getter
        private final Long connectionId;
        @Getter
        private final String name;
        @Getter
        private final Session jsch;
        @Getter
        private final ChannelShell shell;
        private final OutputStream stdin;
        private final InputStream stdout;
        @Getter
        private final AtomicLong lastActive = new AtomicLong(System.currentTimeMillis());
        public volatile Consumer<byte[]> onData;
        public volatile Consumer<String> onClosed;
        public volatile Consumer<StatsSnapshot> onStats;
        /** 终端当前目录变化回调（跟随 cd） */
        public volatile Consumer<String> onCwd;

        final StatsSampler.Prev statsPrev = new StatsSampler.Prev();
        int statsFail;
        volatile boolean monitorOff;
        final Object statsLock = new Object();

        /** 交互 shell 的 PID（异步探测），用于读取 /proc/<pid>/cwd */
        volatile Long shellPid;
        volatile String lastCwd;
        int cwdFail;

        private volatile ChannelSftp sftp;
        private volatile boolean closed;
        public final Object sftpLock = new Object();

        SshSession(Long connectionId, String name, Session jsch, ChannelShell shell) throws Exception {
            this.connectionId = connectionId;
            this.name = name;
            this.jsch = jsch;
            this.shell = shell;
            this.stdin = shell.getOutputStream();
            this.stdout = shell.getInputStream();
        }

        public void write(byte[] data) throws Exception {
            synchronized (this) {
                stdin.write(data);
                stdin.flush();
            }
        }

        public void resize(int cols, int rows) {
            try {
                shell.setPtySize(clamp(cols, 20, 1000), clamp(rows, 5, 300), 0, 0);
            } catch (Exception ignore) {
            }
        }

        ChannelSftp sftpChannel() {
            return sftp;
        }

        void setSftpChannel(ChannelSftp channel) {
            this.sftp = channel;
        }

        boolean isClosed() {
            return closed;
        }

        void markClosed() {
            this.closed = true;
        }
    }

    public SshSession open(Long connectionId, int cols, int rows) throws Exception {
        SshConnection cfg = connectionService.get(connectionId);
        JSch jsch = new JSch();

        if ("KEY".equalsIgnoreCase(cfg.getAuthType())) {
            if (cfg.getKeyPath() == null || cfg.getKeyPath().trim().isEmpty()) {
                throw new IllegalArgumentException("未配置私钥文件路径");
            }
            String passphrase = cryptoService.decrypt(cfg.getPassphraseEnc());
            jsch.addIdentity(cfg.getKeyPath().trim(),
                    passphrase == null ? null : passphrase.getBytes(StandardCharsets.UTF_8));
        }

        Session session = jsch.getSession(cfg.getUsername(), cfg.getHost(), cfg.getPort());
        if (!"KEY".equalsIgnoreCase(cfg.getAuthType())) {
            String password = cryptoService.decrypt(cfg.getPasswordEnc());
            if (password == null) {
                throw new IllegalArgumentException("该连接未保存密码，请先编辑连接并补全密码");
            }
            session.setPassword(password);
        }
        Properties config = new Properties();
        config.put("StrictHostKeyChecking", "no");
        config.put("PreferredAuthentications",
                "KEY".equalsIgnoreCase(cfg.getAuthType()) ? "publickey" : "password,keyboard-interactive");
        session.setConfig(config);
        session.setServerAliveInterval(30000);
        session.setServerAliveCountMax(6);
        session.connect(15000);

        ChannelShell shell = (ChannelShell) session.openChannel("shell");
        shell.setPtyType("xterm-256color");
        shell.setPtySize(clamp(cols, 20, 1000), clamp(rows, 5, 300), 0, 0);
        shell.connect(8000);

        SshSession s = new SshSession(connectionId, cfg.getName(), session, shell);
        sessions.put(s.getId(), s);
        startPump(s);
        scheduleShellDiscovery(s);
        log.info("SSH 会话已建立: {} -> {}@{}:{}", s.getId(), cfg.getUsername(), cfg.getHost(), cfg.getPort());
        return s;
    }

    /**
     * 探测交互 shell 的 PID：exec 通道的 shell 与交互 shell 同为 sshd 的子进程，
     * 取 ppid 相同且 stdin 挂在 pty 上的那个（纯 /proc 实现，不依赖 ps 版本）。
     */
    private static final String SHELL_PID_SCRIPT =
            "export LC_ALL=C 2>/dev/null; "
                    + "S=$(sed 's/^[^)]*) //' /proc/$$/stat 2>/dev/null | awk '{print $2}'); "
                    + "awk -v s=\"$S\" '{ i=index($0, \")\"); r=substr($0, i+2); split(r, a, \" \"); if (a[2]==s) print $1 }' "
                    + "/proc/[0-9]*/stat 2>/dev/null | while read p; do "
                    + "case \"$(readlink /proc/$p/fd/0 2>/dev/null)\" in /dev/pts/*|/dev/tty*) echo \"$p\"; break;; esac; done";

    private void scheduleShellDiscovery(SshSession s) {
        statsExecutor.schedule(() -> {
            for (int i = 0; i < 8 && !s.isClosed() && s.shellPid == null && s.onCwd != null; i++) {
                try {
                    String out = execCapture(s, SHELL_PID_SCRIPT, 3000);
                    String t = out == null ? "" : out.trim();
                    if (t.matches("\\d+")) {
                        s.shellPid = Long.parseLong(t);
                        log.info("shell pid 探测成功 session={} pid={}", s.getId(), s.shellPid);
                        return;
                    }
                } catch (Exception ignore) {
                    // 会话未就绪时重试
                }
                try {
                    Thread.sleep(1200);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }, 1, TimeUnit.SECONDS);
    }

    private void startPump(SshSession s) {
        Thread t = new Thread(() -> {
            byte[] buf = new byte[32768];
            String reason = "远程连接已关闭";
            try {
                int n;
                while ((n = s.stdout.read(buf)) != -1) {
                    s.getLastActive().set(System.currentTimeMillis());
                    Consumer<byte[]> cb = s.onData;
                    if (cb != null) {
                        cb.accept(Arrays.copyOf(buf, n));
                    }
                }
            } catch (Exception e) {
                reason = "连接中断: " + e.getMessage();
            }
            close(s.getId(), reason);
        }, "ssh-pump-" + s.getId());
        t.setDaemon(true);
        t.start();
    }

    /* ---------- 服务器监控采样（CPU / 内存 / 网络） ---------- */

    private final ScheduledExecutorService statsExecutor = Executors.newScheduledThreadPool(4, r -> {
        Thread t = new Thread(r, "ssh-stats");
        t.setDaemon(true);
        return t;
    });

    @PostConstruct
    void startStatsPolling() {
        statsExecutor.scheduleWithFixedDelay(this::pollAllStats, 5, 3, TimeUnit.SECONDS);
    }

    private void pollAllStats() {
        for (SshSession s : sessions.values()) {
            if (s.isClosed()) {
                continue;
            }
            try {
                if (!s.monitorOff && s.onStats != null) {
                    statsExecutor.submit(() -> pollStatsOnce(s));
                }
                if (s.shellPid != null && s.onCwd != null) {
                    statsExecutor.submit(() -> pollCwdOnce(s));
                }
            } catch (RejectedExecutionException ignore) {
            }
        }
    }

    private void pollCwdOnce(SshSession s) {
        Long pid = s.shellPid;
        if (pid == null || s.isClosed() || s.onCwd == null) {
            return;
        }
        try {
            String out = execCapture(s, "readlink /proc/" + pid + "/cwd 2>/dev/null", 3000);
            String cwd = out == null ? "" : out.trim();
            if (cwd.isEmpty() || cwd.startsWith("readlink")) {
                throw new IllegalStateException("cwd 不可读");
            }
            s.cwdFail = 0;
            if (!cwd.equals(s.lastCwd)) {
                s.lastCwd = cwd;
                Consumer<String> cb = s.onCwd;
                if (cb != null) {
                    cb.accept(cwd);
                }
            }
        } catch (Exception e) {
            if (++s.cwdFail >= 5) {
                // shell 已退出或不可读，停止目录跟随（不影响其余功能）
                s.shellPid = null;
                log.info("目录跟随已停用 session={}", s.getId());
            }
        }
    }

    private void pollStatsOnce(SshSession s) {
        synchronized (s.statsLock) {
            if (s.isClosed() || s.monitorOff) {
                return;
            }
            try {
                String raw = execSample(s);
                StatsSnapshot snap = StatsSampler.compute(s.statsPrev, raw, System.currentTimeMillis());
                s.statsFail = 0;
                Consumer<StatsSnapshot> cb = s.onStats;
                if (cb != null) {
                    cb.accept(snap);
                }
            } catch (Exception e) {
                if (++s.statsFail >= 3) {
                    s.monitorOff = true;
                    log.info("监控已停用 session={}: {}", s.getId(), e.getMessage());
                    Consumer<StatsSnapshot> cb = s.onStats;
                    if (cb != null) {
                        cb.accept(StatsSnapshot.ofError("监控不可用（仅支持 Linux 服务器）"));
                    }
                }
            }
        }
    }

    private String execSample(SshSession s) throws Exception {
        return execCapture(s, StatsSampler.SAMPLE_SCRIPT, 4000);
    }

    /**
     * 在独立 exec 通道执行命令并捕获输出（stdout/stderr 合并），不干扰交互终端
     */
    public String execCapture(SshSession s, String command, long timeoutMs) throws Exception {
        ChannelExec exec = (ChannelExec) s.getJsch().openChannel("exec");
        exec.setCommand(command);
        InputStream in = exec.getInputStream();
        exec.connect(5000);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        long deadline = System.currentTimeMillis() + timeoutMs;
        try {
            int n;
            while ((n = in.read(buf)) != -1) {
                bos.write(buf, 0, n);
                if (System.currentTimeMillis() > deadline) {
                    break;
                }
            }
        } finally {
            exec.disconnect();
        }
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    public SshSession get(String sessionId) {
        SshSession s = sessions.get(sessionId);
        if (s == null || s.isClosed()) {
            throw new IllegalStateException("会话不存在或已断开，请重新连接");
        }
        return s;
    }

    public boolean exists(String sessionId) {
        return sessionId != null && sessions.containsKey(sessionId);
    }

    public void close(String sessionId) {
        close(sessionId, null);
    }

    private void close(String sessionId, String reason) {
        SshSession s = sessions.remove(sessionId);
        if (s == null) {
            return;
        }
        s.markClosed();
        try {
            ChannelSftp c = s.sftpChannel();
            if (c != null && c.isConnected()) {
                c.disconnect();
            }
        } catch (Exception ignore) {
        }
        try {
            s.getShell().disconnect();
        } catch (Exception ignore) {
        }
        try {
            s.getJsch().disconnect();
        } catch (Exception ignore) {
        }
        log.info("SSH 会话已关闭: {} {}", sessionId, reason == null ? "" : "(" + reason + ")");
        Consumer<String> cb = s.onClosed;
        if (reason != null && cb != null) {
            cb.accept(reason);
        }
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
