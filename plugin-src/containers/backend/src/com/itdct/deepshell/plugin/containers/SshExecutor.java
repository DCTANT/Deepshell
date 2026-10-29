package com.itdct.deepshell.plugin.containers;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.HostKey;
import com.jcraft.jsch.HostKeyRepository;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.UserInfo;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Properties;

/**
 * Docker over SSH：使用 JSch 连接远端，执行远端 docker 命令。
 *
 * <p>主机密钥采用首次信任（TOFU）：第一次连接返回指纹，前端确认后写入
 * 插件数据目录的 known_hosts.properties；之后密钥变化会直接拒绝连接。</p>
 */
final class SshExecutor implements CommandRunner.Executor {

    static final class TrustRequiredException extends Exception {
        final String host;
        final String fingerprint;
        final String keyType;

        TrustRequiredException(String host, String fingerprint, String keyType) {
            super("首次连接需要确认主机指纹");
            this.host = host;
            this.fingerprint = fingerprint;
            this.keyType = keyType;
        }
    }

    private final String host;
    private final int port;
    private final String user;
    private final String password;
    private final byte[] privateKey;
    private final String passphrase;
    private final List<String> prefix;
    private final int timeoutMs;
    private final HostKeyStore hostKeys;
    private final boolean trustHostKey;

    private Session session;

    SshExecutor(String host, int port, String user, String password, byte[] privateKey,
                String passphrase, List<String> prefix, int timeoutMs, HostKeyStore hostKeys,
                boolean trustHostKey) {
        this.host = host;
        this.port = port;
        this.user = user;
        this.password = password;
        this.privateKey = privateKey;
        this.passphrase = passphrase;
        this.prefix = prefix;
        this.timeoutMs = timeoutMs;
        this.hostKeys = hostKeys;
        this.trustHostKey = trustHostKey;
    }

    void connect() throws Exception {
        if (session != null && session.isConnected()) {
            return;
        }
        session = openSession();
        try {
            session.connect(Math.min(timeoutMs, 15000));
        } catch (JSchException e) {
            HostKey offered = session.getHostKey();
            if (hostKeys.hasPending()) {
                if (isHostKeyChanged(e)) {
                    throw new IllegalArgumentException("SSH 主机密钥已变化，已拒绝连接。"
                            + "如果确认服务器已重装，请删除插件数据目录中的 known_hosts.properties 后重试");
                }
                if (trustHostKey) {
                    hostKeys.trustPending(offered);
                    session.disconnect();
                    session = openSession();
                    session.connect(Math.min(timeoutMs, 15000));
                    return;
                }
                String type = offered == null ? "unknown" : offered.getType();
                String fingerprint = offered == null
                        ? hostKeys.pendingFingerprint()
                        : fingerprint(decodeKey(offered.getKey()));
                throw new TrustRequiredException(host, fingerprint, type);
            }
            throw new IllegalArgumentException("SSH 连接失败: " + e.getMessage());
        }
    }

    private Session openSession() throws JSchException {
        JSch jsch = new JSch();
        if (privateKey != null && privateKey.length > 0) {
            byte[] pass = passphrase == null || passphrase.isEmpty()
                    ? null : passphrase.getBytes(StandardCharsets.UTF_8);
            jsch.addIdentity("deepshell-containers", privateKey, null, pass);
        }
        Session s = jsch.getSession(user, host, port);
        if (password != null && !password.isEmpty()) {
            s.setPassword(password);
        }
        Properties config = new Properties();
        config.put("StrictHostKeyChecking", "yes");
        config.put("PreferredAuthentications", "publickey,password,keyboard-interactive");
        config.put("ServerAliveInterval", "15000");
        config.put("ServerAliveCountMax", "3");
        s.setConfig(config);
        s.setHostKeyRepository(hostKeys);
        s.setUserInfo(new UserInfo() {
            @Override
            public String getPassphrase() {
                return passphrase;
            }

            @Override
            public String getPassword() {
                return password;
            }

            @Override
            public boolean promptPassword(String message) {
                return password != null && !password.isEmpty();
            }

            @Override
            public boolean promptPassphrase(String message) {
                return passphrase != null && !passphrase.isEmpty();
            }

            @Override
            public boolean promptYesNo(String message) {
                return false;
            }

            @Override
            public void showMessage(String message) {
                // 无需弹窗
            }
        });
        return s;
    }

    @Override
    public synchronized CommandRunner.Result run(List<String> args) throws Exception {
        return run(args, timeoutMs);
    }

