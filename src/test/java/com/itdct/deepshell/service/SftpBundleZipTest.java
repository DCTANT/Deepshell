package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SftpBundleZipTest {

    @Test
    void zipsFilesFoldersAndEmptyEntries() throws Exception {
        FakeSftp fake = new FakeSftp();
        fake.file("/root/a.txt", "hello");
        fake.dir("/root/dir");
        fake.file("/root/dir/b.txt", "world");
        fake.dir("/root/dir/sub");
        fake.file("/root/blank.txt", "");
        fake.children("/root/dir", "b.txt", "sub", ".", "..");
        fake.children("/root/dir/sub", ".", "..");

        Map<String, byte[]> entries = zip(fake, "/root", "/root/a.txt", "/root/dir", "/root/blank.txt");

        assertEquals("hello", text(entries.get("a.txt")));
        assertTrue(entries.containsKey("dir/"));
        assertEquals("world", text(entries.get("dir/b.txt")));
        assertTrue(entries.containsKey("dir/sub/"));
        assertEquals(0, entries.get("blank.txt").length);
        assertFalse(entries.containsKey("_deepshell_errors.txt"));
    }

    @Test
    void reportsUnreadableFileAndKeepsOthers() throws Exception {
        FakeSftp fake = new FakeSftp();
        fake.file("/root/good.txt", "ok");
        fake.file("/root/bad.txt", null);
        fake.children("/root", "good.txt", "bad.txt");

        Map<String, byte[]> entries = zip(fake, "/root", "/root/good.txt", "/root/bad.txt");

        assertEquals("ok", text(entries.get("good.txt")));
        assertTrue(entries.containsKey("_deepshell_errors.txt"));
        String errors = text(entries.get("_deepshell_errors.txt"));
        assertTrue(errors.contains("bad.txt"), errors);
        assertTrue(errors.contains("read failed"), errors);
    }

    @Test
    void skipsSymlinkLoop() throws Exception {
        FakeSftp fake = new FakeSftp();
        fake.dir("/root/dir");
        fake.file("/root/dir/b.txt", "world");
        fake.children("/root/dir", "b.txt");
        fake.dir("/root/loop");
        fake.children("/root/loop", "b.txt");
        fake.realpath("/root/loop", "/root/dir");

        Map<String, byte[]> entries = zip(fake, "/root", "/root/dir", "/root/loop");

        assertEquals("world", text(entries.get("dir/b.txt")));
        assertFalse(entries.containsKey("loop/"));
        String errors = text(entries.get("_deepshell_errors.txt"));
        assertTrue(errors.contains("loop"), errors);
        assertTrue(errors.contains("重复目录"), errors);
    }

    @Test
    void rejectsPathsOutsideCurrentDirectory() throws Exception {
        FakeSftp fake = new FakeSftp();
        assertThrows(IllegalArgumentException.class,
                () -> zip(fake, "/root", "/etc/passwd"));
        assertThrows(IllegalArgumentException.class,
                () -> zip(fake, "/root", "/root/../etc/passwd"));
        assertThrows(IllegalArgumentException.class,
                () -> zip(fake, "/root", "/root/."));
        assertThrows(IllegalArgumentException.class,
                () -> zip(fake, "/root"));
    }

    private static Map<String, byte[]> zip(FakeSftp fake, String dir, String... paths) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        SftpService.writeZipTo(fake.channel(), dir, Arrays.asList(paths), out);
        Map<String, byte[]> entries = new LinkedHashMap<>();
        try (ZipInputStream zin = new ZipInputStream(
                new ByteArrayInputStream(out.toByteArray()), StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zin.getNextEntry()) != null) {
                ByteArrayOutputStream content = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = zin.read(buf)) != -1) {
                    content.write(buf, 0, n);
                }
                entries.put(entry.getName(), content.toByteArray());
            }
        }
        return entries;
    }

    private static String text(byte[] data) {
        return data == null ? "" : new String(data, StandardCharsets.UTF_8);
    }
}
