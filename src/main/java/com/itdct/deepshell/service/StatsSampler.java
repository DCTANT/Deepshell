package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.StatsSnapshot;

import java.util.HashMap;
import java.util.Map;

/**
 * 服务器监控采样：通过 SSH exec 通道执行一段无外部依赖的 /proc 采样脚本（Linux），
 * 输出结构化文本后由本类解析并做差分计算（CPU%、网络速率）。
 */
public final class StatsSampler {

    private StatsSampler() {
    }

    public static final String SAMPLE_SCRIPT =
            "echo c $(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8+$9, $5+$6}' /proc/stat); " +
            "echo l $(cut -d' ' -f1 /proc/loadavg); " +
            "echo m $(awk '/MemTotal:/{t=$2} /MemAvailable:/{a=$2} /MemFree:/{f=$2} /Buffers:/{b=$2} /^Cached:/{c=$2} /SwapTotal:/{st=$2} /SwapFree:/{sf=$2} END{if(a==\"\")a=f+b+c; print t, a, st+0, sf+0}' /proc/meminfo); " +
            "echo n $(awk 'NR>2 && $1!=\"lo:\" {rx+=$2; tx+=$10} END{print rx+0, tx+0}' /proc/net/dev); " +
            "echo u $(cut -d' ' -f1 /proc/uptime); " +
            "echo h $(uname -n 2>/dev/null || hostname 2>/dev/null || echo unknown)";

    /** 相邻两次采样的差分状态（每个会话一份） */
    public static class Prev {
        long cpuTotal = -1;
        long cpuIdle = -1;
        long netRx = -1;
        long netTx = -1;
        long timeMs = -1;
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
        String c = kv.get("c");
        String m = kv.get("m");
        String n = kv.get("n");
        if (c == null || m == null || n == null) {
            throw new IllegalArgumentException("采样输出不完整（可能是非 Linux 服务器）");
        }
        String[] cparts = c.split("\\s+");
        long cpuTotal = Long.parseLong(cparts[0]);
        long cpuIdle = Long.parseLong(cparts[1]);
        String[] mparts = m.split("\\s+");
        long memTotalKb = Long.parseLong(mparts[0]);
        long memAvailKb = Long.parseLong(mparts[1]);
        long swapTotalKb = mparts.length >= 3 ? Long.parseLong(mparts[2]) : 0;
        long swapFreeKb = mparts.length >= 4 ? Long.parseLong(mparts[3]) : 0;
        String[] nparts = n.split("\\s+");
        long netRx = Long.parseLong(nparts[0]);
        long netTx = Long.parseLong(nparts[1]);

        StatsSnapshot s = new StatsSnapshot();
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
        s.setHost(kv.get("h") == null ? "" : kv.get("h"));
        s.setLoad1(kv.get("l"));
        String u = kv.get("u");
        if (u != null) {
            try {
                s.setUptimeSecs((long) Double.parseDouble(u));
            } catch (NumberFormatException ignore) {
            }
        }

        if (prev.cpuTotal >= 0) {
            long dt = cpuTotal - prev.cpuTotal;
            long di = cpuIdle - prev.cpuIdle;
            if (dt > 0) {
                int cpu = (int) Math.round(100.0 * (dt - di) / dt);
                s.setCpu(Math.max(0, Math.min(100, cpu)));
            }
        }
        if (prev.timeMs >= 0 && prev.netRx >= 0) {
            long dtMs = nowMs - prev.timeMs;
            if (dtMs > 0) {
                s.setRxRate(Math.max(0, (netRx - prev.netRx) * 1000 / dtMs));
                s.setTxRate(Math.max(0, (netTx - prev.netTx) * 1000 / dtMs));
            }
        }

        prev.cpuTotal = cpuTotal;
        prev.cpuIdle = cpuIdle;
        prev.netRx = netRx;
        prev.netTx = netTx;
        prev.timeMs = nowMs;
        return s;
    }
}
