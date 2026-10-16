package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.ProcessEntry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 服务器进程列表：单次 exec 采集「/proc 累计 CPU jiffies + 三种 ps 格式候选」，
 * 相邻两次快照差分得到瞬时 CPU%（与任务管理器同原理）。
 * 解析策略：P1=procps 全字段 -> P2=ps aux -> P3=ps -ef，取第一个能解析出条目的格式，
 * 保证老旧系统 / BusyBox / 受限 ps 环境下仍可用。
 */
@Slf4j
@Service
public class ProcessService {

    public static final String SAMPLE_SCRIPT =
            "export LC_ALL=C 2>/dev/null; export LANG=C 2>/dev/null; " +
            "echo ct $(getconf CLK_TCK 2>/dev/null || echo 100); " +
            "echo nc $(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1); " +
            "awk '{print \"j\", $1, $(NF-38)+$(NF-39)}' /proc/[0-9]*/stat 2>/dev/null; " +
            "echo P1; ps -eo pid=,ppid=,user=,pcpu=,pmem=,rss=,stat=,etimes=,comm=,args= 2>/dev/null; " +
            "echo P2; ps aux 2>/dev/null; " +
            "echo P3; ps -ef 2>/dev/null";

    static class Parsed {
        double clkTck = 100;
        int cores = 1;
        Map<Long, Long> jiffies = new HashMap<>();
        List<ProcessEntry> entries = new ArrayList<>();
        String format;
    }

    private static class Prev {
        final Map<Long, Long> jiffies;
        final long timeMs;

        Prev(Map<Long, Long> jiffies, long timeMs) {
            this.jiffies = jiffies;
            this.timeMs = timeMs;
        }
    }

    private final SshSessionManager sessions;
    private final Map<String, Prev> prevMap = new ConcurrentHashMap<>();

    public ProcessService(SshSessionManager sessions) {
        this.sessions = sessions;
    }

    public List<ProcessEntry> list(String sessionId) throws Exception {
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String raw = sessions.execCapture(s, SAMPLE_SCRIPT, 12000);
        Parsed p = parse(raw);
        long now = System.currentTimeMillis();
        Prev prev = prevMap.get(sessionId);
        if (prev != null) {
            applyInstantCpu(p.entries, p.jiffies, prev.jiffies, prev.timeMs, now, p.clkTck, p.cores);
        }
        prevMap.put(sessionId, new Prev(p.jiffies, now));
        if (prevMap.size() > 32) {
            prevMap.keySet().removeIf(id -> !sessions.exists(id));
        }
        return p.entries;
    }

    public void kill(String sessionId, long pid, boolean force) throws Exception {
        if (pid <= 1 || pid > 4194304L) {
            throw new IllegalArgumentException("PID 不合法（不允许操作系统关键进程）");
        }
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String out = sessions.execCapture(s, "kill " + (force ? "-9 " : "-TERM ") + pid + " 2>&1", 5000);
        if (out != null && !out.trim().isEmpty()) {
            throw new IllegalStateException("结束进程失败: " + out.trim());
        }
    }

    /** 读取进程完整命令行（/proc/<pid>/cmdline，不受列表展示的截断限制） */
    public String detail(String sessionId, long pid) throws Exception {
        if (pid <= 0) {
            throw new IllegalArgumentException("PID 不合法");
        }
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String out = sessions.execCapture(s,
                "tr '\\0' ' ' < /proc/" + pid + "/cmdline 2>/dev/null; echo", 5000);
        String cmd = out == null ? "" : out.trim();
        if (cmd.isEmpty()) {
            throw new IllegalStateException("无法读取命令行（进程可能已退出或为内核线程）");
        }
        return cmd;
    }

    /* ---------- 解析与计算（包级可见，便于单元测试） ---------- */

    static Parsed parse(String raw) {
        Parsed p = new Parsed();
        if (raw == null || raw.trim().isEmpty()) {
            throw new IllegalArgumentException("采样输出为空（可能是非 Linux 服务器）");
        }
        Map<String, List<String>> sections = new LinkedHashMap<>();
        String current = null;
        for (String line : raw.split("\\r?\\n")) {
            String t = line.trim();
            if (t.isEmpty()) {
                continue;
            }
            if ("P1".equals(t) || "P2".equals(t) || "P3".equals(t)) {
                current = t;
                sections.put(current, new ArrayList<>());
                continue;
            }
            if (current != null) {
                sections.get(current).add(t);
                continue;
            }
            if (t.startsWith("ct ")) {
                p.clkTck = safeDouble(t.substring(3).trim(), 100.0);
            } else if (t.startsWith("nc ")) {
                p.cores = (int) Math.max(1, safeDouble(t.substring(3).trim(), 1.0));
            } else if (t.startsWith("j ")) {
                String[] a = t.split("\\s+");
                if (a.length >= 3) {
                    try {
                        p.jiffies.put(Long.parseLong(a[1]), Long.parseLong(a[2]));
                    } catch (NumberFormatException ignore) {
                    }
                }
            }
        }
        for (String fmt : new String[]{"P1", "P2", "P3"}) {
            List<String> lines = sections.get(fmt);
            if (lines == null || lines.isEmpty()) {
                continue;
            }
            List<ProcessEntry> entries = new ArrayList<>();
            for (String t : lines) {
                ProcessEntry e = parseRow(fmt, t);
                if (e != null) {
                    entries.add(e);
                }
            }
            if (!entries.isEmpty()) {
                p.entries = entries;
                p.format = fmt;
                return p;
            }
        }
        String preview = raw.replace('\r', ' ').replace('\n', '|').trim();
        if (preview.length() > 400) {
            preview = preview.substring(0, 400) + "...";
        }
        if (sections.isEmpty()) {
            throw new IllegalArgumentException("远程命令未返回预期结构（可能 shell 受限）。原始输出: " + preview);
        }
        throw new IllegalArgumentException("无法获取进程列表（ps 输出无法解析）。原始输出: " + preview);
    }

