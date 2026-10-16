package com.itdct.deepshell.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 服务器系统信息：一次 exec 采集（基础信息 + CPU 详情 + CPU 占用七态实时% + 内存/交换 +
 * 各网卡收发与速率 + 全部文件系统）。
 * 采用两次采样（间隔 1 秒）差分得到实时 CPU 占用明细与网卡速率；仅支持 Linux，缺失项全部容错。
 */
@Service
public class SystemInfoService {

    public static final String SAMPLE_SCRIPT =
            "export LC_ALL=C 2>/dev/null; export LANG=C 2>/dev/null; " +
            "echo \"hostname=$(hostname 2>/dev/null)\"; " +
            "if [ -f /etc/os-release ]; then . /etc/os-release 2>/dev/null; echo \"os=$PRETTY_NAME\"; " +
            "elif [ -f /etc/redhat-release ]; then echo \"os=$(cat /etc/redhat-release 2>/dev/null)\"; " +
            "else echo \"os=$(uname -s 2>/dev/null)\"; fi; " +
            "echo \"kernel=$(uname -r 2>/dev/null)\"; " +
            "echo \"arch=$(uname -m 2>/dev/null)\"; " +
            "echo \"cpu=$(awk -F: '/model name/{gsub(/^ +/,\"\",$2); print $2; exit}' /proc/cpuinfo 2>/dev/null)\"; " +
            "echo \"cores=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null)\"; " +
            "echo \"mhz=$(awk -F: '/cpu MHz/{gsub(/^ +/,\"\",$2); print $2; exit}' /proc/cpuinfo 2>/dev/null)\"; " +
            "echo \"cache=$(awk -F: '/cache size/{gsub(/^ +/,\"\",$2); print $2; exit}' /proc/cpuinfo 2>/dev/null)\"; " +
            "echo \"bogo=$(awk -F: '/BogoMIPS/{gsub(/^ +/,\"\",$2); print $2; exit}' /proc/cpuinfo 2>/dev/null)\"; " +
            "echo \"memtotal=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null)\"; " +
            "echo \"memavail=$(awk '/MemAvailable/{print $2}' /proc/meminfo 2>/dev/null)\"; " +
            "echo \"swaptotal=$(awk '/SwapTotal/{print $2}' /proc/meminfo 2>/dev/null)\"; " +
            "echo \"swapfree=$(awk '/SwapFree/{print $2}' /proc/meminfo 2>/dev/null)\"; " +
            "echo \"uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)\"; " +
            "echo \"load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)\"; " +
            "echo \"ips=$(hostname -I 2>/dev/null)\"; " +
            "echo \"time=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null)\"; " +
            "echo \"ts1 $(date +%s 2>/dev/null)\"; " +
            "echo \"s1 $(head -1 /proc/stat 2>/dev/null)\"; " +
            "awk 'NR>2 {sub(\":\",\"\",$1); if ($1!=\"lo\") print \"n1 \"$1\" \"$2\" \"$10}' /proc/net/dev 2>/dev/null; " +
            "sleep 1; " +
            "echo \"ts2 $(date +%s 2>/dev/null)\"; " +
            "echo \"s2 $(head -1 /proc/stat 2>/dev/null)\"; " +
            "awk 'NR>2 {sub(\":\",\"\",$1); if ($1!=\"lo\") print \"n2 \"$1\" \"$2\" \"$10}' /proc/net/dev 2>/dev/null; " +
            "df -Pk 2>/dev/null | awk 'NR>1 && $1!~/^(tmpfs|devtmpfs|udev|none)$/ {p=$5; sub(\"%\",\"\",p); m=$6; for(i=7;i<=NF;i++) m=m\" \"$i; print \"df \"$1\" \"$2\" \"$3\" \"$4\" \"p\" \"m}'";

    private final SshSessionManager sessions;

    public SystemInfoService(SshSessionManager sessions) {
        this.sessions = sessions;
    }

    public Map<String, Object> collect(String sessionId) throws Exception {
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String raw = sessions.execCapture(s, SAMPLE_SCRIPT, 15000);
        if (raw == null || !raw.contains("hostname=")) {
            String snippet = raw == null ? "" : raw.trim();
            if (snippet.length() > 400) {
                snippet = snippet.substring(0, 400) + "…";
            }
            throw new IllegalStateException("无法获取系统信息（仅支持 Linux 服务器）。服务器返回片段：" + snippet);
        }
        return format(raw);
    }

