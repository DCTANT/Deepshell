package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.SshConnection;
import org.springframework.stereotype.Service;

import javax.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * 多机命令：把同一条命令并行发送到多台已保存连接。
 * 已打开的会话直接复用；未连接的服务器按保存的代理 / 跳板机配置临时建连后执行。
 */
@Service
public class BatchCommandService {

    private static final int MAX_TARGETS = 50;
    private static final int MAX_COMMAND_LENGTH = 20000;
    private static final int MAX_OUTPUT_BYTES = 256 * 1024;
    private static final int PARALLEL = 6;

    private final SshSessionManager sessions;
    private final ConnectionService connections;
    private final AuditService audit;

    private final ExecutorService pool = Executors.newFixedThreadPool(PARALLEL, r -> {
        Thread t = new Thread(r, "batch-command");
        t.setDaemon(true);
        return t;
    });

    public BatchCommandService(SshSessionManager sessions, ConnectionService connections,
                               AuditService audit) {
        this.sessions = sessions;
        this.connections = connections;
        this.audit = audit;
    }

    @PreDestroy
    void shutdown() {
        pool.shutdownNow();
    }

    public Map<String, Object> run(List<Long> connectionIds, String command, Integer timeoutSec) {
        if (connectionIds == null || connectionIds.isEmpty()) {
            throw new IllegalArgumentException("请至少选择一台服务器");
        }
        LinkedHashSet<Long> unique = new LinkedHashSet<>();
        for (Long id : connectionIds) {
            if (id != null) {
                unique.add(id);
            }
        }
        if (unique.isEmpty()) {
            throw new IllegalArgumentException("请至少选择一台服务器");
        }
        if (unique.size() > MAX_TARGETS) {
            throw new IllegalArgumentException("一次最多发送到 " + MAX_TARGETS + " 台服务器");
        }
        String cmd = command == null ? "" : command.trim();
        if (cmd.isEmpty()) {
            throw new IllegalArgumentException("请输入要执行的命令");
        }
        if (cmd.length() > MAX_COMMAND_LENGTH) {
            throw new IllegalArgumentException("命令过长（最多 " + MAX_COMMAND_LENGTH + " 个字符）");
        }
        int timeout = timeoutSec == null ? 60 : Math.max(5, Math.min(300, timeoutSec));
        final long timeoutMs = timeout * 1000L;

        List<Target> targets = new ArrayList<>();
        for (Long id : unique) {
            Target t = new Target();
            t.id = id;
            try {
                SshConnection c = connections.get(id);
                t.name = c.getName();
                t.host = c.getHost();
            } catch (Exception e) {
                t.name = "连接 " + id;
                t.host = "";
                t.problem = "连接不存在";
            }
            targets.add(t);
        }

        List<Future<Map<String, Object>>> futures = new ArrayList<>();
        for (final Target target : targets) {
            if (target.problem != null) {
                futures.add(null);
                continue;
            }
            futures.add(pool.submit(() -> execute(target, cmd, timeoutMs)));
        }

        long start = System.currentTimeMillis();
        List<Map<String, Object>> items = new ArrayList<>();
        for (int i = 0; i < targets.size(); i++) {
            Target target = targets.get(i);
            Future<Map<String, Object>> f = futures.get(i);
            if (f == null) {
                items.add(errorResult(target, target.problem));
                continue;
            }
            try {
                items.add(f.get(timeout + 30, TimeUnit.SECONDS));
            } catch (CancellationException e) {
                items.add(errorResult(target, "整体等待超时，未完成执行"));
            } catch (ExecutionException e) {
                Throwable cause = e.getCause() == null ? e : e.getCause();
                items.add(errorResult(target,
                        cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage()));
            } catch (Exception e) {
                Thread.currentThread().interrupt();
                items.add(errorResult(target, "等待执行结果失败"));
            }
        }
        long elapsed = System.currentTimeMillis() - start;

        StringBuilder names = new StringBuilder();
        for (Target t : targets) {
            if (names.length() > 0) {
                names.append(", ");
            }
            names.append(t.name);
        }
        audit.record("BATCH_COMMAND", names.toString(), "OK",
                "命令长度 " + cmd.length() + "，等待 " + elapsed + " ms");

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", items);
        data.put("elapsedMs", elapsed);
        data.put("timeoutSec", timeout);
        return data;
    }

    private Map<String, Object> execute(Target target, String command, long timeoutMs) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("connectionId", target.id);
        item.put("name", target.name);
        item.put("host", target.host);
        item.put("ok", false);
        item.put("output", "");
        item.put("exitCode", null);
        item.put("timedOut", false);
        item.put("truncated", false);
        long start = System.currentTimeMillis();
        try {
            SshSessionManager.ExecResult res = sessions.execOnSavedConnection(
                    target.id, command, timeoutMs, MAX_OUTPUT_BYTES);
            item.put("output", res.output == null ? "" : res.output);
            item.put("exitCode", res.exitCode);
            item.put("timedOut", res.timedOut);
            item.put("truncated", res.truncated);
            item.put("ok", !res.timedOut && (res.exitCode == null || res.exitCode == 0));
            if (res.timedOut) {
                item.put("error", "执行超时（" + (timeoutMs / 1000) + " 秒）");
            } else if (res.truncated) {
                item.put("error", "输出过长，已截断");
            }
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            item.put("error", msg);
        }
        item.put("durationMs", System.currentTimeMillis() - start);
        return item;
    }

    private static Map<String, Object> errorResult(Target target, String error) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("connectionId", target.id);
        item.put("name", target.name);
        item.put("host", target.host);
        item.put("ok", false);
        item.put("output", "");
        item.put("exitCode", null);
        item.put("timedOut", false);
        item.put("truncated", false);
        item.put("error", error);
        item.put("durationMs", 0);
        return item;
    }

    private static class Target {
        Long id;
        String name;
        String host;
        String problem;
    }
}