    private static ProcessEntry parseRow(String fmt, String t) {
        try {
            if ("P1".equals(fmt)) {
                // pid ppid user pcpu pmem rss stat etimes comm args
                String[] a = t.split("\\s+", 10);
                if (a.length < 9 || !a[0].matches("\\d+") || !a[1].matches("\\d+")) {
                    return null;
                }
                ProcessEntry e = new ProcessEntry();
                e.setPid(Long.parseLong(a[0]));
                e.setPpid(Long.parseLong(a[1]));
                e.setUser(a[2]);
                e.setCpuAvg(safeDouble(a[3], 0));
                e.setMemPct(safeDouble(a[4], 0));
                e.setRssMb(safeLong(a[5], 0) / 1024);
                e.setState(a[6]);
                e.setElapsedSecs(safeLong(a[7], -1));
                e.setComm(a[8]);
                e.setArgs(a.length > 9 ? truncate(a[9], 500) : a[8]);
                return e;
            }
            if ("P2".equals(fmt)) {
                // USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
                String[] a = t.split("\\s+", 11);
                if (a.length < 10 || !a[1].matches("\\d+")) {
                    return null;
                }
                ProcessEntry e = new ProcessEntry();
                e.setUser(a[0]);
                e.setPid(Long.parseLong(a[1]));
                e.setCpuAvg(safeDouble(a[2], 0));
                e.setMemPct(safeDouble(a[3], 0));
                e.setRssMb(safeLong(a[5], 0) / 1024);
                e.setState(a[7]);
                e.setElapsedSecs(-1);
                String cmd = a.length >= 11 ? a[10] : "";
                e.setArgs(truncate(cmd, 500));
                e.setComm(baseName(cmd));
                return e;
            }
            // P3: UID PID PPID C STIME TTY TIME CMD
            String[] a = t.split("\\s+", 8);
            if (a.length < 7 || !a[1].matches("\\d+") || !a[2].matches("\\d+")) {
                return null;
            }
            ProcessEntry e = new ProcessEntry();
            e.setUser(a[0]);
            e.setPid(Long.parseLong(a[1]));
            e.setPpid(Long.parseLong(a[2]));
            e.setCpuAvg(safeDouble(a[3], 0));
            e.setRssMb(0);
            e.setMemPct(0.0);
            e.setState("");
            e.setElapsedSecs(-1);
            String cmd = a.length >= 8 ? a[7] : "";
            e.setArgs(truncate(cmd, 500));
            e.setComm(baseName(cmd));
            return e;
        } catch (Exception ignore) {
            return null;
        }
    }

    static void applyInstantCpu(List<ProcessEntry> entries, Map<Long, Long> jiffies,
                                Map<Long, Long> prev, long prevMs, long nowMs, double clkTck, int cores) {
        if (prev == null || prev.isEmpty() || clkTck <= 0) {
            return;
        }
        double dtSec = (nowMs - prevMs) / 1000.0;
        if (dtSec <= 0.3) {
            return;
        }
        for (ProcessEntry e : entries) {
            Long j = jiffies.get(e.getPid());
            Long pj = prev.get(e.getPid());
            if (j == null || pj == null) {
                continue;
            }
            double cpu = (j - pj) / clkTck / dtSec * 100.0 / Math.max(1, cores);
            if (cpu < 0) {
                cpu = 0;
            }
            if (cpu > 100) {
                cpu = 100;
            }
            e.setCpu(Math.round(cpu * 10) / 10.0);
        }
    }

    private static String baseName(String cmd) {
        if (cmd == null || cmd.isEmpty()) {
            return "";
        }
        String base = cmd;
        int sp = base.indexOf(' ');
        if (sp > 0) {
            base = base.substring(0, sp);
        }
        int sl = base.lastIndexOf('/');
        if (sl >= 0 && sl < base.length() - 1) {
            base = base.substring(sl + 1);
        }
        return base;
    }

    private static double safeDouble(String s, double def) {
        try {
            return Double.parseDouble(s);
        } catch (Exception e) {
            try {
                return Double.parseDouble(s.replace(',', '.'));
            } catch (Exception e2) {
                return def;
            }
        }
    }

    private static long safeLong(String s, long def) {
        try {
            return Long.parseLong(s);
        } catch (Exception e) {
            return def;
        }
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }
}
