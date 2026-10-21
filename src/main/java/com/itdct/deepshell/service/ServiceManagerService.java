package com.itdct.deepshell.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 服务与计划任务：读取 / 操作远端 systemd 服务，查看与维护用户 crontab，
 * 同时展示系统 crontab 与 systemd 定时器。全部命令走独立 exec 通道，不干扰交互终端。
 */
@Service
public class ServiceManagerService {

    private static final String LIST_SCRIPT =
            "export LC_ALL=C 2>/dev/null; export LANG=C 2>/dev/null; " +
                    "echo __UNITS__; " +
                    "if command -v systemctl >/dev/null 2>&1; then " +
                    "systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null; " +
                    "echo __FILES__; systemctl list-unit-files --type=service --no-pager --no-legend --plain 2>/dev/null; " +
                    "else echo __SYSV__; service --status-all 2>/dev/null; fi; " +
                    "echo __END__";

    private static final String CRON_SCRIPT =
            "export LC_ALL=C 2>/dev/null; export LANG=C 2>/dev/null; " +
                    "echo __USER__; crontab -l 2>&1; " +
                    "echo __SYSTEM__; " +
                    "for f in /etc/crontab /etc/cron.d/*; do [ -f \"$f\" ] || continue; " +
                    "echo \"## $f\"; sed -n '1,500p' \"$f\" 2>/dev/null; done; " +
                    "echo __TIMERS__; systemctl list-timers --all --no-pager --no-legend 2>/dev/null; " +
                    "echo __END__";

    private final SshSessionManager sessions;

    public ServiceManagerService(SshSessionManager sessions) {
        this.sessions = sessions;
    }

    public List<Map<String, Object>> list(String sessionId) throws Exception {
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String raw = sessions.execCapture(s, LIST_SCRIPT, 20000);
        String[] lines = raw == null ? new String[0] : raw.split("\\r?\\n");
        String section = "";
        List<String> unitLines = new ArrayList<>();
        List<String> fileLines = new ArrayList<>();
        List<String> sysvLines = new ArrayList<>();
        for (String rawLine : lines) {
            String line = rawLine.trim();
            if ("__UNITS__".equals(line)) {
                section = "units";
                continue;
            }
            if ("__FILES__".equals(line)) {
                section = "files";
                continue;
            }
            if ("__SYSV__".equals(line)) {
                section = "sysv";
                continue;
            }
            if ("__END__".equals(line) || line.isEmpty()) {
                continue;
            }
            if ("units".equals(section)) {
                unitLines.add(line);
            } else if ("files".equals(section)) {
                fileLines.add(line);
            } else if ("sysv".equals(section)) {
                sysvLines.add(line);
            }
        }

        Map<String, String> enabled = new LinkedHashMap<>();
        for (String line : fileLines) {
            String[] a = line.split("\\s+", 2);
            if (a.length >= 2) {
                enabled.put(a[0], a[1]);
            }
        }

        List<Map<String, Object>> list = new ArrayList<>();
        for (String line : unitLines) {
            line = line.replaceFirst("^[*\\u25CF]+\\s*", "");
            String[] a = line.split("\\s+", 5);
            if (a.length < 4 || !a[0].endsWith(".service")) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("unit", a[0]);
            item.put("load", a[1]);
            item.put("active", a[2]);
            item.put("sub", a[3]);
            item.put("description", a.length > 4 ? a[4] : "");
            item.put("enabled", enabled.getOrDefault(a[0], ""));
            list.add(item);
        }
        if (list.isEmpty()) {
            // 非 systemd 系统（Alpine / OpenWrt / 老发行版）回退到 SysV 服务列表
            for (String line : sysvLines) {
                int l = line.indexOf('[');
                int r = line.indexOf(']');
                if (l < 0 || r <= l) {
                    continue;
                }
                String mark = line.substring(l + 1, r).trim();
                String name = line.substring(r + 1).trim();
                if (name.isEmpty()) {
                    continue;
                }
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("unit", name);
                item.put("load", "sysv");
                item.put("active", "+".equals(mark) ? "active" : "inactive");
                item.put("sub", "+".equals(mark) ? "running" : "stopped");
                item.put("description", "");
                item.put("enabled", "unknown");
                list.add(item);
            }
        }
        return list;
    }

    public void action(String sessionId, String unit, String action) throws Exception {
        String name = requireUnit(unit);
        String act = requireAction(action);
        SshSessionManager.SshSession s = sessions.get(sessionId);
        SshSessionManager.ExecResult r = sessions.execInShell(s,
                "systemctl " + act + " " + shellQuote(name) + " 2>&1", null, 30000, 64 * 1024);
        if (r.timedOut) {
            throw new IllegalStateException("操作超时，请稍后刷新状态");
        }
        String out = r.output == null ? "" : r.output.trim();
        if (r.exitCode != null && r.exitCode != 0) {
            throw new IllegalStateException(out.isEmpty()
                    ? ("操作失败（退出码 " + r.exitCode + "），可能需要 root 权限或免密 sudo")
                    : out);
        }
    }

