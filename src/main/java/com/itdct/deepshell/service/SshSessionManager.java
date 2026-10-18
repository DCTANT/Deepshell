package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.ConnectionForm;
import com.itdct.deepshell.dto.StatsSnapshot;
import com.itdct.deepshell.entity.SshConnection;
import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/**
 * SSH 会话管理：建立连接、Shell 通道、输出泵线程、保活与资源回收
 */
@Slf4j
@Service
public class SshSessionManager {

    /** WebSocket 断开后会话保留时间；期间可用同一客户端会话键重新附着 */
    private static final long DETACH_TTL_MS = 10 * 60 * 1000L;
    private static final int MAX_DETACHED_SESSIONS = 50;
    private static final int MAX_OUTPUT_BUFFER_BYTES = 256 * 1024;

    private final ConnectionService connectionService;
    private final CryptoService cryptoService;
    private final Map<String, SshSession> sessions = new ConcurrentHashMap<>();
    /** 浏览器侧会话键 -> 服务端会话 id，用于 F5 / 断网后重新附着 */
    private final Map<String, String> bindings = new ConcurrentHashMap<>();

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
        private final String clientKey;
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

        /** 当前附着的 WebSocket 标识，避免旧连接关闭时误挂起新连接 */
        private volatile String attachmentId;
        private volatile boolean attached = true;
        private volatile long detachedAt;
        private volatile ScheduledFuture<?> cleanupTask;

        /** 最近输出环形缓冲，重连时回放，避免 F5 后终端空白 */
        private final Deque<byte[]> outputChunks = new ArrayDeque<>();
        private long outputBytes;
        private final Object outputLock = new Object();

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

        SshSession(Long connectionId, String name, String clientKey,
                   Session jsch, ChannelShell shell) throws Exception {
            this.connectionId = connectionId;
            this.name = name;
            this.clientKey = clientKey;
            this.jsch = jsch;
            this.shell = shell;
            this.stdin = shell.getOutputStream();
            this.stdout = shell.getInputStream();
        }

        public boolean isAttached() {
            return attached;
        }

        void markAttached(String attachmentId) {
            this.attachmentId = attachmentId;
            this.attached = true;
            this.detachedAt = 0;
            cancelCleanup();
        }

        void markDetached() {
            this.attached = false;
            this.detachedAt = System.currentTimeMillis();
            this.attachmentId = null;
        }

        void cancelCleanup() {
            ScheduledFuture<?> task = cleanupTask;
            if (task != null) {
                task.cancel(false);
                cleanupTask = null;
            }
        }

        void setCleanupTask(ScheduledFuture<?> task) {
            this.cleanupTask = task;
        }

        String currentAttachment() {
            return attachmentId;
        }

        public boolean isAttachment(String id) {
            return id != null && id.equals(attachmentId);
        }

        void detachCallbacks() {
            synchronized (outputLock) {
                onData = null;
            }
            onStats = null;
            onCwd = null;
            onClosed = null;
        }

        /** 传输通道输出：始终写入缓冲，附着时同步转发给 WebSocket */
        void deliver(byte[] data) {
            Consumer<byte[]> callback;
            synchronized (outputLock) {
                appendOutputLocked(data);
                callback = onData;
            }
            if (callback != null) {
                callback.accept(data);
            }
        }

        /**
         * 重新附着：在锁内先回放缓冲再切换回调，保证回放与实时输出不重复、不丢序。
         */
        public void attach(Consumer<byte[]> dataCallback, Consumer<byte[]> snapshotCallback) {
            synchronized (outputLock) {
                if (closed) {
                    throw new IllegalStateException("会话已关闭");
                }
                byte[] snapshot = snapshotOutputLocked();
                if (snapshot.length > 0 && snapshotCallback != null) {
                    snapshotCallback.accept(snapshot);
                }
                onData = dataCallback;
            }
        }

        private void appendOutputLocked(byte[] data) {
            if (data == null || data.length == 0) {
                return;
            }
            if (data.length >= MAX_OUTPUT_BUFFER_BYTES) {
                outputChunks.clear();
                outputBytes = 0;
                byte[] tail = Arrays.copyOfRange(data, data.length - MAX_OUTPUT_BUFFER_BYTES, data.length);
                outputChunks.addLast(tail);
                outputBytes = tail.length;
                return;
            }
            outputChunks.addLast(data);
            outputBytes += data.length;
            while (outputBytes > MAX_OUTPUT_BUFFER_BYTES && !outputChunks.isEmpty()) {
                byte[] first = outputChunks.removeFirst();
                outputBytes -= first.length;
            }
        }

