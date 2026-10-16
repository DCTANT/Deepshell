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
}
