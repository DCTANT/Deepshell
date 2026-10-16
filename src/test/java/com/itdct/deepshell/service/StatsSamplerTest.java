package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.StatsSnapshot;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class StatsSamplerTest {

    private static String raw(long cpuTotal, long cpuIdle, long memTotalKb, long memAvailKb, long rx, long tx) {
        return "c " + cpuTotal + " " + cpuIdle + "\n"
                + "l 0.42\n"
                + "m " + memTotalKb + " " + memAvailKb + " 2097152 1048576\n"
                + "n " + rx + " " + tx + "\n"
                + "u 90210.55\n"
                + "h demo-host\n";
    }

    @Test
    void firstSampleHasNoDeltaMetrics() {
        StatsSampler.Prev prev = new StatsSampler.Prev();
        StatsSnapshot s = StatsSampler.compute(prev,
                raw(1000, 800, 8L * 1024 * 1024, 6L * 1024 * 1024, 1000, 2000), 100000L);
        assertNull(s.getCpu(), "首轮无 CPU");
        assertNull(s.getRxRate(), "首轮无网络速率");
        assertNull(s.getTxRate());
        assertEquals(25, s.getMemPct().intValue());
        assertEquals(2048L, s.getMemUsedMb().longValue());
        assertEquals(8192L, s.getMemTotalMb().longValue());
        assertEquals(50, s.getSwapPct().intValue());
        assertEquals(1024L, s.getSwapUsedMb().longValue());
        assertEquals(2048L, s.getSwapTotalMb().longValue());
        assertEquals("0.42", s.getLoad1());
        assertEquals(90210L, s.getUptimeSecs().longValue());
        assertEquals("demo-host", s.getHost());
    }

    @Test
    void secondSampleComputesCpuAndRates() {
        StatsSampler.Prev prev = new StatsSampler.Prev();
        StatsSampler.compute(prev, raw(1000, 800, 8L * 1024 * 1024, 6L * 1024 * 1024, 1000, 2000), 100000L);
        StatsSnapshot s = StatsSampler.compute(prev,
                raw(1200, 940, 8L * 1024 * 1024, 6L * 1024 * 1024, 3048, 3024), 103000L);
        // 总增量 200，空闲增量 140 -> 忙 60 -> 30%
        assertEquals(30, s.getCpu().intValue());
        // 3 秒窗口：下行增量 2048B -> 682 B/s；上行增量 1024B -> 341 B/s
        assertEquals(682L, s.getRxRate().longValue());
        assertEquals(341L, s.getTxRate().longValue());
    }

    @Test
    void nonLinuxOutputThrows() {
        StatsSampler.Prev prev = new StatsSampler.Prev();
        assertThrows(IllegalArgumentException.class,
                () -> StatsSampler.compute(prev, "c $(awk ...)\r\nl ...\r\n", 100L));
    }

    @Test
    void cpuClampedToRange() {
        StatsSampler.Prev prev = new StatsSampler.Prev();
        // 构造异常输入：空闲增量大于总增量 -> 结果应被夹紧到 0
        StatsSampler.compute(prev, raw(1000, 1000, 1024, 512, 0, 0), 1000L);
        StatsSnapshot s = StatsSampler.compute(prev, raw(1100, 1200, 1024, 512, 0, 0), 4000L);
        assertEquals(0, s.getCpu().intValue());
    }

    /* ---------- Android/Termux 降级：/proc/stat、/proc/loadavg、/proc/uptime、/proc/net/dev 均不可读 ---------- */

    private static String androidFirst() {
        // 手机实测输出（l/u 来自 uptime 命令，m 来自 /proc/meminfo，fcpuN 为 cpufreq 累计值）
        return "m 15476208 5071028 16777212 9693416\n"
                + "l 15.92\n"
                + "u 164197\n"
                + "fcpu0 2000 10 100 400\n"
                + "fcpu1 3000 10 100 400\n"
                + "h localhost\n";
    }

    @Test
    void androidPartialSampleKeepsMemoryAndLoad() {
        StatsSnapshot s = StatsSampler.compute(new StatsSampler.Prev(), androidFirst(), 1000L);
        assertEquals(15113L, s.getMemTotalMb().longValue());
        assertEquals(10161L, s.getMemUsedMb().longValue());
        assertEquals(67, s.getMemPct().intValue());
        assertEquals(16383L, s.getSwapTotalMb().longValue());
        assertEquals(6917L, s.getSwapUsedMb().longValue());
        assertEquals(42, s.getSwapPct().intValue());
        assertEquals("15.92", s.getLoad1());
        assertEquals(164197L, s.getUptimeSecs().longValue());
        assertEquals("localhost", s.getHost());
        assertNull(s.getCpu(), "首轮无频率差分基线");
        assertNull(s.getRxRate(), "Android 无网络速率来源");
        assertNull(s.getTxRate());
    }

    @Test
    void androidSecondSampleEstimatesCpuFromFreq() {
        StatsSampler.Prev prev = new StatsSampler.Prev();
        StatsSampler.compute(prev, androidFirst(), 1000L);
        // 3 秒窗口（300 个 10ms 计次）：f0 全程跑满（比例 1.0），f1 停在最低频率（比例 0） -> 均值 50%
        String second = "m 15476208 5071028 16777212 9693416\n"
                + "l 15.60\n"
                + "u 164200\n"
                + "fcpu0 122000 310 100 400\n"
                + "fcpu1 33000 310 100 400\n"
                + "h localhost\n";
        StatsSnapshot s = StatsSampler.compute(prev, second, 4000L);
        assertEquals(50, s.getCpu().intValue());
    }

    @Test
    void emptyValuesAreIgnored() {
        StatsSampler.Prev prev = new StatsSampler.Prev();
        StatsSnapshot s = StatsSampler.compute(prev,
                "c \nl \nm 8192 4096 2048 1024\nn \n", 100L);
        assertEquals(50, s.getMemPct().intValue());
        assertNull(s.getCpu());
        assertNull(s.getLoad1());
        assertNull(s.getRxRate());
    }

    @Test
    void garbageCpuLineDoesNotBreakMemory() {
        StatsSampler.Prev prev = new StatsSampler.Prev();
        StatsSnapshot s = StatsSampler.compute(prev,
                "c $(awk '/^cpu /{print ...}' /proc/stat)\nm 1024 512 0 0\n", 100L);
        assertEquals(50, s.getMemPct().intValue());
        assertNull(s.getCpu());
    }
}