        private byte[] snapshotOutputLocked() {
            if (outputBytes <= 0) {
                return new byte[0];
            }
            byte[] all = new byte[(int) outputBytes];
            int pos = 0;
            for (byte[] chunk : outputChunks) {
                System.arraycopy(chunk, 0, all, pos, chunk.length);
                pos += chunk.length;
            }
            return all;
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
        return openOrAttach(connectionId, cols, rows, null, null).session;
    }

    /** 打开结果：新建会话或重新附着到已挂起的旧会话 */
    public static class OpenResult {
        public final SshSession session;
        public final boolean reattached;

        OpenResult(SshSession session, boolean reattached) {
            this.session = session;
            this.reattached = reattached;
        }
    }

    /**
     * 按浏览器会话键打开或重新附着：F5 / 浏览器断网后优先复用服务端仍存活的 SSH 会话，
     * 避免前台命令被直接杀掉。连接参数变化或会话已关闭时新建。
     */
    public OpenResult openOrAttach(Long connectionId, int cols, int rows,
                                   String clientKey, String attachmentId) throws Exception {
        String key = clientKey == null ? null : clientKey.trim();
        if (key != null && !key.isEmpty()) {
            String sid = bindings.get(key);
            SshSession existing = sid == null ? null : sessions.get(sid);
            if (existing != null && !existing.isClosed()) {
                if (Objects.equals(existing.getConnectionId(), connectionId)) {
                    existing.markAttached(attachmentId);
                    existing.resize(cols, rows);
                    existing.getLastActive().set(System.currentTimeMillis());
                    if (existing.shellPid == null) {
                        scheduleShellDiscovery(existing);
                    }
                    log.info("SSH 会话重新附着: {} -> {}", existing.getId(), key);
                    return new OpenResult(existing, true);
                }
                close(existing.getId(), "连接参数已变化");
            } else if (sid != null) {
                bindings.remove(key, sid);
            }
        }
        SshSession s = createSession(connectionId, cols, rows, key);
        s.markAttached(attachmentId);
        if (key != null && !key.isEmpty()) {
            bindings.put(key, s.getId());
        }
        return new OpenResult(s, false);
    }

    /**
     * 测试连接参数：只建立一次 SSH 会话随即断开，不进入会话管理。
     * 编辑态留空的密码 / 私钥口令沿用已保存连接中的值。
     */
    public Map<String, Object> test(ConnectionForm f) {
        String host = trimToNull(f.getHost());
        if (host == null) {
            throw new IllegalArgumentException("请输入主机地址");
        }
        String username = trimToNull(f.getUsername());
        if (username == null) {
            throw new IllegalArgumentException("请输入用户名");
        }
        int port = f.getPort() == null ? 22 : f.getPort();
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("端口范围不正确");
        }
        String authType = trimToNull(f.getAuthType());
        authType = authType == null ? "PASSWORD" : authType.toUpperCase(Locale.ROOT);

        SshConnection saved = f.getId() == null ? null : connectionService.get(f.getId());

        String password = f.getPassword();
        if (password == null || password.isEmpty()) {
            password = saved == null ? null : cryptoService.decrypt(saved.getPasswordEnc());
        }
        String keyPath = trimToNull(f.getKeyPath());
        if (keyPath == null && saved != null) {
            keyPath = saved.getKeyPath();
        }
        String passphrase = f.getPassphrase();
        if (passphrase == null || passphrase.isEmpty()) {
            passphrase = saved == null ? null : cryptoService.decrypt(saved.getPassphraseEnc());
        }

