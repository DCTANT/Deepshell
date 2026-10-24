package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.PortForwardForm;
import com.itdct.deepshell.entity.PortForwardRule;
import com.itdct.deepshell.repo.PortForwardRuleRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 端口转发运行时：规则按连接持久化，会话建立后按 autoStart 自动启动。
 *
 * <p>同一条规则在整条连接上只运行一份：同一连接打开多个会话时，后开的会话复用已有转发，
 * 避免重复绑定同一监听端口；停止 / 编辑 / 删除会清理该连接所有会话上的运行实例。</p>
 */
@Slf4j
@Service
public class PortForwardService {

    private final PortForwardRuleRepository repo;
    private final SshSessionManager sessions;
    private final ConnectionService connections;
    private final AuditService audit;
    private final Map<String, ConcurrentHashMap<Long, RuntimeForward>> runtime = new ConcurrentHashMap<>();
    /** 同一规则的启停串行化，避免两个会话同时 autoStart 造成重复绑定 */
    private final Map<Long, Object> ruleLocks = new ConcurrentHashMap<>();

    public PortForwardService(PortForwardRuleRepository repo, SshSessionManager sessions,
                              ConnectionService connections, AuditService audit) {
        this.repo = repo;
        this.sessions = sessions;
        this.connections = connections;
        this.audit = audit;
    }

    public static class RuntimeForward {
        public volatile boolean running;
        public volatile Integer actualPort;
        public volatile String error;
    }

    public void onSessionOpened(SshSessionManager.SshSession s) {
        ConcurrentHashMap<Long, RuntimeForward> map = new ConcurrentHashMap<>();
        runtime.put(s.getId(), map);
        List<PortForwardRule> rules = repo.findByConnectionIdOrderByIdAsc(s.getConnectionId());
        // 远端转发需要等待服务器确认，放到后台避免拖慢终端打开
        Thread t = new Thread(() -> {
            for (PortForwardRule rule : rules) {
                if (s.isClosed()) {
                    return;
                }
                // 规则可能在自动启动过程中被删除
                if (!Boolean.TRUE.equals(rule.getAutoStart()) || !repo.existsById(rule.getId())) {
                    continue;
                }
                startInternal(s, rule, map);
            }
        }, "ssh-port-forward-" + s.getId());
        t.setDaemon(true);
        t.start();
    }

    public void onSessionClosed(String sessionId) {
        runtime.remove(sessionId);
    }