    /** 解析脚本输出为分区结构，便于单元测试 */
    public static Map<String, Object> format(String raw) {
        Map<String, String> kv = new HashMap<>();
        Map<String, long[]> net1 = new LinkedHashMap<>();
        Map<String, long[]> net2 = new LinkedHashMap<>();
        List<Map<String, Object>> disk = new ArrayList<>();
        if (raw != null) {
            for (String line : raw.split("\\r?\\n")) {
                String t = line.trim();
                if (t.isEmpty()) {
                    continue;
                }
                if (t.startsWith("n1 ") || t.startsWith("n2 ")) {
                    String[] p = t.split("\\s+");
                    if (p.length >= 4) {
                        long rx = parseLong2(p[2]);
                        long tx = parseLong2(p[3]);
                        (t.startsWith("n1 ") ? net1 : net2).put(p[1], new long[]{rx, tx});
                    }
                    continue;
                }
                if (t.startsWith("df ")) {
                    String[] p = t.split("\\s+", 7);
                    if (p.length >= 7) {
                        Map<String, Object> d = new LinkedHashMap<>();
                        d.put("fs", p[1]);
                        d.put("sizeKb", parseLong2(p[2]));
                        d.put("usedKb", parseLong2(p[3]));
                        d.put("availKb", parseLong2(p[4]));
                        d.put("pct", parseLong2(p[5]));
                        d.put("mount", p[6]);
                        disk.add(d);
                    }
                    continue;
                }
                if (t.startsWith("s1 ")) {
                    kv.put("s1", t.substring(3));
                    continue;
                }
                if (t.startsWith("s2 ")) {
                    kv.put("s2", t.substring(3));
                    continue;
                }
                if (t.startsWith("ts1 ")) {
                    kv.put("ts1", t.substring(4));
                    continue;
                }
                if (t.startsWith("ts2 ")) {
                    kv.put("ts2", t.substring(4));
                    continue;
                }
                int eq = t.indexOf('=');
                if (eq > 0) {
                    kv.put(t.substring(0, eq), t.substring(eq + 1).trim());
                }
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("basic", basicRows(kv));
        result.put("cpu", cpuRows(kv));
        result.put("cpuUsage", cpuUsageRows(kv));
        result.put("memory", memoryRows(kv));
        result.put("net", netRows(kv, net1, net2));
        result.put("disk", disk);
        return result;
    }

    private static List<Map<String, String>> basicRows(Map<String, String> kv) {
        List<Map<String, String>> rows = new ArrayList<>();
        add(rows, "主机名", kv.get("hostname"));
        add(rows, "操作系统", kv.get("os"));
        add(rows, "内核版本", kv.get("kernel"));
        add(rows, "硬件架构", kv.get("arch"));
        add(rows, "IP 地址", kv.get("ips"));
        add(rows, "运行时长", formatUptime(kv.get("uptime")));
        add(rows, "负载（1/5/15 分钟）", kv.get("load"));
        add(rows, "系统时间", kv.get("time"));
        return rows;
    }

    private static List<Map<String, String>> cpuRows(Map<String, String> kv) {
        List<Map<String, String>> rows = new ArrayList<>();
        add(rows, "CPU 型号", kv.get("cpu"));
        String cores = kv.get("cores");
        add(rows, "核心数", cores == null || cores.isEmpty() ? null : cores + " 核");
        String mhz = kv.get("mhz");
        add(rows, "主频", mhz == null || mhz.isEmpty() ? null : mhz + " MHz");
        add(rows, "缓存", kv.get("cache"));
        add(rows, "BogoMIPS", kv.get("bogo"));
        return rows;
    }

    private static List<Map<String, String>> cpuUsageRows(Map<String, String> kv) {
        List<Map<String, String>> rows = new ArrayList<>();
        long[] j1 = parseCpuLine(kv.get("s1"));
        long[] j2 = parseCpuLine(kv.get("s2"));
        if (j1 == null || j2 == null) {
            return rows;
        }
        long[] deltas = new long[j1.length];
        long total = 0;
        for (int i = 0; i < j1.length; i++) {
            deltas[i] = Math.max(0, j2[i] - j1[i]);
            total += deltas[i];
        }
        if (total <= 0) {
            return rows;
        }
        double idlePct = deltas[3] * 100.0 / total;
        add(rows, "实时占用", pct1(100 - idlePct));
        String[] names = {"用户", "Nice", "系统", "空闲", "IO 等待", "硬中断", "软中断", "被抢占"};
        int[] order = {0, 1, 2, 3, 4, 5, 6, 7};
        for (int idx : order) {
            if (idx >= deltas.length) {
                continue;
            }
            add(rows, names[idx], pct1(deltas[idx] * 100.0 / total));
        }
        return rows;
    }

    private static List<Map<String, String>> memoryRows(Map<String, String> kv) {
        List<Map<String, String>> rows = new ArrayList<>();
        Long memTotal = parseLong(kv.get("memtotal"));
        Long memAvail = parseLong(kv.get("memavail"));
        if (memTotal != null && memTotal > 0) {
            if (memAvail != null && memAvail >= 0) {
                long used = Math.max(0, memTotal - memAvail);
                add(rows, "物理内存", "已用 " + gb(used) + " / 共 " + gb(memTotal)
                        + " (" + Math.round(used * 100.0 / memTotal) + "%)");
                add(rows, "物理内存剩余", gb(memAvail));
            } else {
                add(rows, "物理内存", "共 " + gb(memTotal));
            }
        }
        Long swapTotal = parseLong(kv.get("swaptotal"));
        Long swapFree = parseLong(kv.get("swapfree"));
        if (swapTotal == null || swapTotal <= 0) {
            add(rows, "交换分区", "未启用");
        } else {
            long used = Math.max(0, swapTotal - (swapFree == null ? swapTotal : swapFree));
            add(rows, "交换分区", "已用 " + gb(used) + " / 共 " + gb(swapTotal)
                    + " (" + Math.round(used * 100.0 / swapTotal) + "%)");
            add(rows, "交换分区剩余", gb(swapFree == null ? swapTotal : swapFree));
        }
        return rows;
    }

    private static List<Map<String, Object>> netRows(Map<String, String> kv,
                                                     Map<String, long[]> net1,
                                                     Map<String, long[]> net2) {
        List<Map<String, Object>> rows = new ArrayList<>();
        Long ts1 = parseLong(kv.get("ts1"));
        Long ts2 = parseLong(kv.get("ts2"));
        long dtSec = (ts1 != null && ts2 != null && ts2 > ts1) ? (ts2 - ts1) : 1;
        for (Map.Entry<String, long[]> e : net2.entrySet()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("name", e.getKey());
            row.put("rxBytes", e.getValue()[0]);
            row.put("txBytes", e.getValue()[1]);
            long[] prev = net1.get(e.getKey());
            if (prev != null) {
                row.put("rxRate", Math.max(0, (e.getValue()[0] - prev[0]) / dtSec));
                row.put("txRate", Math.max(0, (e.getValue()[1] - prev[1]) / dtSec));
            }
            rows.add(row);
        }
        return rows;
    }

    private static void add(List<Map<String, String>> rows, String label, String value) {
        if (value == null || value.trim().isEmpty()) {
            return;
        }
        Map<String, String> row = new LinkedHashMap<>();
        row.put("label", label);
        row.put("value", value.trim());
        rows.add(row);
    }

    /** /proc/stat 首行 -> [user, nice, system, idle, iowait, irq, softirq, steal] */
    static long[] parseCpuLine(String line) {
        if (line == null || line.trim().isEmpty()) {
            return null;
        }
        String[] p = line.trim().split("\\s+");
        if (p.length < 5 || !"cpu".equals(p[0])) {
            return null;
        }
        long[] out = new long[8];
        for (int i = 0; i < out.length; i++) {
            int idx = i + 1;
            if (idx < p.length) {
                try {
                    out[i] = Long.parseLong(p[idx]);
                } catch (NumberFormatException ignore) {
                }
            }
        }
        return out;
    }

    /** 秒 -> 「X 天 X 小时 X 分」 */
    static String formatUptime(String secs) {
        Long s = parseLong(secs);
        if (s == null || s < 0) {
            return null;
        }
        long days = s / 86400;
        long hours = (s % 86400) / 3600;
        long minutes = (s % 3600) / 60;
        StringBuilder sb = new StringBuilder();
        if (days > 0) {
            sb.append(days).append(" 天 ");
        }
        if (days > 0 || hours > 0) {
            sb.append(hours).append(" 小时 ");
        }
        sb.append(minutes).append(" 分");
        return sb.toString();
    }

    private static String pct1(double v) {
        return String.format(Locale.ROOT, "%.1f%%", v);
    }

    private static String gb(long kb) {
        return String.format(Locale.ROOT, "%.1f", kb / 1024.0 / 1024.0) + " GB";
    }

    private static Long parseLong(String s) {
        if (s == null || s.trim().isEmpty()) {
            return null;
        }
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static long parseLong2(String s) {
        Long v = parseLong(s);
        return v == null ? 0L : v;
    }
}
