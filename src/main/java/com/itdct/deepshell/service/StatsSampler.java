package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.StatsSnapshot;

import java.util.HashMap;
import java.util.Map;

/**
 * 服务器监控采样：通过 SSH exec 通道执行一段无外部依赖的 /proc 采样脚本（Linux），
 * 输出结构化文本后由本类解析并做差分计算（CPU%、网络速率）。
 * <p>
 * Android/Termux 上 /proc/stat、/proc/loadavg、/proc/uptime、/proc/net/dev 被 SELinux 禁止访问：
 * 脚本对不可读的源自动降级——负载/运行时长改用 uptime 命令（sysinfo 系统调用），
 * CPU 改用 /sys 下 cpufreq 频率累计时间差分估算；仍取不到的指标（如网络速率）解析为 null，
 * 由前端显示为 "--"，不再因此停用整个监控。
 */
public final class StatsSampler {

    private StatsSampler() {
    }

    public static final String SAMPLE_SCRIPT =
            "export LC_ALL=C;\n" +
            "c=$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8+$9, $5+$6; exit}' /proc/stat 2>/dev/null);\n" +
            "[ -n \"$c\" ] && echo c $c;\n" +
            "l=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null);\n" +
            "[ -n \"$l\" ] && echo l $l;\n" +
            "u=$(cut -d' ' -f1 /proc/uptime 2>/dev/null);\n" +
            "[ -n \"$u\" ] && echo u $u;\n" +
            "mv=$(awk '/MemTotal:/{t=$2} /MemAvailable:/{a=$2} /MemFree:/{f=$2} /Buffers:/{b=$2} /^Cached:/{c=$2} /SwapTotal:/{st=$2} /SwapFree:/{sf=$2} END{if(a==\"\")a=f+b+c; print t, a, st+0, sf+0}' /proc/meminfo 2>/dev/null);\n" +
            "[ -n \"$mv\" ] && echo m $mv;\n" +
            "nw=$(awk 'NR>2 && $1!=\"lo:\" {rx+=$2; tx+=$10} END{print rx+0, tx+0}' /proc/net/dev 2>/dev/null);\n" +
            "[ -n \"$nw\" ] && echo n $nw;\n" +
            "if [ -z \"$l\" ]; then l=$(LC_ALL=C uptime 2>/dev/null | sed -n 's/.*load average: *\\([0-9.]*\\).*/\\1/p'); [ -n \"$l\" ] && echo l $l; fi;\n" +
            "if [ -z \"$u\" ]; then bt=$(LC_ALL=C uptime -s 2>/dev/null); if [ -n \"$bt\" ]; then bs=$(date -d \"$bt\" +%s 2>/dev/null); if [ -n \"$bs\" ]; then echo u $(( $(date +%s) - bs )); fi; fi; fi;\n" +
            "if [ -z \"$c\" ]; then for d in /sys/devices/system/cpu/cpu*/cpufreq; do cn=${d%/cpufreq}; cn=${cn##*/}; mn=$(cat $d/scaling_min_freq 2>/dev/null); mx=$(cat $d/scaling_max_freq 2>/dev/null); if [ -n \"$mn\" ] && [ -n \"$mx\" ]; then awk -v n=\"$cn\" -v mn=\"$mn\" -v mx=\"$mx\" '{T+=$1*$2; S+=$2} END{if(S>0) print \"f\" n, T, S, mn, mx}' $d/stats/time_in_state 2>/dev/null; fi; done; fi;\n" +
            "echo h $(uname -n 2>/dev/null || hostname 2>/dev/null || echo unknown);\n";

    /** 相邻两次采样的差分状态（每个会话一份） */
    public static class Prev {
        long cpuTotal = -1;
        long cpuIdle = -1;
        long netRx = -1;
        long netTx = -1;
        long timeMs = -1;
        /** Android 降级路径：各 CPU 核的 cpufreq 累计值（{Σ频率×时间, Σ时间}），键为 fcpu0、fcpu1... */
        final Map<String, long[]> freq = new HashMap<>();
    }

    public static StatsSnapshot compute(Prev prev, String raw, long nowMs) {
        Map<String, String> kv = new HashMap<>();
        if (raw != null) {
            for (String line : raw.split("\\r?\\n")) {
                line = line.trim();
                if (line.isEmpty()) {
                    continue;
                }
                int sp = line.indexOf(' ');
                if (sp <= 0) {
                    continue;
                }
                kv.put(line.substring(0, sp), line.substring(sp + 1).trim());
            }
        }
        StatsSnapshot s = new StatsSnapshot();
        boolean usable = parseMem(s, kv.get("m"));
        usable |= parseCpu(prev, s, kv);
        usable |= parseNet(prev, s, kv.get("n"), nowMs);
        s.setHost(kv.get("h") == null ? "" : kv.get("h"));
        s.setLoad1(kv.get("l"));
        String u = kv.get("u");
        if (u != null) {
            try {
                s.setUptimeSecs((long) Double.parseDouble(u));
            } catch (NumberFormatException ignore) {
            }
        }
        prev.timeMs = nowMs;
        if (!usable) {
            throw new IllegalArgumentException("采样输出不完整（可能是非 Linux 服务器）");
        }
        return s;
    }