    public List<Map<String, Object>> list(Long connectionId, String sessionId) {
        List<PortForwardRule> rules = repo.findByConnectionIdOrderByIdAsc(connectionId);
        ConcurrentHashMap<Long, RuntimeForward> map = null;
        if (sessionId != null && !sessionId.trim().isEmpty()) {
            try {
                SshSessionManager.SshSession s = sessions.get(sessionId);
                if (connectionId.equals(s.getConnectionId())) {
                    map = runtime.get(sessionId);
                }
            } catch (Exception ignore) {
                // 会话已关闭时只返回规则本身
            }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (PortForwardRule rule : rules) {
            RuntimeForward running = findRunning(connectionId, rule.getId(), null);
            RuntimeForward rt = running != null ? running : (map == null ? null : map.get(rule.getId()));
            out.add(item(rule, rt));
        }
        return out;
    }

    public Map<String, Object> create(PortForwardForm form, String sessionId) {
        PortForwardRule rule = new PortForwardRule();
        apply(rule, form);
        ensureConnectionExists(rule.getConnectionId());
        ensureNoDuplicate(rule, null);
        rule = repo.save(rule);
        audit.record("PORT_FORWARD", label(rule), "CREATE", "自动启动=" + rule.getAutoStart());
        Map<String, Object> result = new LinkedHashMap<>();
        RuntimeForward rt = startIfRequested(rule, sessionId);
        result.put("rule", item(rule, rt));
        return result;
    }

    public Map<String, Object> update(Long id, PortForwardForm form, String sessionId) {
        PortForwardRule rule = get(id);
        if (form == null || form.getConnectionId() == null) {
            throw new IllegalArgumentException("缺少连接 id");
        }
        if (!rule.getConnectionId().equals(form.getConnectionId())) {
            throw new IllegalArgumentException("不能修改转发规则所属连接，请删除后重新创建");
        }
        synchronized (lockFor(id)) {
            stopEverywhere(rule, sessionId, true);
            apply(rule, form);
            ensureConnectionExists(rule.getConnectionId());
            ensureNoDuplicate(rule, rule.getId());
            rule = repo.save(rule);
        }
        audit.record("PORT_FORWARD", label(rule), "UPDATE", "自动启动=" + rule.getAutoStart());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rule", item(rule, startIfRequested(rule, sessionId)));
        return result;
    }

    public void delete(Long id, String sessionId) {
        PortForwardRule rule = get(id);
        synchronized (lockFor(id)) {
            stopEverywhere(rule, sessionId, true);
            repo.delete(rule);
        }
        ruleLocks.remove(id);
        audit.record("PORT_FORWARD", label(rule), "DELETE", "");
    }

    public RuntimeForward start(Long id, String sessionId) {
        PortForwardRule rule = get(id);
        SshSessionManager.SshSession s = activeSession(sessionId, rule.getConnectionId());
        ConcurrentHashMap<Long, RuntimeForward> map = runtime.computeIfAbsent(
                s.getId(), k -> new ConcurrentHashMap<>());
        RuntimeForward rt = startInternal(s, rule, map);
        audit.record("PORT_FORWARD", label(rule), rt.running ? "START" : "FAIL",
                rt.error == null ? "" : rt.error);
        return rt;
    }

    public void stop(Long id, String sessionId) {
        PortForwardRule rule = get(id);
        stopEverywhere(rule, sessionId, false);
        audit.record("PORT_FORWARD", label(rule), "STOP", "");
    }

    private RuntimeForward startIfRequested(PortForwardRule rule, String sessionId) {
        if (!Boolean.TRUE.equals(rule.getAutoStart()) || sessionId == null || sessionId.trim().isEmpty()) {
            return null;
        }
        try {
            SshSessionManager.SshSession s = activeSession(sessionId, rule.getConnectionId());
            ConcurrentHashMap<Long, RuntimeForward> map = runtime.computeIfAbsent(
                    s.getId(), k -> new ConcurrentHashMap<>());
            RuntimeForward rt = startInternal(s, rule, map);
            audit.record("PORT_FORWARD", label(rule), rt.running ? "START" : "FAIL",
                    rt.error == null ? "" : rt.error);
            return rt;
        } catch (Exception e) {
            RuntimeForward rt = new RuntimeForward();
            rt.error = e.getMessage();
            return rt;
        }
    }

    private RuntimeForward startInternal(SshSessionManager.SshSession s, PortForwardRule rule,
                                         ConcurrentHashMap<Long, RuntimeForward> map) {
        synchronized (lockFor(rule.getId())) {
            // 规则可能在自动启动排队期间被删除
            if (!repo.existsById(rule.getId())) {
                RuntimeForward gone = new RuntimeForward();
                gone.error = "转发规则已被删除";
                return gone;
            }
            // 同一连接上已有会话启动了这条规则：直接复用，避免重复绑定端口
            RuntimeForward running = findRunning(rule.getConnectionId(), rule.getId(), null);
            if (running != null) {
                return running;
            }
            RuntimeForward rt = map.computeIfAbsent(rule.getId(), k -> new RuntimeForward());
            synchronized (rt) {
                if (rt.running) {
                    return rt;
                }
                try {
                    if ("REMOTE".equals(rule.getDirection())) {
                        s.getJsch().setPortForwardingR(rule.getBindHost(), rule.getBindPort(),
                                rule.getDestHost(), rule.getDestPort());
                        rt.actualPort = rule.getBindPort();
                    } else {
                        rt.actualPort = s.getJsch().setPortForwardingL(rule.getBindHost(), rule.getBindPort(),
                                rule.getDestHost(), rule.getDestPort());
                    }
                    rt.running = true;
                    rt.error = null;
                    log.info("端口转发已启动 session={} rule={} {}", s.getId(), rule.getId(), label(rule));
                } catch (Exception e) {
                    rt.running = false;
                    rt.actualPort = null;
                    rt.error = friendly(e.getMessage());
                    log.warn("端口转发启动失败 session={} rule={}: {}", s.getId(), rule.getId(), e.getMessage());
                }
                return rt;
            }
        }
    }

    /**
     * 停止规则在连接所有会话上的运行实例；remove=true 时同时移除运行状态（编辑 / 删除后重新开始）。
     */
    private void stopEverywhere(PortForwardRule rule, String preferredSessionId, boolean remove) {
        Set<String> handled = new LinkedHashSet<>();
        if (preferredSessionId != null && !preferredSessionId.trim().isEmpty()) {
            handled.add(preferredSessionId);
            stopOnSession(rule, preferredSessionId, remove);
        }
        for (SshSessionManager.SshSession s : sessions.liveSessionsForConnection(rule.getConnectionId())) {
            if (handled.add(s.getId())) {
                stopOnSession(rule, s.getId(), remove);
            }
        }
    }

    private void stopOnSession(PortForwardRule rule, String sessionId, boolean remove) {
        ConcurrentHashMap<Long, RuntimeForward> map = runtime.get(sessionId);
        if (map == null) {
            return;
        }
        RuntimeForward rt = map.get(rule.getId());
        if (rt == null) {
            if (remove) {
                map.remove(rule.getId());
            }
            return;
        }
        synchronized (rt) {
            if (rt.running) {
                try {
                    SshSessionManager.SshSession s = sessions.get(sessionId);
                    if (rule.getConnectionId().equals(s.getConnectionId())) {
                        if ("REMOTE".equals(rule.getDirection())) {
                            s.getJsch().delPortForwardingR(rule.getBindHost(), rule.getBindPort());
                        } else {
                            s.getJsch().delPortForwardingL(rule.getBindHost(), rule.getBindPort());
                        }
                    }
                } catch (Exception e) {
                    log.debug("停止端口转发失败 rule={} session={}: {}", rule.getId(), sessionId, e.getMessage());
                }
                rt.running = false;
                rt.actualPort = null;
                rt.error = null;
            }
            if (remove) {
                map.remove(rule.getId());
            }
        }
    }

    private Object lockFor(Long ruleId) {
        return ruleLocks.computeIfAbsent(ruleId, k -> new Object());
    }

    private RuntimeForward findRunning(Long connectionId, Long ruleId, String excludeSessionId) {
        if (connectionId == null || ruleId == null) {
            return null;
        }
        for (SshSessionManager.SshSession s : sessions.liveSessionsForConnection(connectionId)) {
            if (excludeSessionId != null && excludeSessionId.equals(s.getId())) {
                continue;
            }
            ConcurrentHashMap<Long, RuntimeForward> map = runtime.get(s.getId());
            RuntimeForward rt = map == null ? null : map.get(ruleId);
            if (rt != null && rt.running) {
                return rt;
            }
        }
        return null;
    }

    private SshSessionManager.SshSession activeSession(String sessionId, Long connectionId) {
        if (sessionId == null || sessionId.trim().isEmpty()) {
            throw new IllegalArgumentException("请先连接目标主机");
        }
        SshSessionManager.SshSession s = sessions.get(sessionId);
        if (!connectionId.equals(s.getConnectionId())) {
            throw new IllegalArgumentException("当前会话不属于该连接");
        }
        return s;
    }

    private void ensureConnectionExists(Long connectionId) {
        if (connectionId == null) {
            throw new IllegalArgumentException("缺少连接 id");
        }
        connections.get(connectionId);
    }

    private void ensureNoDuplicate(PortForwardRule rule, Long excludeId) {
        for (PortForwardRule existing : repo.findByConnectionIdOrderByIdAsc(rule.getConnectionId())) {
            if (excludeId != null && excludeId.equals(existing.getId())) {
                continue;
            }
            if (rule.getDirection().equals(existing.getDirection())
                    && rule.getBindHost().equalsIgnoreCase(existing.getBindHost())
                    && rule.getBindPort().equals(existing.getBindPort())) {
                throw new IllegalArgumentException("同一连接已存在监听 "
                        + rule.getBindHost() + ":" + rule.getBindPort() + " 的转发规则");
            }
        }
    }

    private PortForwardRule get(Long id) {
        return repo.findById(id).orElseThrow(() -> new IllegalArgumentException("转发规则不存在: " + id));
    }

    private static void apply(PortForwardRule rule, PortForwardForm f) {
        if (f == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        if (f.getConnectionId() == null) {
            throw new IllegalArgumentException("缺少连接 id");
        }
        String direction = f.getDirection() == null ? "LOCAL" : f.getDirection().trim().toUpperCase(Locale.ROOT);
        if (!"LOCAL".equals(direction) && !"REMOTE".equals(direction)) {
            throw new IllegalArgumentException("转发方向仅支持 LOCAL / REMOTE");
        }
        String bindHost = trim(f.getBindHost());
        if (bindHost == null) {
            bindHost = "127.0.0.1";
        }
        requireAddress(bindHost, "监听地址");
        String destHost = trim(f.getDestHost());
        if (destHost == null) {
            throw new IllegalArgumentException("请填写目标地址");
        }
        requireAddress(destHost, "目标地址");
        int bindPort = f.getBindPort() == null ? 0 : f.getBindPort();
        int destPort = f.getDestPort() == null ? 0 : f.getDestPort();
        if (bindPort < 1 || bindPort > 65535) {
            throw new IllegalArgumentException("监听端口范围不正确");
        }
        if (destPort < 1 || destPort > 65535) {
            throw new IllegalArgumentException("目标端口范围不正确");
        }
        rule.setConnectionId(f.getConnectionId());
        rule.setDirection(direction);
        rule.setBindHost(bindHost);
        rule.setBindPort(bindPort);
        rule.setDestHost(destHost);
        rule.setDestPort(destPort);
        rule.setAutoStart(f.getAutoStart() == null || f.getAutoStart());
    }

    /** 地址会进入 SSH 转发请求 / 本机 bind，拒绝空白与控制字符，避免参数被拆开。 */
    private static void requireAddress(String value, String label) {
        if (value.length() > 255) {
            throw new IllegalArgumentException(label + "过长");
        }
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c <= 0x20 || c == 0x7f) {
                throw new IllegalArgumentException(label + "不能包含空格或控制字符");
            }
        }
    }

