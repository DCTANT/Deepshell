package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DiskServiceTest {

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> entries(Map<String, Object> result) {
        return (List<Map<String, Object>>) result.get("entries");
    }

    @Test
    void parsesSortsAndComputesPct() {
        String raw = "__DU__\n"
                + "2048\t/opt/app/logs\n"
                + "512\t/opt/app/bin\n"
                + "10240\t/opt/app/data\n"
                + "64\t/opt/app/readme.txt\n"
                + "13128\t/opt/app\n"
                + "__DIRS__\n"
                + "/opt/app/data\n"
                + "/opt/app/logs\n"
                + "/opt/app/bin\n";
        Map<String, Object> r = DiskService.parse(raw, "/opt/app");
        assertEquals(13128L, r.get("totalKb"));
        assertFalse((Boolean) r.get("truncated"));
        List<Map<String, Object>> es = entries(r);
        assertEquals(4, es.size());
        // 降序：data 10240 > logs 2048 > bin 512 > readme.txt 64
        assertEquals("data", es.get(0).get("name"));
        assertEquals(10240L, es.get(0).get("sizeKb"));
        assertEquals(78.0, (Double) es.get(0).get("pct"));
        assertEquals(Boolean.TRUE, es.get(0).get("dir"));
        assertEquals("/opt/app/data", es.get(0).get("path"));
        assertEquals("readme.txt", es.get(3).get("name"));
        assertEquals(Boolean.FALSE, es.get(3).get("dir"));
        assertEquals(0.5, (Double) es.get(3).get("pct"));
    }

    @Test
    void handlesTrailingSlashAndRoot() {
        String raw = "__DU__\n"
                + "100\t/var/spool\n"
                + "900\t/var\n"
                + "__DIRS__\n"
                + "/var/spool\n";
        Map<String, Object> r = DiskService.parse(raw, "/var/");
        assertEquals(900L, r.get("totalKb"));
        assertEquals(1, entries(r).size());
        assertEquals("spool", entries(r).get(0).get("name"));

        String rawRoot = "__DU__\n"
                + "500\t/home\n"
                + "300\t/etc\n"
                + "800\t/\n"
                + "__DIRS__\n"
                + "/home\n"
                + "/etc\n";
        Map<String, Object> rr = DiskService.parse(rawRoot, "/");
        assertEquals(2, entries(rr).size());
        assertEquals("home", entries(rr).get(0).get("name"));
        assertEquals(62.5, (Double) entries(rr).get(0).get("pct"));
    }

    @Test
    void pathWithSpacesKeepsFullPath() {
        String raw = "__DU__\n"
                + "300\t/mnt/my disk/a b.txt\n"
                + "700\t/mnt/my disk\n"
                + "__DIRS__\n";
        Map<String, Object> r = DiskService.parse(raw, "/mnt/my disk");
        assertEquals("a b.txt", entries(r).get(0).get("name"));
        assertEquals("/mnt/my disk/a b.txt", entries(r).get(0).get("path"));
    }

    @Test
    void totalFallsBackToChildSumWhenRootLineMissing() {
        String raw = "__DU__\n"
                + "100\t/a/x\n"
                + "300\t/a/y\n"
                + "__DIRS__\n"
                + "/a/x\n";
        Map<String, Object> r = DiskService.parse(raw, "/a");
        assertEquals(400L, r.get("totalKb"));
    }

    @Test
    void missingMarkersThrows() {
        assertThrows(IllegalStateException.class, () -> DiskService.parse("", "/x"));
    }

    @Test
    void shellQuotingEscapesSingleQuotes() {
        assertEquals("'a b'", DiskService.shq("a b"));
        assertEquals("'it'\\''s'", DiskService.shq("it's"));
        assertTrue(DiskService.shq("plain").startsWith("'plain'"));
    }

    @Test
    void bigListsAreTruncated() {
        StringBuilder sb = new StringBuilder("__DU__\n");
        long total = 0;
        for (int i = 0; i < 520; i++) {
            sb.append((i + 1)).append("\t/d/p").append(i).append("\n");
            total += i + 1;
        }
        sb.append(total).append("\t/d\n");
        sb.append("__DIRS__\n");
        Map<String, Object> r = DiskService.parse(sb.toString(), "/d");
        assertTrue((Boolean) r.get("truncated"));
        assertEquals(500, entries(r).size());
        // 截断后保留最大的：第一项应为 520
        assertEquals(520L, entries(r).get(0).get("sizeKb"));
    }
}