    public Map<String, Object> cron(String sessionId) throws Exception {
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String raw = sessions.execCapture(s, CRON_SCRIPT, 20000);
        String[] lines = raw == null ? new String[0] : raw.split("\\r?\\n");
        String section = "";
        List<String> user = new ArrayList<>();
        List<Map<String, Object>> system = new ArrayList<>();
        List<String> timers = new ArrayList<>();
        String file = "";
        for (String rawLine : lines) {
            String line = rawLine.trim();
            if ("__USER__".equals(line)) {
                section = "user";
                continue;
            }
            if ("__SYSTEM__".equals(line)) {
                section = "system";
                continue;
            }
            if ("__TIMERS__".equals(line)) {
                section = "timers";
                continue;
            }
            if ("__END__".equals(line) || line.isEmpty()) {
                continue;
            }
            if ("user".equals(section)) {
                if (line.startsWith("no crontab for")) {
                    continue;
                }
                user.add(line);
            } else if ("system".equals(section)) {
                if (line.startsWith("## ")) {
                    file = line.substring(3).trim();
                    continue;
                }
                if (line.startsWith("#")) {
                    continue;
                }
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("file", file.isEmpty() ? "系统 crontab" : file);
                item.put("line", line);
                system.add(item);
            } else if ("timers".equals(section)) {
                timers.add(line);
            }
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("user", user);
        data.put("system", system);
        data.put("timers", timers);
        return data;
    }

    public Map<String, Object> addCron(String sessionId, String line) throws Exception {
        String entry = line == null ? "" : line.trim();
        validateCronLine(entry);
        SshSessionManager.SshSession s = sessions.get(sessionId);
        List<String> current = readUserCrontab(s);
        current.add(entry);
        rewriteUserCrontab(s, current);
        return cron(sessionId);
    }

    public Map<String, Object> deleteCron(String sessionId, String line) throws Exception {
        String entry = line == null ? "" : line.trim();
        if (entry.isEmpty()) {
            throw new IllegalArgumentException("缺少要删除的任务行");
        }
        SshSessionManager.SshSession s = sessions.get(sessionId);
        List<String> current = readUserCrontab(s);
        boolean removed = false;
        for (int i = 0; i < current.size(); i++) {
            if (current.get(i).trim().equals(entry)) {
                current.remove(i);
                removed = true;
                break;
            }
        }
        if (!removed) {
            throw new IllegalArgumentException("计划任务不存在，可能已被修改");
        }
        rewriteUserCrontab(s, current);
        return cron(sessionId);
    }

    private List<String> readUserCrontab(SshSessionManager.SshSession s) throws Exception {
        String raw = sessions.execCapture(s, "crontab -l 2>/dev/null", 8000);
        List<String> list = new ArrayList<>();
        if (raw == null) {
            return list;
        }
        for (String line : raw.split("\\r?\\n")) {
            String t = line.trim();
            if (!t.isEmpty() && !t.startsWith("no crontab for")) {
                list.add(t);
            }
        }
        return list;
    }

    private void rewriteUserCrontab(SshSessionManager.SshSession s, List<String> lines) throws Exception {
        StringBuilder cmd = new StringBuilder();
        if (lines.isEmpty()) {
            cmd.append("crontab -r 2>/dev/null");
        } else {
            cmd.append("printf '%s\\n'");
            for (String line : lines) {
                cmd.append(' ').append(shellQuote(line));
            }
            cmd.append(" | crontab - 2>&1");
        }
        SshSessionManager.ExecResult r = sessions.execInShell(s, cmd.toString(), null, 15000, 64 * 1024);
        if (r.timedOut) {
            throw new IllegalStateException("写入 crontab 超时");
        }
        if (r.exitCode != null && r.exitCode != 0) {
            String out = r.output == null ? "" : r.output.trim();
            throw new IllegalStateException(out.isEmpty() ? "写入 crontab 失败" : out);
        }
    }

    private static void validateCronLine(String line) {
        if (line.isEmpty()) {
            throw new IllegalArgumentException("请输入 cron 任务行");
        }
        if (line.length() > 1000) {
            throw new IllegalArgumentException("任务行过长（最多 1000 个字符）");
        }
        if (line.indexOf('\n') >= 0 || line.indexOf('\r') >= 0) {
            throw new IllegalArgumentException("任务行不能包含换行");
        }
        if (line.startsWith("@")) {
            if (!line.matches("^@(reboot|yearly|annually|monthly|weekly|daily|hourly|midnight)\\s+.+$")) {
                throw new IllegalArgumentException("不支持的 @ 快捷表达式");
            }
            return;
        }
        String[] fields = line.split("\\s+");
        if (fields.length < 6) {
            throw new IllegalArgumentException("格式应为：分 时 日 月 周 命令");
        }
    }

    private static String requireUnit(String unit) {
        String name = unit == null ? "" : unit.trim();
        if (!name.matches("^[A-Za-z0-9][A-Za-z0-9_.@:\\-]*\\.service$")) {
            throw new IllegalArgumentException("服务名称不合法");
        }
        return name;
    }

    private static String requireAction(String action) {
        String act = action == null ? "" : action.trim();
        if (!"start".equals(act) && !"stop".equals(act) && !"restart".equals(act)
                && !"enable".equals(act) && !"disable".equals(act)) {
            throw new IllegalArgumentException("不支持的服务操作");
        }
        return act;
    }

    private static String shellQuote(String value) {
        return "'" + String.valueOf(value).replace("'", "'\\''") + "'";
    }
}