    private static Map<String, Object> item(PortForwardRule rule, RuntimeForward rt) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rule.getId());
        m.put("connectionId", rule.getConnectionId());
        m.put("direction", rule.getDirection());
        m.put("bindHost", rule.getBindHost());
        m.put("bindPort", rule.getBindPort());
        m.put("destHost", rule.getDestHost());
        m.put("destPort", rule.getDestPort());
        m.put("autoStart", Boolean.TRUE.equals(rule.getAutoStart()));
        m.put("running", rt != null && rt.running);
        m.put("actualPort", rt == null ? null : rt.actualPort);
        m.put("error", rt == null ? null : rt.error);
        return m;
    }

    private static String label(PortForwardRule r) {
        String left = ("REMOTE".equals(r.getDirection()) ? "远端 " : "本机 ")
                + r.getBindHost() + ":" + r.getBindPort();
        return left + " -> " + r.getDestHost() + ":" + r.getDestPort();
    }

    private static String friendly(String msg) {
        if (msg == null) {
            return "启动失败";
        }
        String lower = msg.toLowerCase(Locale.ROOT);
        if (lower.contains("address already in use") || lower.contains("bind")) {
            return "监听端口被占用或无权绑定: " + msg;
        }
        if (lower.contains("administratively prohibited") || lower.contains("forwarding")) {
            return "服务器拒绝转发请求（检查 sshd AllowTcpForwarding）: " + msg;
        }
        return msg;
    }

    private static String trim(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
