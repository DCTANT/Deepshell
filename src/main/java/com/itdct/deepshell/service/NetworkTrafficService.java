package com.itdct.deepshell.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 服务器进程级实时流量采样：在目标 Linux 服务器上读取 ss 的套接字字节计数与
 * /proc/net/dev 网卡总数，相邻两次快照差分得到每个进程的实时上下行速率。
 *
 * <p>ss 的 TCP 信息包含 bytes_sent / bytes_received；UDP 套接字通常没有字节计数，
 * 连接在两次采样之间关闭时也无法追溯最后一段流量，这两部分会体现在「未归属」
 * 差值中。普通 SSH 用户只能看到自己有权限的进程，其余套接字归入未知进程。</p>
 */
@Service
public class NetworkTrafficService {

    static final String SAMPLE_SCRIPT =
            "export LC_ALL=C 2>/dev/null; export LANG=C 2>/dev/null; " +
            "echo @@UID $(id -u 2>/dev/null || echo -1); " +
            "echo @@DEV; cat /proc/net/dev 2>/dev/null; " +
            "echo @@SPEED; " +
            "for d in /sys/class/net/*; do n=${d##*/}; [ \"$n\" = lo ] && continue; " +
            "s=$(cat \"$d/speed\" 2>/dev/null); echo \"$n $s\"; done; " +
            "echo @@SELF; " +
            "__p=$$; __n=0; while [ \"$__p\" -gt 1 ] && [ \"$__n\" -lt 8 ]; do " +
            "__line=$(ps -o ppid=,comm= -p \"$__p\" 2>/dev/null); [ -z \"$__line\" ] && break; " +
            "set -- $__line; [ -z \"$1\" ] && break; echo \"$__p $2\"; __p=$1; __n=$((__n+1)); done; " +
            "echo @@SS; " +
            "__ss=''; if command -v ss >/dev/null 2>&1; then " +
            "__ss=$( { ss -tinup 2>/dev/null || ss -tinup 2>/dev/null; } ); " +
            "printf '%s\\n' \"$__ss\" | sed 's/[[:space:]]*$//' | head -n 20000; " +
            "else echo @@NO_SS; fi; " +
            "echo; echo @@PS; " +
            "if [ -n \"$__ss\" ]; then " +
            "__pids=$(printf '%s\\n' \"$__ss\" | sed -n 's/.*pid=\\([0-9][0-9]*\\).*/\\1/p' " +
            "| sort -u | head -n 500 | tr '\\n' ',' | sed 's/,$//'); " +
            "[ -n \"$__pids\" ] && ps -o pid=,user=,comm= -p \"$__pids\" 2>/dev/null; " +
            "fi; echo";

    private static final Pattern PID_RE = Pattern.compile("\\(\"([^\"]*)\",pid=(\\d+),fd=\\d+\\)");
    private static final Pattern INODE_RE = Pattern.compile("\\bino:(\\d+)");
    private static final Pattern RX_RE = Pattern.compile("bytes_received:(\\d+)");
    private static final Pattern TX_RE = Pattern.compile("bytes_sent:(\\d+)");
    private static final int MAX_PROGRAMS = 300;

    private final SshSessionManager sessions;
    private final SudoAccessService sudoAccess;
    private final Map<String, State> states = new ConcurrentHashMap<>();

    public NetworkTrafficService(SshSessionManager sessions, SudoAccessService sudoAccess) {
        this.sessions = sessions;
        this.sudoAccess = sudoAccess;
    }

    public Map<String, Object> sample(String sessionId, boolean reset) throws Exception {
        return sample(sessionId, reset, false);
    }

    public Map<String, Object> sample(String sessionId, boolean reset, boolean root) throws Exception {
        SshSessionManager.SshSession s = sessions.get(sessionId);
        long now = System.currentTimeMillis();
        String raw;
        if (root) {
            SudoAccessService.Command command = sudoAccess.wrap(sessionId, SAMPLE_SCRIPT);
            raw = command.getPassword() == null
                    ? sessions.execCapture(s, command.getCommand(), 9000)
                    : sessions.execCaptureWithInput(s, command.getCommand(),
                    command.getPassword() + "\n", 9000);
            if (raw == null || !raw.contains("@@UID")) {
                throw new IllegalArgumentException("root 采样失败：" + firstLine(raw));
            }
        } else {
            raw = sessions.execCapture(s, SAMPLE_SCRIPT, 9000);
        }
        Parsed parsed = parse(raw);
        State state = states.computeIfAbsent(sessionId, k -> new State());
        Map<String, Object> result;
        synchronized (state) {
            result = apply(state, parsed, now, reset);
        }
        if (states.size() > 32) {
            states.keySet().removeIf(id -> !sessions.exists(id));
        }
        return result;
    }