        Session session = null;
        long start = System.currentTimeMillis();
        try {
            JSch jsch = new JSch();
            if ("KEY".equals(authType)) {
                if (keyPath == null) {
                    throw new IllegalArgumentException("未配置私钥文件路径");
                }
                jsch.addIdentity(keyPath, passphrase == null || passphrase.isEmpty()
                        ? null : passphrase.getBytes(StandardCharsets.UTF_8));
            }
            session = jsch.getSession(username, host, port);
            if (!"KEY".equals(authType)) {
                if (password == null || password.isEmpty()) {
                    throw new IllegalArgumentException("未配置密码");
                }
                session.setPassword(password);
            }
            Properties config = new Properties();
            config.put("StrictHostKeyChecking", "no");
            config.put("PreferredAuthentications",
                    "KEY".equals(authType) ? "publickey" : "password,keyboard-interactive");
            session.setConfig(config);
            session.connect(10000);

            long elapsed = System.currentTimeMillis() - start;
            String version = session.getServerVersion();
            if (version != null && version.startsWith("SSH-2.0-")) {
                version = version.substring("SSH-2.0-".length());
            }
            StringBuilder msg = new StringBuilder("连接成功，耗时 ")
                    .append(String.format(Locale.ROOT, "%.1f", elapsed / 1000.0)).append(" 秒");
            if (version != null && !version.isEmpty()) {
                msg.append("，服务端 ").append(version);
            }
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("message", msg.toString());
            result.put("elapsedMs", elapsed);
            result.put("serverVersion", version);
            return result;
        } catch (JSchException e) {
            throw new IllegalArgumentException(friendlyError(e));
        } finally {
            if (session != null) {
                session.disconnect();
            }
        }
    }

    private static String friendlyError(JSchException e) {
        String msg = e.getMessage() == null ? "" : e.getMessage();
        String lower = msg.toLowerCase(Locale.ROOT);
        if (lower.contains("auth fail") || lower.contains("auth cancel")) {
            return "认证失败：用户名、密码或私钥不正确";
        }
        if (lower.contains("unknownhost") || lower.contains("name or service not known")) {
            return "无法解析主机地址: " + msg;
        }
        if (lower.contains("connection refused")) {
            return "连接被拒绝：请检查端口与 SSH 服务是否开启";
        }
        if (lower.contains("timeout") || lower.contains("timed out")) {
            return "连接超时：请检查主机地址、端口与网络";
        }
        if (lower.contains("invalid privatekey") || lower.contains("no such file")) {
            return "私钥文件无法读取或格式不正确: " + msg;
        }
        return "连接失败: " + msg;
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private SshSession createSession(Long connectionId, int cols, int rows, String clientKey) throws Exception {
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

        SshSession s = new SshSession(connectionId, cfg.getName(), clientKey, session, shell);
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
                    s.deliver(Arrays.copyOf(buf, n));
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
        return execRaw(s, command, timeoutMs, Integer.MAX_VALUE, () -> false).output;
    }

    /** exec 通道原始执行结果（内部载体） */
    static class RawExec {
        volatile String output = "";
        volatile boolean done;
        volatile boolean aborted;
        volatile boolean cancelled;
        boolean truncated;
        boolean timedOut;
        int exitStatus = -1;
    }

    /**
     * exec 通道底层执行：读线程 + join 超时（静默卡死的命令也能超时退出），
     * 关闭 stdin 让读取标准输入的命令（如无参数 cat）立即收到 EOF 而不是挂死。
     */
    private RawExec execRaw(SshSession s, String command, long timeoutMs, int maxBytes,
                            BooleanSupplier cancelled) throws Exception {
        ChannelExec exec = (ChannelExec) s.getJsch().openChannel("exec");
        exec.setCommand(command);
        // 立即向远端 stdin 发 EOF：读取标准输入的命令（如无参数 cat）直接结束而不是挂起
        exec.setInputStream(null);
        InputStream in = exec.getInputStream();
        exec.connect(5000);
        RawExec r = new RawExec();
        Thread reader = new Thread(() -> {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            try {
                byte[] buf = new byte[8192];
                int n;
                while (!r.aborted && (n = in.read(buf)) != -1) {
                    long remain = maxBytes - bos.size();
                    if (n > remain) {
                        bos.write(buf, 0, (int) Math.max(0, remain));
                        r.truncated = true;
                        break;
                    }
                    bos.write(buf, 0, n);
                }
            } catch (Exception ignore) {
                // 超时断开通道会触发读取异常，按已读内容返回
            } finally {
                r.output = new String(bos.toByteArray(), StandardCharsets.UTF_8);
                r.done = true;
            }
        }, "ssh-exec-" + s.getId());
        reader.setDaemon(true);
        reader.start();
        long deadline = System.currentTimeMillis() + Math.max(1L, timeoutMs);
        while (!r.done && System.currentTimeMillis() < deadline) {
            if (cancelled != null && cancelled.getAsBoolean()) {
                r.cancelled = true;
                r.aborted = true;
                try {
                    exec.disconnect();
                } catch (Exception ignore) {
                    // 取消时断开通道，读线程会随之退出
                }
                break;
            }
            try {
                reader.join(200);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        if (!r.done && !r.cancelled) {
            r.aborted = true;
            r.timedOut = true;
        }
        r.exitStatus = exec.getExitStatus();
        exec.disconnect();
        if (!r.done) {
            try {
                reader.join(2000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        return r;
    }

    /** 带工作目录跟踪的 exec 执行结果（AI 终端用） */
    public static class ExecResult {
        public String output = "";
        public Integer exitCode;
        public String cwd;
        public boolean truncated;
        public boolean timedOut;
        public boolean cancelled;
    }

    private static final String END_MARK = "__DEEPSHELL_END__";
    private static final java.util.regex.Pattern END_RE =
            java.util.regex.Pattern.compile("__DEEPSHELL_END__(\\d+)__(.*)__");

    /**
     * 在独立 exec 通道执行命令，并附带退出码与执行后的工作目录：
     * 命令前先 cd 到给定目录，命令后打印标记行回传 $? 与 $PWD，下一跳可据此续跑。
     */
    public ExecResult execInShell(SshSession s, String command, String cwd, long timeoutMs, int maxBytes)
            throws Exception {
        return execInShell(s, command, cwd, timeoutMs, maxBytes, () -> false);
    }

    /** 可取消的 exec：cancelled 变为 true 时断开通道，终止捕获并尽快返回 */
    public ExecResult execInShell(SshSession s, String command, String cwd, long timeoutMs, int maxBytes,
                                  BooleanSupplier cancelled) throws Exception {
        return parseWrappedOutput(execRaw(s, wrapCommand(command, cwd), timeoutMs, maxBytes, cancelled));
    }

    /** 拆出命令输出（去掉标记行）、退出码与执行后的工作目录；标记缺失时用 JSch 退出码兜底 */
    static ExecResult parseWrappedOutput(RawExec raw) {
        ExecResult res = new ExecResult();
        res.truncated = raw.truncated;
        res.timedOut = raw.timedOut;
        res.cancelled = raw.cancelled;
        String out = raw.output == null ? "" : raw.output;
        int idx = out.lastIndexOf(END_MARK);
        if (idx >= 0) {
            java.util.regex.Matcher m = END_RE.matcher(out.substring(idx));
            if (m.find()) {
                try {
                    res.exitCode = Integer.parseInt(m.group(1));
                } catch (NumberFormatException ignore) {
                    // 保持 null，用 JSch 退出码兜底
                }
                String dir = m.group(2).trim();
                if (!dir.isEmpty()) {
                    res.cwd = dir;
                }
                out = out.substring(0, idx);
                if (out.endsWith("\n")) {
                    out = out.substring(0, out.length() - 1);
                }
                if (out.endsWith("\r")) {
                    out = out.substring(0, out.length() - 1);
                }
            }
        }
        if (res.exitCode == null && raw.exitStatus >= 0) {
            res.exitCode = raw.exitStatus;
        }
        res.output = out;
        return res;
    }

    static String wrapCommand(String command, String cwd) {
        StringBuilder sb = new StringBuilder();
        if (cwd != null && !cwd.trim().isEmpty()) {
            sb.append("cd ").append(shellQuote(cwd.trim()))
                    .append(" 2>/dev/null || cd \"$HOME\" 2>/dev/null || cd /\n");
        }
        sb.append(command);
        sb.append("\n__dsrc=$?; __dsp=$(pwd 2>/dev/null); ")
                .append("printf '\\n").append(END_MARK).append("%s__%s__\\n' \"$__dsrc\" \"$__dsp\"\n");
        return sb.toString();
    }

    private static String shellQuote(String v) {
        return "'" + v.replace("'", "'\\''") + "'";
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

    /**
     * WebSocket 断开时挂起会话：保留 SSH 连接与最近输出，10 分钟内可用同一客户端键重新附着。
     * attachmentId 用于避免旧连接关闭时误挂起刚附着的新连接。
     */
    public void detach(String sessionId, String attachmentId) {
        SshSession s = sessions.get(sessionId);
        if (s == null || s.isClosed() || !s.isAttached()) {
            return;
        }
        if (attachmentId != null && !attachmentId.equals(s.currentAttachment())) {
            return;
        }
        s.markDetached();
        s.detachCallbacks();
        enforceDetachedLimit();
        if (s.isClosed()) {
            return;
        }
        ScheduledFuture<?> task = statsExecutor.schedule(() -> {
            SshSession current = sessions.get(sessionId);
            if (current != null && !current.isClosed() && !current.isAttached()) {
                close(sessionId, "会话挂起超过 10 分钟");
            }
        }, DETACH_TTL_MS, TimeUnit.MILLISECONDS);
        s.setCleanupTask(task);
        log.info("SSH 会话已挂起，等待重新附着: {}", sessionId);
    }

    private void enforceDetachedLimit() {
        List<SshSession> detached = new ArrayList<>();
        for (SshSession s : sessions.values()) {
            if (!s.isClosed() && !s.isAttached()) {
                detached.add(s);
            }
        }
        int excess = detached.size() - MAX_DETACHED_SESSIONS;
        if (excess <= 0) {
            return;
        }
        detached.sort((a, b) -> Long.compare(a.detachedAt, b.detachedAt));
        for (int i = 0; i < excess; i++) {
            close(detached.get(i).getId(), "挂起会话过多，回收最旧会话");
        }
    }

    public void close(String sessionId) {
        close(sessionId, null);
    }

    private void close(String sessionId, String reason) {
        SshSession s = sessions.remove(sessionId);
        if (s == null) {
            return;
        }
        s.cancelCleanup();
        s.markClosed();
        if (s.getClientKey() != null) {
            bindings.remove(s.getClientKey(), sessionId);
        }
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
