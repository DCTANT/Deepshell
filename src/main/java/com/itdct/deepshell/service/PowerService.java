package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.SshConnection;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 远端服务器电源操作：先验证免密 sudo，再延迟 2 秒后台执行 shutdown / reboot，
 * 让接口能先把结果返回给页面（随后系统关机 / 重启会断开所有连接）
 */
@Slf4j
@Service
public class PowerService {

    private final SshSessionManager sessions;
    private final ConnectionService connections;
    private final AuditService audit;

    public PowerService(SshSessionManager sessions, ConnectionService connections, AuditService audit) {
        this.sessions = sessions;
        this.connections = connections;
        this.audit = audit;
    }

    public Map<String, Object> perform(String sessionId, String action) {
        String act = action == null ? "" : action.trim().toLowerCase();
        if (!"shutdown".equals(act) && !"reboot".equals(act)) {
            throw new IllegalArgumentException("不支持的操作: " + action);
        }
        if (sessionId == null || sessionId.trim().isEmpty()) {
            throw new IllegalArgumentException("缺少会话参数");
        }
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String target = targetName(s);
        String label = "shutdown".equals(act) ? "关机" : "重启";
        try {
            // 以 root 登录时直接执行（服务器上可能连 sudo 都没装）；否则要求免密 sudo
            SshSessionManager.ExecResult who = sessions.execInShell(s, "id -u", null, 5000, 4096);
            boolean root = who.exitCode != null && who.exitCode == 0 && "0".equals(who.output.trim());
            if (!root) {
                SshSessionManager.ExecResult check = sessions.execInShell(s, "sudo -n true", null, 8000, 8192);
                if (check.exitCode == null || check.exitCode != 0) {
                    String why = firstLine(check.output);
                    String msg = "当前用户没有免密 sudo 权限，无法执行" + label
                            + (why.isEmpty() ? "" : "（" + why + "）")
                            + "。可在服务器上为该用户配置 NOPASSWD，或手动执行 sudo " + command(act);
                    audit.record("SERVER_POWER", target, "FAIL", label + "：" + msg);
                    throw new IllegalStateException(msg);
                }
            }
            // 延迟执行：先让本接口返回，随后关机 / 重启
            sessions.execCapture(s, backgroundCommand(act, root), 4000);
            audit.record("SERVER_POWER", target, "OK", label + "：" + (root ? "" : "sudo ") + command(act)
                    + (root ? "（root）" : ""));
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("message", label + "指令已发送，服务器即将" + ("shutdown".equals(act) ? "关闭" : "重启"));
            return m;
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            log.warn("电源操作失败: {} {}", act, e.toString());
            audit.record("SERVER_POWER", target, "FAIL", label + "：" + e.getMessage());
            throw new IllegalStateException(label + "指令发送失败：" + e.getMessage());
        }
    }

    /** 实际执行的命令（单测覆盖） */
    static String command(String action) {
        if ("shutdown".equals(action)) {
            return "shutdown -h now";
        }
        if ("reboot".equals(action)) {
            return "shutdown -r now";
        }
        throw new IllegalArgumentException("不支持的操作: " + action);
    }

    /**
     * 后台延迟执行的包装：接口先返回，2 秒后再由 nohup 子进程执行电源命令，
     * 避免 SSH 通道在关机瞬间断开导致前端拿不到结果；root 直接执行，否则走免密 sudo（单测覆盖）
     */
    static String backgroundCommand(String action, boolean root) {
        return "nohup sh -c 'sleep 2; " + (root ? "" : "sudo -n ") + command(action) + "' >/dev/null 2>&1 &";
    }

    private String targetName(SshSessionManager.SshSession s) {
        try {
            SshConnection c = connections.get(s.getConnectionId());
            return c.getName() + "（" + c.getUsername() + "@" + c.getHost() + "）";
        } catch (Exception e) {
            return s.getName();
        }
    }

    private static String firstLine(String text) {
        if (text == null) {
            return "";
        }
        for (String line : text.split("\n")) {
            String t = line.trim();
            if (!t.isEmpty()) {
                return t.length() > 120 ? t.substring(0, 120) + "…" : t;
            }
        }
        return "";
    }
}