    private static boolean parseMem(StatsSnapshot s, String m) {
        if (m == null) {
            return false;
        }
        try {
            String[] mparts = m.split("\\s+");
            long memTotalKb = Long.parseLong(mparts[0]);
            long memAvailKb = Long.parseLong(mparts[1]);
            long swapTotalKb = mparts.length >= 3 ? Long.parseLong(mparts[2]) : 0;
            long swapFreeKb = mparts.length >= 4 ? Long.parseLong(mparts[3]) : 0;
            long memUsedKb = Math.max(0, memTotalKb - memAvailKb);
            s.setMemTotalMb(memTotalKb / 1024);
            s.setMemUsedMb(memUsedKb / 1024);
            s.setSwapTotalMb(swapTotalKb / 1024);
            long swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb);
            s.setSwapUsedMb(swapUsedKb / 1024);
            s.setSwapPct(swapTotalKb > 0 ? (int) Math.round(100.0 * swapUsedKb / swapTotalKb) : 0);
            if (memTotalKb > 0) {
                s.setMemPct((int) Math.round(100.0 * memUsedKb / memTotalKb));
            }
            return true;
        } catch (RuntimeException ignore) {
            return false;
        }
    }

    private static boolean parseCpu(Prev prev, StatsSnapshot s, Map<String, String> kv) {
        String c = kv.get("c");
        if (c != null) {
            try {
                String[] cparts = c.split("\\s+");
                long cpuTotal = Long.parseLong(cparts[0]);
                long cpuIdle = Long.parseLong(cparts[1]);
                if (prev.cpuTotal >= 0) {
                    long dt = cpuTotal - prev.cpuTotal;
                    long di = cpuIdle - prev.cpuIdle;
                    if (dt > 0) {
                        int cpu = (int) Math.round(100.0 * (dt - di) / dt);
                        s.setCpu(Math.max(0, Math.min(100, cpu)));
                    }
                }
                prev.cpuTotal = cpuTotal;
                prev.cpuIdle = cpuIdle;
                return true;
            } catch (RuntimeException ignore) {
                // 输出异常时继续尝试频率估算
            }
        }
        return estimateCpu(prev, s, kv);
    }

    /** Android 降级：按 cpufreq 累计时间的差分求区间平均频率，折算到 [scaling_min, scaling_max] 区间 */
    private static boolean estimateCpu(Prev prev, StatsSnapshot s, Map<String, String> kv) {
        double ratioSum = 0;
        int cores = 0;
        boolean seen = false;
        for (Map.Entry<String, String> e : kv.entrySet()) {
            String key = e.getKey();
            if (key.length() < 2 || key.charAt(0) != 'f') {
                continue;
            }
            seen = true;
            String[] fp = e.getValue().split("\\s+");
            if (fp.length < 4) {
                continue;
            }
            long t;
            long sum;
            long min;
            long max;
            try {
                t = Long.parseLong(fp[0]);
                sum = Long.parseLong(fp[1]);
                min = Long.parseLong(fp[2]);
                max = Long.parseLong(fp[3]);
            } catch (NumberFormatException nfe) {
                continue;
            }
            long[] last = prev.freq.put(key, new long[]{t, sum});
            if (last == null || sum <= last[1] || max <= min) {
                continue;
            }
            double avgFreq = (double) (t - last[0]) / (sum - last[1]);
            double ratio = (avgFreq - min) / (double) (max - min);
            ratioSum += Math.max(0, Math.min(1, ratio));
            cores++;
        }
        if (cores > 0) {
            s.setCpu((int) Math.round(100.0 * ratioSum / cores));
        }
        return seen;
    }

    private static boolean parseNet(Prev prev, StatsSnapshot s, String n, long nowMs) {
        if (n == null) {
            return false;
        }
        long netRx;
        long netTx;
        try {
            String[] nparts = n.split("\\s+");
            netRx = Long.parseLong(nparts[0]);
            netTx = Long.parseLong(nparts[1]);
        } catch (RuntimeException ignore) {
            return false;
        }
        if (prev.timeMs >= 0 && prev.netRx >= 0) {
            long dtMs = nowMs - prev.timeMs;
            if (dtMs > 0) {
                s.setRxRate(Math.max(0, (netRx - prev.netRx) * 1000 / dtMs));
                s.setTxRate(Math.max(0, (netTx - prev.netTx) * 1000 / dtMs));
            }
        }
        prev.netRx = netRx;
        prev.netTx = netTx;
        return true;
    }
}