    /* ---------------- 采样快照 ---------------- */

    static class Parsed {
        int uid = -1;
        boolean ssAvailable;
        boolean restricted;
        final Map<String, long[]> dev = new LinkedHashMap<String, long[]>();
        final Map<String, Long> speedMbps = new LinkedHashMap<String, Long>();
        final List<SocketInfo> sockets = new ArrayList<SocketInfo>();
        final Map<Long, String> users = new LinkedHashMap<Long, String>();
        final java.util.Set<Long> selfPids = new java.util.HashSet<Long>();
    }

    static class SocketInfo {
        String key;
        long pid;
        String name;
        String local = "";
        String peer = "";
        long rx;
        long tx;
        boolean loopback;
    }

    static class Totals {
        long rx;
        long tx;
        long extRx;
        long extTx;
    }

    static class State {
        long startedAt;
        long lastAt;
        long devRxBase;
        long devTxBase;
        final Map<String, long[]> prevSockets = new LinkedHashMap<String, long[]>();
        final Map<String, long[]> prevDev = new LinkedHashMap<String, long[]>();
        final Map<String, long[]> devBase = new LinkedHashMap<String, long[]>();
        final Map<Long, Totals> totals = new LinkedHashMap<Long, Totals>();
    }

    /* ---------------- 解析 ---------------- */

    static Parsed parse(String raw) {
        Parsed p = new Parsed();
        if (raw == null || raw.trim().isEmpty()) {
            throw new IllegalArgumentException("采样输出为空（可能是非 Linux 服务器）");
        }
        String section = "";
        SocketInfo current = null;
        for (String line : raw.split("\\r?\\n")) {
            String t = line.trim();
            if (t.startsWith("@@UID")) {
                section = "";
                p.uid = (int) safeLong(t.substring(5).trim(), -1);
                continue;
            }
            if ("@@DEV".equals(t) || "@@SPEED".equals(t) || "@@SELF".equals(t)
                    || "@@SS".equals(t) || "@@PS".equals(t)) {
                section = t;
                current = null;
                continue;
            }
            if ("@@NO_SS".equals(t)) {
                p.ssAvailable = false;
                continue;
            }
            if ("@@DEV".equals(section)) {
                parseDevLine(p, t);
                continue;
            }
            if ("@@SPEED".equals(section)) {
                String[] a = t.split("\\s+", 2);
                if (a.length == 2 && !a[0].isEmpty()) {
                    long speed = safeLong(a[1].trim(), 0);
                    if (speed > 0) {
                        p.speedMbps.put(a[0], speed);
                    }
                }
                continue;
            }
            if ("@@SELF".equals(section)) {
                String[] a = t.split("\\s+", 2);
                if (a.length >= 1 && a[0].matches("\\d+")) {
                    p.selfPids.add(Long.parseLong(a[0]));
                }
                continue;
            }
            if ("@@SS".equals(section)) {
                if (t.isEmpty()) {
                    continue;
                }
                if (t.startsWith("Netid ")) {
                    p.ssAvailable = true;
                    continue;
                }
                boolean continuation = line.startsWith("\t") || line.startsWith("  ");
                if (continuation && current != null) {
                    applySocketStats(current, t);
                    continue;
                }
                if (t.startsWith("tcp") || t.startsWith("udp") || t.startsWith("raw")
                        || t.startsWith("u_str") || t.startsWith("u_dgr")) {
                    p.ssAvailable = true;
                    current = parseSocketLine(t);
                    if (current != null) {
                        if (current.pid == 0) {
                            p.restricted = true;
                        }
                        p.sockets.add(current);
                    }
                }
                continue;
            }
            if ("@@PS".equals(section)) {
                String[] a = t.split("\\s+", 3);
                if (a.length >= 2 && a[0].matches("\\d+")) {
                    p.users.put(Long.parseLong(a[0]), a[1]);
                }
            }
        }
        p.restricted = p.uid > 0 || p.restricted;
        return p;
    }

