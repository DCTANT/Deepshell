package com.itdct.deepshell.service;

import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 网络工具箱的 root 采样授权。
 * 当前 SSH 用户是 root 时直接使用；否则尝试免密 sudo，必要时接收一次 sudo 密码并在内存中
 * 缓存 30 分钟（滑过期），随后所有采样通过 sudo 运行。密码不会写入日志、审计或数据库。
 */
@Service
public class SudoAccessService {

    private static final long TTL_MS = 30L * 60 * 1000;

    private final SshSessionManager sessions;
    private final AuditService audit;
    private final Map<String, Credential> credentials = new ConcurrentHashMap<>();

    public SudoAccessService(SshSessionManager sessions, AuditService audit) {
        this.sessions = sessions;
        this.audit = audit;
    }

    public synchronized Map<String, Object> status(String sessionId) {
        SshSessionManager.SshSession session = sessions.get(sessionId);
        UserInfo user = detectUser(session);
        Credential credential = validCredential(sessionId);
        boolean root = user.uid == 0;
        boolean passwordless = root || (credential != null && credential.passwordless);
        boolean ready = root || credential != null;
        if (!root && credential == null) {
            passwordless = canSudoWithoutPassword(session);
        }
        Map<String, Object> data = base(user, root, ready, passwordless);
        data.put("needsPassword", !root && !ready && !passwordless);
        return data;
    }

    public synchronized Map<String, Object> enable(String sessionId, String password) {
        SshSessionManager.SshSession session = sessions.get(sessionId);
        UserInfo user = detectUser(session);
        Credential existing = validCredential(sessionId);
        if (existing != null) {
            Map<String, Object> data = base(user, user.uid == 0, true, existing.passwordless);
            data.put("needsPassword", false);
            return data;
        }
        if (user.uid == 0) {
            credentials.put(sessionId, new Credential(true, true, null));
            audit.record("NETWORK_ROOT", session.getName(), "OK", "启用 root 采样（当前用户 root）");
            Map<String, Object> data = base(user, true, true, true);
            data.put("needsPassword", false);
            return data;
        }
        if (canSudoWithoutPassword(session)) {
            credentials.put(sessionId, new Credential(false, true, null));
            audit.record("NETWORK_ROOT", session.getName(), "OK", "启用 root 采样（sudo 免密）");
            Map<String, Object> data = base(user, false, true, true);
            data.put("needsPassword", false);
            return data;
        }
        if (password == null || password.isEmpty()) {
            Map<String, Object> data = base(user, false, false, false);
            data.put("needsPassword", true);
            return data;
        }
        if (!validateSudoPassword(session, password)) {
            credentials.remove(sessionId);
            throw new IllegalArgumentException("sudo 密码错误，或当前用户没有 sudo 权限");
        }
        credentials.put(sessionId, new Credential(false, false, password));
        audit.record("NETWORK_ROOT", session.getName(), "OK", "启用 root 采样（sudo 密码）");
        Map<String, Object> data = base(user, false, true, false);
        data.put("needsPassword", false);
        return data;
    }

    public synchronized Map<String, Object> clear(String sessionId) {
        Credential removed = credentials.remove(sessionId);
        if (removed != null) {
            try {
                SshSessionManager.SshSession session = sessions.get(sessionId);
                audit.record("NETWORK_ROOT", session.getName(), "OK", "关闭 root 采样");
            } catch (Exception ignore) {
                // 会话已断开时只清理缓存
            }
        }
        return statusQuietly(sessionId);
    }

    /**
     * 构造以 root 身份执行的命令及需要写入 stdin 的密码（免密 / root 时为 null）。
     * 未启用 root 采样时抛出明确错误。
     */
    public Command wrap(String sessionId, String command) {
        Credential credential = validCredential(sessionId);
        if (credential == null) {
            throw new IllegalStateException("请先在网络工具箱启用「以 root 采样」");
        }
        credential.expiresAt = System.currentTimeMillis() + TTL_MS;
        String quoted = shellQuote(command);
        if (credential.root) {
            return new Command(command, null);
        }
        if (credential.passwordless) {
            return new Command("sudo -n sh -c " + quoted + " 2>&1", null);
        }
        return new Command("sudo -S -p '' sh -c " + quoted + " 2>&1", credential.password);
    }

    private Map<String, Object> statusQuietly(String sessionId) {
        try {
            return status(sessionId);
        } catch (Exception e) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("user", "");
            data.put("uid", -1);
            data.put("root", false);
            data.put("ready", false);
            data.put("passwordless", false);
            data.put("needsPassword", true);
            return data;
        }
    }

    private Credential validCredential(String sessionId) {
        Credential credential = credentials.get(sessionId);
        if (credential == null) {
            return null;
        }
        if (credential.expiresAt < System.currentTimeMillis()) {
            credentials.remove(sessionId);
            return null;
        }
        return credential;
    }

    private UserInfo detectUser(SshSessionManager.SshSession session) {
        try {
            String out = sessions.execCapture(session, "id -un 2>/dev/null; id -u 2>/dev/null", 5000);
            String[] lines = out == null ? new String[0] : out.trim().split("\\r?\\n");
            if (lines.length < 2) {
                throw new IllegalStateException("无法读取服务器用户信息");
            }
            String name = lines[0].trim();
            int uid = Integer.parseInt(lines[1].trim());
            return new UserInfo(name, uid);
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("无法读取服务器用户信息：" + e.getMessage(), e);
        }
    }

    private boolean canSudoWithoutPassword(SshSessionManager.SshSession session) {
        try {
            String out = sessions.execCapture(session,
                    "sudo -n true >/dev/null 2>&1; echo __DS_SUDO_NOPASS_$?__", 6000);
            return out != null && out.contains("__DS_SUDO_NOPASS_0__");
        } catch (Exception e) {
            return false;
        }
    }

    private boolean validateSudoPassword(SshSessionManager.SshSession session, String password) {
        try {
            String out = sessions.execCaptureWithInput(session,
                    "sudo -S -p '' true >/dev/null 2>&1; echo __DS_SUDO_EXIT_$?__",
                    password + "\n", 12000);
            return out != null && out.contains("__DS_SUDO_EXIT_0__");
        } catch (Exception e) {
            return false;
        }
    }

    private static Map<String, Object> base(UserInfo user, boolean root, boolean ready,
                                            boolean passwordless) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("user", user.name);
        data.put("uid", user.uid);
        data.put("root", root);
        data.put("ready", ready);
        data.put("passwordless", passwordless);
        return data;
    }

    private static String shellQuote(String value) {
        return "'" + String.valueOf(value).replace("'", "'\\''") + "'";
    }

    private static final class UserInfo {
        final String name;
        final int uid;

        UserInfo(String name, int uid) {
            this.name = name;
            this.uid = uid;
        }
    }

    private static final class Credential {
        final boolean root;
        final boolean passwordless;
        final String password;
        volatile long expiresAt = System.currentTimeMillis() + TTL_MS;

        Credential(boolean root, boolean passwordless, String password) {
            this.root = root;
            this.passwordless = passwordless;
            this.password = password;
        }
    }

    public static final class Command {
        private final String command;
        private final String password;

        Command(String command, String password) {
            this.command = command;
            this.password = password;
        }

        public String getCommand() {
            return command;
        }

        public String getPassword() {
            return password;
        }
    }
}
