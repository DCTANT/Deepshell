package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.ProcessEntry;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProcessServiceTest {

    private static final String GNU_RAW =
            "ct 100\n"
            + "nc 4\n"
            + "j 1 5000\n"
            + "j 100 450\n"
            + "P1\n"
            + "      1      0 root      0.0  0.1   12800 Ss    1234567 systemd /sbin/init splash\n"
            + "    100      1 root     12.5  2.3  256000 R        3600 myapp   /usr/bin/myapp --flag value\n";

    @Test
    void parsesGnuFormat() {
        ProcessService.Parsed p = ProcessService.parse(GNU_RAW);
        assertEquals("P1", p.format);
        assertEquals(100.0, p.clkTck);
        assertEquals(4, p.cores);
        assertEquals(2, p.jiffies.size());
        assertEquals(5000L, p.jiffies.get(1L).longValue());
        assertEquals(2, p.entries.size());

        ProcessEntry init = p.entries.get(0);
        assertEquals(1L, init.getPid());
        assertEquals(0L, init.getPpid());
        assertEquals("root", init.getUser());
        assertEquals(12L, init.getRssMb());
        assertEquals("Ss", init.getState());
        assertEquals(1234567L, init.getElapsedSecs());
        assertEquals("systemd", init.getComm());
        assertEquals("/sbin/init splash", init.getArgs());

        ProcessEntry app = p.entries.get(1);
        assertEquals(100L, app.getPid());
        assertEquals(12.5, app.getCpuAvg());
        assertEquals(250L, app.getRssMb());
        assertEquals("/usr/bin/myapp --flag value", app.getArgs());
    }

    @Test
    void fallsBackToPsAuxWhenP1Empty() {
        String raw = "ct 100\nnc 2\nP1\nP2\n"
                + "USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n"
                + "root         1  0.0  0.1 128000 12800 ?        Ss   Oct15   0:01 /sbin/init\n"
                + "www-data   512  3.1  8.5 1024000 870400 ?      S    11:02   1:30 /usr/sbin/nginx -g daemon off;\n";
        ProcessService.Parsed p = ProcessService.parse(raw);
        assertEquals("P2", p.format);
        assertEquals(2, p.entries.size());
        ProcessEntry nginx = p.entries.get(1);
        assertEquals(512L, nginx.getPid());
        assertEquals("www-data", nginx.getUser());
        assertEquals(3.1, nginx.getCpuAvg());
        assertEquals(850L, nginx.getRssMb());
        assertEquals(-1L, nginx.getElapsedSecs());
        assertEquals("nginx", nginx.getComm());
    }

    @Test
    void fallsBackToPsEfAsLastResort() {
        String raw = "P1\nP2\nP3\n"
                + "UID        PID  PPID  C STIME TTY          TIME CMD\n"
                + "root         1     0  0 Oct15 ?        00:00:01 /sbin/init\n"
                + "www-data   700     1  0 11:02 ?        00:00:05 /usr/sbin/nginx\n";
        ProcessService.Parsed p = ProcessService.parse(raw);
        assertEquals("P3", p.format);
        assertEquals(2, p.entries.size());
        ProcessEntry e = p.entries.get(1);
        assertEquals(700L, e.getPid());
        assertEquals(1L, e.getPpid());
        assertEquals("www-data", e.getUser());
        assertEquals("nginx", e.getComm());
        assertEquals("/usr/sbin/nginx", e.getArgs());
    }

    @Test
    void computesInstantCpuFromJiffiesDelta() {
        ProcessService.Parsed p = ProcessService.parse(GNU_RAW);
        Map<Long, Long> prev = new HashMap<>();
        prev.put(100L, 200L);
        ProcessService.applyInstantCpu(p.entries, p.jiffies, prev, 100000L, 103000L, 100.0, 4);
        ProcessEntry app = p.entries.get(1);
        assertEquals(20.8, app.getCpu());
        assertNull(p.entries.get(0).getCpu(), "prev 中没有的 PID 不计算瞬时值");
    }

    @Test
    void toleratesCommaDecimal() {
        String raw = "P1\n"
                + "      9      1 root       3,5  0,2    2048 S  60 init /sbin/init\n";
        ProcessService.Parsed p = ProcessService.parse(raw);
        assertEquals(1, p.entries.size());
        assertEquals(3.5, p.entries.get(0).getCpuAvg());
        assertEquals(0.2, p.entries.get(0).getMemPct());
    }

    @Test
    void rejectsGarbageOutputWithPreview() {
        IllegalArgumentException e1 = assertThrows(IllegalArgumentException.class,
                () -> ProcessService.parse("$ ps -eo ...\nsomething weird"));
        assertTrue(e1.getMessage().contains("原始输出"), "错误信息应包含原始输出片段");

        IllegalArgumentException e2 = assertThrows(IllegalArgumentException.class,
                () -> ProcessService.parse("P1\nP2\nP3\n"));
        assertTrue(e2.getMessage().contains("无法解析"), "三个格式都为空时应报无法解析");

        assertThrows(IllegalArgumentException.class, () -> ProcessService.parse(""));
    }
}