    private static void parseDevLine(Parsed p, String line) {
        int idx = line.indexOf(':');
        if (idx <= 0) {
            return;
        }
        String name = line.substring(0, idx).trim();
        if (name.isEmpty() || "lo".equals(name) || "face".equals(name)) {
            return;
        }
        String[] a = line.substring(idx + 1).trim().split("\\s+");
        if (a.length < 9) {
            return;
        }
        long rx = safeLong(a[0], -1);
        long tx = safeLong(a[8], -1);
        if (rx >= 0 && tx >= 0) {
            p.dev.put(name, new long[]{rx, tx});
        }
    }

    private static SocketInfo parseSocketLine(String line) {
        String[] a = line.split("\\s+");
        if (a.length < 6) {
            return null;
        }
        SocketInfo s = new SocketInfo();
        s.local = a[4];
        s.peer = a[5];
        Matcher pid = PID_RE.matcher(line);
        if (pid.find()) {
            s.name = pid.group(1);
            s.pid = safeLong(pid.group(2), 0);
        } else {
            s.name = "未知进程";
            s.pid = 0;
        }
        Matcher inode = INODE_RE.matcher(line);
        if (inode.find()) {
            s.key = "i" + inode.group(1);
        } else {
            s.key = a[0] + "|" + s.local + "|" + s.peer + "|" + s.pid;
        }
        s.loopback = isLoopback(s.local) || isLoopback(s.peer) || sameHost(s.local, s.peer);
        applySocketStats(s, line);
        return s;
    }

    private static void applySocketStats(SocketInfo s, String line) {
        Matcher rx = RX_RE.matcher(line);
        if (rx.find()) {
            s.rx = Math.max(s.rx, safeLong(rx.group(1), 0));
        }
        Matcher tx = TX_RE.matcher(line);
        if (tx.find()) {
            s.tx = Math.max(s.tx, safeLong(tx.group(1), 0));
        }
    }

    /* ---------------- 差分与聚合 ---------------- */