    @Override
    public synchronized CommandRunner.Result run(List<String> args, int commandTimeoutMs) throws Exception {
        connect();
        long start = System.currentTimeMillis();
        StringBuilder command = new StringBuilder();
        for (String token : prefix) {
            if (command.length() > 0) {
                command.append(' ');
            }
            command.append(CommandRunner.shellQuote(token));
        }
        for (String arg : args) {
            if (command.length() > 0) {
                command.append(' ');
            }
            command.append(CommandRunner.shellQuote(arg));
        }
        command.append(" 2>&1");

        ChannelExec channel = (ChannelExec) session.openChannel("exec");
        LimitedBuffer buffer = new LimitedBuffer(CommandRunner.MAX_OUTPUT_BYTES);
        channel.setCommand(command.toString());
        channel.setInputStream(null);
        channel.setOutputStream(buffer);
        channel.connect(Math.min(timeoutMs, 15000));

        boolean timedOut = false;
        long deadline = start + commandTimeoutMs;
        while (!channel.isClosed()) {
            if (System.currentTimeMillis() > deadline) {
                timedOut = true;
                channel.disconnect();
                break;
            }
            try {
                Thread.sleep(40);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        int exit = channel.getExitStatus();
        channel.disconnect();
        String output = buffer.text();
        if (timedOut) {
            output += "\n[命令执行超过 " + timeoutMs + "ms，已终止]";
            return new CommandRunner.Result(124, output, "", System.currentTimeMillis() - start);
        }
        return new CommandRunner.Result(exit, output, "", System.currentTimeMillis() - start);
    }

    @Override
    public synchronized void close() {
        if (session != null) {
            try {
                session.disconnect();
            } catch (Exception ignore) {
                // ignore
            }
            session = null;
        }
    }

    private static boolean isHostKeyChanged(JSchException e) {
        String msg = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
        return msg.contains("changed") || msg.contains("modified");
    }

    private static String fingerprint(byte[] key) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(key);
            return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception e) {
            return "unknown";
        }
    }

    private static byte[] decodeKey(String encoded) {
        try {
            return Base64.getDecoder().decode(encoded);
        } catch (Exception e) {
            return new byte[0];
        }
    }

    /** 限制单次命令输出大小，避免日志把内存撑爆。 */
    private static final class LimitedBuffer extends OutputStream {
        private final int limit;
        private final ByteArrayOutputStream out = new ByteArrayOutputStream();
        private boolean truncated;

        LimitedBuffer(int limit) {
            this.limit = limit;
        }

        @Override
        public synchronized void write(int b) {
            if (out.size() < limit) {
                out.write(b);
            } else {
                truncated = true;
            }
        }

        @Override
        public synchronized void write(byte[] b, int off, int len) {
            int room = limit - out.size();
            if (room > 0) {
                out.write(b, off, Math.min(room, len));
            }
            if (len > room) {
                truncated = true;
            }
        }

        synchronized String text() {
            String text = new String(out.toByteArray(), StandardCharsets.UTF_8);
            if (truncated) {
                text += "\n[输出超过 " + (limit / 1024 / 1024) + "MB，已截断]";
            }
            return text;
        }
    }

    /** TOFU 主机密钥仓库，保存在插件数据目录，不包含任何密码。 */
    static final class HostKeyStore implements HostKeyRepository {
        private final Path file;
        private final Properties known = new Properties();
        private String pendingHost;
        private byte[] pendingKey;

        HostKeyStore(Path file) {
            this.file = file;
            load();
        }

        synchronized boolean hasPending() {
            return pendingHost != null && pendingKey != null;
        }

        synchronized String pendingFingerprint() {
            return pendingKey == null ? "unknown" : fingerprint(pendingKey);
        }

        synchronized void trustPending(HostKey offered) throws Exception {
            if (pendingHost == null || pendingKey == null) {
                return;
            }
            String type = offered == null ? "ssh-rsa" : offered.getType();
            known.setProperty(pendingHost, type + " " + Base64.getEncoder().encodeToString(pendingKey));
            Files.createDirectories(file.toAbsolutePath().getParent());
            java.io.Writer writer = Files.newBufferedWriter(file, StandardCharsets.UTF_8);
            try {
                known.store(writer, "DeepShell containers plugin known hosts");
            } finally {
                writer.close();
            }
            pendingHost = null;
            pendingKey = null;
        }

        @Override
        public synchronized int check(String host, byte[] key) {
            String stored = known.getProperty(host);
            if (stored == null) {
                pendingHost = host;
                pendingKey = key == null ? null : key.clone();
                return NOT_INCLUDED;
            }
            int space = stored.indexOf(' ');
            String encoded = space >= 0 ? stored.substring(space + 1) : stored;
            try {
                byte[] expected = Base64.getDecoder().decode(encoded);
                return Arrays.equals(expected, key) ? OK : CHANGED;
            } catch (Exception e) {
                return CHANGED;
            }
        }

        @Override
        public synchronized void add(HostKey hostkey, UserInfo ui) {
            if (hostkey == null) {
                return;
            }
            known.setProperty(hostkey.getHost(),
                    hostkey.getType() + " " + hostkey.getKey());
        }

        @Override
        public synchronized void remove(String host, String type) {
            known.remove(host);
        }

        @Override
        public synchronized void remove(String host, String type, byte[] key) {
            known.remove(host);
        }

        @Override
        public String getKnownHostsRepositoryID() {
            return "deepshell-containers";
        }

        @Override
        public synchronized HostKey[] getHostKey() {
            return new HostKey[0];
        }

        @Override
        public synchronized HostKey[] getHostKey(String host, String type) {
            return new HostKey[0];
        }

        private void load() {
            try {
                if (Files.isRegularFile(file)) {
                    java.io.Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8);
                    try {
                        known.load(reader);
                    } finally {
                        reader.close();
                    }
                }
            } catch (Exception ignore) {
                // 读取失败按空仓库处理
            }
        }
    }
}
