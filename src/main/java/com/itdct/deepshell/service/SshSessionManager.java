package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.ConnectionForm;
import com.itdct.deepshell.dto.StatsSnapshot;
import com.itdct.deepshell.entity.SshConnection;
import com.jcraft.jsch.Channel;
import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.ProxyHTTP;
import com.jcraft.jsch.ProxySOCKS5;
import com.jcraft.jsch.Session;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
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
import java.util.concurrent.atomic.AtomicBoolean;
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
    private final HostKeyService hostKeyService;
    private final ObjectProvider<PortForwardService> portForwardProvider;
    private final Map<String, SshSession> sessions = new ConcurrentHashMap<>();
    /** 浏览器侧会话键 -> 服务端会话 id，用于 F5 / 断网后重新附着 */
    private final Map<String, String> bindings = new ConcurrentHashMap<>();

    public SshSessionManager(ConnectionService connectionService, CryptoService cryptoService,
                             HostKeyService hostKeyService,
                             ObjectProvider<PortForwardService> portForwardProvider) {
        this.connectionService = connectionService;
        this.cryptoService = cryptoService;
        this.hostKeyService = hostKeyService;
        this.portForwardProvider = portForwardProvider;
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
        private final Channel channel;
        /** 非空表示当前交互 shell 运行在 tmux 会话中 */
        @Getter
        private final String tmuxName;
        /** 建连时的提示（如未安装 tmux 回退为普通会话） */
        @Getter
        private final String notice;
        /** 包含跳板机在内的全部 SSH 传输会话（目标在最后） */
        @Getter
        private final List<Session> transportSessions;
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
        volatile boolean cwdTrackingOff;

        private volatile ChannelSftp sftp;
        private volatile boolean closed;
        public final Object sftpLock = new Object();

        SshSession(Long connectionId, String name, String clientKey,
                   Session jsch, Channel channel, String tmuxName, String notice,
                   List<Session> transportSessions) throws Exception {
            this.connectionId = connectionId;
            this.name = name;
            this.clientKey = clientKey;
            this.jsch = jsch;
            this.channel = channel;
            this.tmuxName = tmuxName;
            this.notice = notice;
            this.transportSessions = transportSessions;
            this.stdin = channel.getOutputStream();
            this.stdout = channel.getInputStream();
        }

        public boolean isTmux() {
            return tmuxName != null;
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
                int c = clamp(cols, 20, 1000);
                int r = clamp(rows, 5, 300);
                if (channel instanceof ChannelExec) {
                    ((ChannelExec) channel).setPtySize(c, r, 0, 0);
                } else if (channel instanceof ChannelShell) {
                    ((ChannelShell) channel).setPtySize(c, r, 0, 0);
                }
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
     * 轻量 SFTP 通道：优先复用同一连接已打开的 SSH 会话，
     * 没有可用会话时按保存的代理 / 跳板机链路临时建连；close 时只清理自己创建的资源。
     */
    public static class SftpHandle implements AutoCloseable {
        @Getter
        private final ChannelSftp channel;
        private final List<Session> ownedSessions;
        @Getter
        private final boolean reused;
        private final AtomicBoolean closed = new AtomicBoolean();

        SftpHandle(ChannelSftp channel, List<Session> ownedSessions, boolean reused) {
            this.channel = channel;
            this.ownedSessions = ownedSessions;
            this.reused = reused;
        }

        @Override
        public void close() {
            // 取消分发与目标线程的 finally 可能同时 close，只允许清理一次
            if (!closed.compareAndSet(false, true)) {
                return;
            }
            try {
                if (channel != null && channel.isConnected()) {
                    channel.disconnect();
                }
            } catch (Exception ignore) {
                // 忽略关闭异常
            }
            if (ownedSessions != null) {
                try {
                    disconnectAll(ownedSessions);
                } catch (Exception ignore) {
                    // 忽略关闭异常
                }
            }
        }
    }

    /**
     * 为批量文件分发打开一条独立 SFTP 通道：不创建交互 shell / tmux，
     * 已连接的服务器直接复用现有 SSH 通道，避免额外登录。
     */
    public SftpHandle openSftp(Long connectionId) throws Exception {
        if (connectionId == null) {
            throw new IllegalArgumentException("缺少连接");
        }
        SshSession live = findLiveSession(connectionId);
        if (live != null) {
            try {
                return new SftpHandle(openSftpChannel(live.getJsch()), null, true);
            } catch (Exception e) {
                log.debug("复用会话打开 SFTP 失败，改为新建连接 connection={}: {}",
                        connectionId, e.getMessage());
            }
        }
        SshConnection cfg = connectionService.get(connectionId);
        Transport transport = connectHops(hopsForSaved(cfg));
        try {
            return new SftpHandle(openSftpChannel(transport.target), transport.sessions, false);
        } catch (Exception e) {
            disconnectAll(transport.sessions);
            throw e;
        }
    }

    private SshSession findLiveSession(Long connectionId) {
        for (SshSession s : sessions.values()) {
            if (Objects.equals(s.getConnectionId(), connectionId)
                    && !s.isClosed()
                    && s.getJsch() != null
                    && s.getJsch().isConnected()) {
                return s;
            }
        }
        return null;
    }

    private static ChannelSftp openSftpChannel(Session session) throws Exception {
        ChannelSftp channel = (ChannelSftp) session.openChannel("sftp");
        try {
            channel.connect(10000);
            channel.setFilenameEncoding("UTF-8");
            return channel;
        } catch (Exception e) {
            try {
                channel.disconnect();
            } catch (Exception ignore) {
                // ignore
            }
            throw e;
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
                    if (existing.shellPid == null && !existing.isTmux()) {
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
     * 测试连接参数：按完整链路（代理 / 跳板机）建立一次连接随即断开，不进入会话管理。
     * 编辑态留空的密码、私钥口令、代理密码沿用已保存连接中的值。
     * 主机指纹未信任时返回 needTrust + hostKey，由前端确认后再测一次。
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
        SshConnection saved = f.getId() == null ? null : connectionService.get(f.getId());

        long start = System.currentTimeMillis();
        Transport transport = null;
        try {
            transport = connectHops(hopsForForm(f, saved));
            Session session = transport.target;
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
        } catch (HostKeyCheckException e) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("needTrust", true);
            result.put("hostKey", e.getInfo());
            return result;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (JSchException e) {
            throw new IllegalArgumentException(friendlyError(e));
        } catch (Exception e) {
            throw new IllegalArgumentException("连接失败: "
                    + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        } finally {
            if (transport != null) {
                disconnectAll(transport.sessions);
            }
        }
    }

    /* ---------- 连接链路：代理 / 多级跳板机 ---------- */

    private static class Hop {
        Long connectionId;
        String name;
        String host;
        int port = 22;
        String username;
        String authType = "PASSWORD";
        String password;
        String keyPath;
        String passphrase;
        String proxyType = "NONE";
        String proxyHost;
        Integer proxyPort;
        String proxyUsername;
        String proxyPassword;
        boolean target;
    }

    private static class Transport {
        final List<Session> sessions = new ArrayList<>();
        Session target;
    }

    private List<Hop> hopsForSaved(SshConnection cfg) {
        List<Hop> chain = new ArrayList<>();
        chain.add(hopFromSaved(cfg, true));
        appendJumpChain(chain, cfg.getJumpConnectionId(), cfg.getId());
        Collections.reverse(chain);
        return chain;
    }

    private List<Hop> hopsForForm(ConnectionForm f, SshConnection saved) {
        Hop target = new Hop();
        target.target = true;
        target.connectionId = saved == null ? null : saved.getId();
        target.name = trimToNull(f.getName()) != null ? f.getName().trim()
                : (saved == null ? "目标主机" : saved.getName());
        target.host = trimToNull(f.getHost());
        target.port = f.getPort() == null ? 22 : f.getPort();
        target.username = trimToNull(f.getUsername());
        String authType = trimToNull(f.getAuthType());
        if (authType == null && saved != null) {
            authType = saved.getAuthType();
        }
        target.authType = authType == null ? "PASSWORD" : authType.toUpperCase(Locale.ROOT);
        String password = f.getPassword();
        if ((password == null || password.isEmpty()) && saved != null) {
            password = cryptoService.decrypt(saved.getPasswordEnc());
        }
        target.password = password;
        String keyPath = trimToNull(f.getKeyPath());
        if (keyPath == null && saved != null) {
            keyPath = saved.getKeyPath();
        }
        target.keyPath = keyPath;
        String passphrase = f.getPassphrase();
        if ((passphrase == null || passphrase.isEmpty()) && saved != null) {
            passphrase = cryptoService.decrypt(saved.getPassphraseEnc());
        }
        target.passphrase = passphrase;

        String proxyType = trimToNull(f.getProxyType());
        if (proxyType == null && saved != null) {
            proxyType = saved.getProxyType();
        }
        target.proxyType = proxyType == null ? "NONE" : proxyType.toUpperCase(Locale.ROOT);
        String proxyHost = trimToNull(f.getProxyHost());
        if (proxyHost == null && saved != null) {
            proxyHost = saved.getProxyHost();
        }
        target.proxyHost = proxyHost;
        target.proxyPort = f.getProxyPort() != null ? f.getProxyPort()
                : (saved == null ? null : saved.getProxyPort());
        String proxyUser = trimToNull(f.getProxyUsername());
        if (proxyUser == null && saved != null) {
            proxyUser = saved.getProxyUsername();
        }
        target.proxyUsername = proxyUser;
        String proxyPassword = f.getProxyPassword();
        if ((proxyPassword == null || proxyPassword.isEmpty()) && saved != null) {
            proxyPassword = cryptoService.decrypt(saved.getProxyPasswordEnc());
        }
        target.proxyPassword = proxyPassword;

        List<Hop> chain = new ArrayList<>();
        chain.add(target);
        appendJumpChain(chain, f.getJumpConnectionId(), saved == null ? null : saved.getId());
        Collections.reverse(chain);
        return chain;
    }

    private Hop hopFromSaved(SshConnection c, boolean target) {
        Hop h = new Hop();
        h.target = target;
        h.connectionId = c.getId();
        h.name = c.getName();
        h.host = c.getHost();
        h.port = c.getPort() == null ? 22 : c.getPort();
        h.username = c.getUsername();
        h.authType = c.getAuthType() == null ? "PASSWORD" : c.getAuthType();
        h.password = cryptoService.decrypt(c.getPasswordEnc());
        h.keyPath = c.getKeyPath();
        h.passphrase = cryptoService.decrypt(c.getPassphraseEnc());
        h.proxyType = c.getProxyType() == null ? "NONE" : c.getProxyType();
        h.proxyHost = c.getProxyHost();
        h.proxyPort = c.getProxyPort();
        h.proxyUsername = c.getProxyUsername();
        h.proxyPassword = cryptoService.decrypt(c.getProxyPasswordEnc());
        return h;
    }

    private void appendJumpChain(List<Hop> chain, Long jumpId, Long selfId) {
        java.util.Set<Long> seen = new java.util.HashSet<>();
        Long cur = jumpId;
        int depth = 0;
        while (cur != null) {
            if (selfId != null && cur.equals(selfId)) {
                throw new IllegalArgumentException("跳板机链路不能包含当前连接自身");
            }
            if (!seen.add(cur)) {
                throw new IllegalArgumentException("跳板机链路存在循环引用");
            }
            if (++depth > 10) {
                throw new IllegalArgumentException("跳板机层级过深（最多 10 级）");
            }
            SshConnection jump = connectionService.get(cur);
            chain.add(hopFromSaved(jump, false));
            cur = jump.getJumpConnectionId();
        }
    }

    /**
     * 依次建立整条链路：外层（跳板机）先连，随后在上一跳开本地端口转发，
     * 下一跳通过 127.0.0.1:临时端口接入，最终返回目标会话。
     * 代理只作用于链路最外层连接。
     */
    private Transport connectHops(List<Hop> hops) throws Exception {
        Transport t = new Transport();
        try {
            int nextLocalPort = -1;
            for (int i = 0; i < hops.size(); i++) {
                Hop h = hops.get(i);
                boolean outermost = i == 0;
                String dialHost = outermost ? h.host : "127.0.0.1";
                int dialPort = outermost ? h.port : nextLocalPort;

                JSch jsch = new JSch();
                if ("KEY".equalsIgnoreCase(h.authType)) {
                    if (trimToNull(h.keyPath) == null) {
                        throw new IllegalArgumentException("跳板机 / 目标主机未配置私钥文件路径：" + h.name);
                    }
                    jsch.addIdentity(h.keyPath.trim(), h.passphrase == null || h.passphrase.isEmpty()
                            ? null : h.passphrase.getBytes(StandardCharsets.UTF_8));
                }
                Session session = jsch.getSession(h.username, dialHost, dialPort);
                session.setHostKeyAlias(h.host + ":" + h.port);
                HostKeyService.Repository hkRepo = hostKeyService.repository(h.host, h.port,
                        h.target ? "target" : "jump",
                        h.target ? "目标主机" : ("跳板机 " + h.name));
                session.setHostKeyRepository(hkRepo);
                if (!"KEY".equalsIgnoreCase(h.authType)) {
                    if (h.password == null || h.password.isEmpty()) {
                        throw new IllegalArgumentException((h.target ? "目标主机" : "跳板机 " + h.name)
                                + " 未配置密码");
                    }
                    session.setPassword(h.password);
                }
                if (outermost) {
                    applyProxy(session, h);
                }
                Properties config = new Properties();
                config.put("StrictHostKeyChecking", "yes");
                config.put("PreferredAuthentications",
                        "KEY".equalsIgnoreCase(h.authType) ? "publickey" : "password,keyboard-interactive");
                session.setConfig(config);
                session.setServerAliveInterval(30000);
                session.setServerAliveCountMax(6);
                try {
                    session.connect(15000);
                } catch (JSchException e) {
                    try {
                        session.disconnect();
                    } catch (Exception ignore) {
                    }
                    Map<String, Object> problem = hkRepo.getLastProblem();
                    if (problem != null) {
                        throw new HostKeyCheckException(problem);
                    }
                    String who = h.target ? "目标主机" : ("跳板机 " + h.name);
                    throw new IllegalArgumentException(who + "：" + friendlyError(e));
                }
                t.sessions.add(session);
                if (i < hops.size() - 1) {
                    Hop next = hops.get(i + 1);
                    nextLocalPort = session.setPortForwardingL("127.0.0.1", 0, next.host, next.port);
                }
            }
            t.target = t.sessions.get(t.sessions.size() - 1);
            return t;
        } catch (Exception e) {
            disconnectAll(t.sessions);
            throw e;
        }
    }

    private static void applyProxy(Session session, Hop h) {
        String type = h.proxyType == null ? "NONE" : h.proxyType.toUpperCase(Locale.ROOT);
        if ("NONE".equals(type) || type.isEmpty()) {
            return;
        }
        if (trimToNull(h.proxyHost) == null) {
            throw new IllegalArgumentException("已选择代理，但未填写代理地址");
        }
        if ("HTTP".equals(type)) {
            ProxyHTTP proxy = new ProxyHTTP(h.proxyHost.trim(),
                    h.proxyPort == null || h.proxyPort <= 0 ? 8080 : h.proxyPort);
            if (trimToNull(h.proxyUsername) != null) {
                proxy.setUserPasswd(h.proxyUsername.trim(),
                        h.proxyPassword == null ? "" : h.proxyPassword);
            }
            session.setProxy(proxy);
            return;
        }
        if ("SOCKS5".equals(type)) {
            ProxySOCKS5 proxy = new ProxySOCKS5(h.proxyHost.trim(),
                    h.proxyPort == null || h.proxyPort <= 0 ? 1080 : h.proxyPort);
            if (trimToNull(h.proxyUsername) != null) {
                proxy.setUserPasswd(h.proxyUsername.trim(),
                        h.proxyPassword == null ? "" : h.proxyPassword);
            }
            session.setProxy(proxy);
            return;
        }
        throw new IllegalArgumentException("不支持的代理类型: " + type);
    }

    private static void disconnectAll(List<Session> sessions) {
        for (int i = sessions.size() - 1; i >= 0; i--) {
            try {
                sessions.get(i).disconnect();
            } catch (Exception ignore) {
            }
        }
        sessions.clear();
    }

    private static String friendlyError(JSchException e) {
        String msg = e.getMessage() == null ? "" : e.getMessage();
        String lower = msg.toLowerCase(Locale.ROOT);
        if (lower.contains("auth fail") || lower.contains("auth cancel")) {
            return "认证失败：用户名、密码或私钥不正确";
        }
        if (lower.contains("proxy") || lower.contains("socks")) {
            return "代理连接失败: " + msg;
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
        Transport transport = null;
        try {
            // 先按代理 / 跳板机链路连到目标；主机指纹在每一跳分别校验
            transport = connectHops(hopsForSaved(cfg));
            Session session = transport.target;

            boolean persist = cfg.getPersistSession() == null || cfg.getPersistSession();
            String tmuxName = persist ? tmuxSessionName(connectionId, clientKey) : null;
            String notice = null;
            Channel channel;
            if (tmuxName != null) {
                boolean hasTmux;
                try {
                    hasTmux = remoteHasTmux(session);
                } catch (Exception e) {
                    log.debug("tmux 探测失败 session={}: {}", connectionId, e.getMessage());
                    hasTmux = false;
                }
                if (hasTmux) {
                    ChannelExec exec = (ChannelExec) session.openChannel("exec");
                    exec.setPty(true);
                    exec.setPtyType("xterm-256color");
                    exec.setPtySize(clamp(cols, 20, 1000), clamp(rows, 5, 300), 0, 0);
                    exec.setCommand("exec tmux new-session -A -s " + shellQuote(tmuxName));
                    exec.connect(8000);
                    channel = exec;
                } else {
                    notice = "已开启持久会话，但目标服务器未安装 tmux，当前使用普通会话";
                    tmuxName = null;
                    channel = openShell(session, cols, rows);
                }
            } else {
                channel = openShell(session, cols, rows);
            }

            SshSession s = new SshSession(connectionId, cfg.getName(), clientKey, session,
                    channel, tmuxName, notice, transport.sessions);
            sessions.put(s.getId(), s);
            startPump(s);
            if (tmuxName == null) {
                scheduleShellDiscovery(s);
            }
            try {
                PortForwardService pf = portForwardProvider.getIfAvailable();
                if (pf != null) {
                    pf.onSessionOpened(s);
                }
            } catch (Exception e) {
                log.warn("自动启动端口转发失败 session={}: {}", s.getId(), e.getMessage());
            }
            log.info("SSH 会话已建立: {} -> {}@{}:{} tmux={}", s.getId(), cfg.getUsername(),
                    cfg.getHost(), cfg.getPort(), tmuxName == null ? "-" : tmuxName);
            return s;
        } catch (Exception e) {
            if (transport != null) {
                disconnectAll(transport.sessions);
            }
            throw e;
        }
    }

    private Channel openShell(Session session, int cols, int rows) throws JSchException {
        ChannelShell shell = (ChannelShell) session.openChannel("shell");
        shell.setPtyType("xterm-256color");
        shell.setPtySize(clamp(cols, 20, 1000), clamp(rows, 5, 300), 0, 0);
        shell.connect(8000);
        return shell;
    }

    /** 持久会话名按“连接 + 浏览器标签会话键”生成，程序重启后同一标签可附着回原 tmux 会话 */
    private static String tmuxSessionName(Long connectionId, String clientKey) {
        String key = clientKey == null ? "" : clientKey.replaceAll("[^A-Za-z0-9]", "");
        if (key.isEmpty()) {
            key = UUID.randomUUID().toString().replace("-", "");
        }
        if (key.length() > 40) {
            key = key.substring(0, 40);
        }
        return "deepshell_" + connectionId + "_" + key;
    }

    private boolean remoteHasTmux(Session session) {
        ChannelExec exec = null;
        try {
            exec = (ChannelExec) session.openChannel("exec");
            exec.setCommand("command -v tmux >/dev/null 2>&1 && echo yes");
            exec.setInputStream(null);
            final InputStream in = exec.getInputStream();
            exec.connect(5000);
            final ByteArrayOutputStream bos = new ByteArrayOutputStream();
            Thread reader = new Thread(() -> {
                try {
                    byte[] buf = new byte[64];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        bos.write(buf, 0, n);
                    }
                } catch (Exception ignore) {
                    // 探测失败按未安装 tmux 处理
                }
            }, "ssh-tmux-probe");
            reader.setDaemon(true);
            reader.start();
            reader.join(3000);
            return "yes".equals(new String(bos.toByteArray(), StandardCharsets.UTF_8).trim());
        } catch (Exception e) {
            return false;
        } finally {
            if (exec != null) {
                try {
                    exec.disconnect();
                } catch (Exception ignore) {
                }
            }
        }
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
                if (s.onCwd != null && !s.cwdTrackingOff
                        && (s.tmuxName != null || s.shellPid != null)) {
                    statsExecutor.submit(() -> pollCwdOnce(s));
                }
            } catch (RejectedExecutionException ignore) {
            }
        }
    }

    private void pollCwdOnce(SshSession s) {
        if (s.isClosed() || s.onCwd == null || s.cwdTrackingOff) {
            return;
        }
        try {
            String cwd;
            if (s.tmuxName != null) {
                // tmux 里的 shell 不是 sshd 的子进程，改用 pane 当前路径
                String out = execCapture(s, "tmux display-message -p -t "
                        + shellQuote(s.tmuxName) + " '#{pane_current_path}' 2>/dev/null", 3000);
                cwd = out == null ? "" : out.trim();
            } else {
                Long pid = s.shellPid;
                if (pid == null) {
                    return;
                }
                String out = execCapture(s, "readlink /proc/" + pid + "/cwd 2>/dev/null", 3000);
                cwd = out == null ? "" : out.trim();
                if (!cwd.isEmpty() && cwd.startsWith("readlink")) {
                    cwd = "";
                }
            }
            if (cwd.isEmpty() || !cwd.startsWith("/")) {
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
                s.cwdTrackingOff = true;
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

    /** 用户主动关闭标签：连同远程 tmux 会话一起清理 */
    public void close(String sessionId) {
        close(sessionId, null, true);
    }

    /** 内部断开（F5 超时 / 远端中断 / 参数变化）：保留 tmux，便于重新附着 */
    private void close(String sessionId, String reason) {
        close(sessionId, reason, false);
    }

    private void close(String sessionId, String reason, boolean cleanupPersistent) {
        SshSession s = sessions.remove(sessionId);
        if (s == null) {
            return;
        }
        s.cancelCleanup();
        if (cleanupPersistent && s.isTmux() && !s.isClosed()) {
            try {
                execCapture(s, "tmux kill-session -t " + shellQuote(s.getTmuxName()) + " 2>/dev/null", 2000);
            } catch (Exception e) {
                log.debug("清理 tmux 会话失败 {}: {}", s.getTmuxName(), e.getMessage());
            }
        }
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
            Channel ch = s.getChannel();
            if (ch != null && ch.isConnected()) {
                ch.disconnect();
            }
        } catch (Exception ignore) {
        }
        disconnectAll(s.getTransportSessions());
        try {
            PortForwardService pf = portForwardProvider.getIfAvailable();
            if (pf != null) {
                pf.onSessionClosed(sessionId);
            }
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