    static Map<String, Object> apply(State state, Parsed p, long now, boolean reset) {
        boolean first = reset || state.lastAt <= 0;
        long dtMs = first ? 0 : Math.max(0, now - state.lastAt);
        long rateDtMs = Math.max(dtMs, 500);
        if (first) {
            state.startedAt = now;
            state.prevSockets.clear();
            state.prevDev.clear();
            state.devBase.clear();
            state.totals.clear();
        }
        Map<Long, Totals> totals = state.totals;

        Map<Long, ProgramRow> rows = new LinkedHashMap<Long, ProgramRow>();
        Map<String, long[]> currentSockets = new LinkedHashMap<String, long[]>();
        long selfRxRate = 0;
        long selfTxRate = 0;
        for (SocketInfo s : p.sockets) {
            if (s.key == null || currentSockets.containsKey(s.key)) {
                continue;
            }
            long[] prev = state.prevSockets.get(s.key);
            long drx = 0;
            long dtx = 0;
            long rrx = 0;
            long rtx = 0;
            if (prev != null) {
                drx = Math.max(0, s.rx - prev[1]);
                dtx = Math.max(0, s.tx - prev[2]);
                if (dtMs > 0) {
                    rrx = drx * 1000 / rateDtMs;
                    rtx = dtx * 1000 / rateDtMs;
                }
            }
            currentSockets.put(s.key, new long[]{s.pid, s.rx, s.tx});
            if (p.selfPids.contains(s.pid)) {
                selfRxRate += rrx;
                selfTxRate += rtx;
                continue;
            }

            Totals total = totals.get(s.pid);
            if (total == null) {
                total = new Totals();
                totals.put(s.pid, total);
            }
            total.rx += drx;
            total.tx += dtx;
            if (!s.loopback) {
                total.extRx += drx;
                total.extTx += dtx;
            }

            ProgramRow row = rows.get(s.pid);
            if (row == null) {
                row = new ProgramRow();
                row.pid = s.pid;
                row.name = s.name;
                row.user = p.users.containsKey(s.pid) ? p.users.get(s.pid) : "";
                rows.put(s.pid, row);
            }
            row.conns++;
            if (s.loopback) {
                row.loopbackConns++;
            } else {
                row.extConns++;
            }
            row.addRate(rrx, rtx, s.loopback);
        }
        state.prevSockets.clear();
        state.prevSockets.putAll(currentSockets);

        /* 网卡总量（排除 lo） */
        long devRxNow = 0;
        long devTxNow = 0;
        Map<String, long[]> currentDev = new LinkedHashMap<String, long[]>();
        for (Map.Entry<String, long[]> e : p.dev.entrySet()) {
            devRxNow += e.getValue()[0];
            devTxNow += e.getValue()[1];
            currentDev.put(e.getKey(), e.getValue());
        }
        if (first) {
            state.devRxBase = devRxNow;
            state.devTxBase = devTxNow;
        }
        for (Map.Entry<String, long[]> e : currentDev.entrySet()) {
            if (!state.devBase.containsKey(e.getKey())) {
                state.devBase.put(e.getKey(), new long[]{e.getValue()[0], e.getValue()[1]});
            }
        }
        long devRxRate = 0;
        long devTxRate = 0;
        List<Map<String, Object>> interfaces = new ArrayList<Map<String, Object>>();
        for (Map.Entry<String, long[]> e : currentDev.entrySet()) {
            String name = e.getKey();
            long[] cur = e.getValue();
            long[] prev = state.prevDev.get(name);
            long[] base = state.devBase.get(name);
            long rxRate = 0;
            long txRate = 0;
            if (!first && prev != null && dtMs > 0) {
                rxRate = Math.max(0, cur[0] - prev[0]) * 1000 / rateDtMs;
                txRate = Math.max(0, cur[1] - prev[1]) * 1000 / rateDtMs;
            }
            if (base != null && (cur[0] < base[0] || cur[1] < base[1])) {
                base[0] = cur[0];
                base[1] = cur[1];
            }
            devRxRate += rxRate;
            devTxRate += txRate;
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("name", name);
            item.put("rxRate", rxRate);
            item.put("txRate", txRate);
            item.put("rxTotal", base == null ? 0 : Math.max(0, cur[0] - base[0]));
            item.put("txTotal", base == null ? 0 : Math.max(0, cur[1] - base[1]));
            item.put("speedMbps", p.speedMbps.containsKey(name) ? p.speedMbps.get(name) : 0);
            interfaces.add(item);
        }
        state.prevDev.clear();
        state.prevDev.putAll(currentDev);
        state.lastAt = now;

        long sumExtRx = 0;
        long sumExtTx = 0;
        long conns = 0;
        List<Map<String, Object>> programs = new ArrayList<Map<String, Object>>();
        for (ProgramRow row : rows.values()) {
            Totals total = totals.get(row.pid);
            if (total == null) {
                total = new Totals();
            }
            sumExtRx += row.extRxRate;
            sumExtTx += row.extTxRate;
            conns += row.conns;
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("pid", row.pid);
            item.put("name", row.name);
            item.put("user", row.user);
            item.put("rxRate", row.rxRate);
            item.put("txRate", row.txRate);
            item.put("extRxRate", row.extRxRate);
            item.put("extTxRate", row.extTxRate);
            item.put("rxTotal", total.rx);
            item.put("txTotal", total.tx);
            item.put("extRxTotal", total.extRx);
            item.put("extTxTotal", total.extTx);
            item.put("conns", row.conns);
            item.put("extConns", row.extConns);
            item.put("loopbackConns", row.loopbackConns);
            programs.add(item);
        }
        programs.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                double va = num(a.get("extRxRate")) + num(a.get("extTxRate"));
                double vb = num(b.get("extRxRate")) + num(b.get("extTxRate"));
                if (va != vb) {
                    return Double.compare(vb, va);
                }
                double ta = num(a.get("rxTotal")) + num(a.get("txTotal"));
                double tb = num(b.get("rxTotal")) + num(b.get("txTotal"));
                return Double.compare(tb, ta);
            }
        });
        if (programs.size() > MAX_PROGRAMS) {
            programs = new ArrayList<Map<String, Object>>(programs.subList(0, MAX_PROGRAMS));
        }

        Map<String, Object> system = new LinkedHashMap<String, Object>();
        system.put("rxRate", devRxRate);
        system.put("txRate", devTxRate);
        system.put("rxTotal", Math.max(0, devRxNow - state.devRxBase));
        system.put("txTotal", Math.max(0, devTxNow - state.devTxBase));
        system.put("rxBytes", devRxNow);
        system.put("txBytes", devTxNow);
        system.put("interfaces", interfaces);

        Map<String, Object> unattributed = new LinkedHashMap<String, Object>();
        unattributed.put("rxRate", Math.max(0, devRxRate - sumExtRx - selfRxRate));
        unattributed.put("txRate", Math.max(0, devTxRate - sumExtTx - selfTxRate));

        Map<String, Object> self = new LinkedHashMap<String, Object>();
        self.put("rxRate", selfRxRate);
        self.put("txRate", selfTxRate);
        self.put("excluded", !p.selfPids.isEmpty());

        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("sampledAt", now);
        data.put("firstSample", first);
        data.put("intervalMs", dtMs);
        data.put("durationMs", Math.max(0, now - state.startedAt));
        data.put("root", p.uid == 0);
        data.put("ssAvailable", p.ssAvailable);
        data.put("restricted", p.restricted);
        data.put("system", system);
        data.put("unattributed", unattributed);
        data.put("self", self);
        data.put("programs", programs);
        data.put("programCount", programs.size());
        data.put("connectionCount", conns);
        data.put("note", note(p));
        return data;
    }

    private static String note(Parsed p) {
        if (!p.ssAvailable) {
            return "服务器未安装或无法使用 ss（iproute2），只能显示网卡总流量";
        }
        if (p.restricted) {
            return "当前 SSH 用户不是 root，只能读取其有权限的进程；其余套接字归入未知进程";
        }
        return "数据来自 ss 套接字字节计数；UDP 和两次采样之间关闭的连接可能计入“未归属”";
    }

    private static final class ProgramRow {
        long pid;
        String name = "";
        String user = "";
        long rxRate;
        long txRate;
        long extRxRate;
        long extTxRate;
        int conns;
        int extConns;
        int loopbackConns;

        void addRate(long rx, long tx, boolean loopback) {
            rxRate += rx;
            txRate += tx;
            if (!loopback) {
                extRxRate += rx;
                extTxRate += tx;
            }
        }
    }

    /* ---------------- 地址与数值工具 ---------------- */

    static boolean isLoopback(String addressPort) {
        String host = hostOf(addressPort);
        if (host.isEmpty()) {
            return false;
        }
        host = host.toLowerCase();
        return "::1".equals(host) || "0:0:0:0:0:0:0:1".equals(host)
                || "localhost".equals(host) || host.startsWith("127.");
    }

    private static boolean sameHost(String a, String b) {
        String ha = hostOf(a);
        String hb = hostOf(b);
        return !ha.isEmpty() && ha.equalsIgnoreCase(hb);
    }

    static String hostOf(String addressPort) {
        String v = addressPort == null ? "" : addressPort.trim();
        int pct = v.indexOf('%');
        if (pct > 0) {
            int close = v.indexOf(']');
            if (close < 0 || pct < close) {
                v = v.substring(0, pct) + (close >= 0 ? v.substring(close) : "");
            }
        }
        String host;
        if (v.startsWith("[")) {
            int end = v.indexOf(']');
            host = end > 0 ? v.substring(1, end) : v;
        } else {
            int colon = v.lastIndexOf(':');
            host = colon > 0 ? v.substring(0, colon) : v;
        }
        if (host.toLowerCase().startsWith("::ffff:")) {
            host = host.substring(7);
        }
        return host;
    }

    private static double num(Object value) {
        return value instanceof Number ? ((Number) value).doubleValue() : 0;
    }

    private static long safeLong(String s, long def) {
        try {
            return Long.parseLong(s);
        } catch (Exception ignore) {
            return def;
        }
    }

    private static String firstLine(String text) {
        if (text == null) {
            return "sudo 执行失败，请检查当前用户权限";
        }
        for (String line : text.split("\r?\n")) {
            String value = line.trim();
            if (!value.isEmpty()) {
                return value.length() > 200 ? value.substring(0, 200) + "…" : value;
            }
        }
        return "sudo 执行失败，请检查当前用户权限";
    }
}
