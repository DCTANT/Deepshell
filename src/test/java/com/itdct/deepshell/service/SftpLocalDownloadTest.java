package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SftpLocalDownloadTest {

    @TempDir
    Path temp;

    @Test
    void downloadsFilesAndDirectoriesWithSafeNames() throws Exception {
        FakeSftp fake = new FakeSftp();
        fake.file("/root/a.txt", "hello");
        fake.dir("/root/dir");
        fake.file("/root/dir/b.txt", "world");
        fake.dir("/root/dir/empty");
        fake.children("/root/dir", "b.txt", "empty", ".", "..");
        fake.children("/root/dir/empty", ".", "..");
        fake.file("/root/a:b.txt", "colon");
        fake.file("/root/a?b.txt", "question");
        fake.file("/root/CON.txt", "reserved");

        SftpService.LocalDownloadPlan plan = SftpService.planLocalDownloadTo(fake.channel(), "/root",
                Arrays.asList("/root/a.txt", "/root/dir", "/root/a:b.txt", "/root/a?b.txt", "/root/CON.txt"));
        assertEquals(5, plan.totalFiles);
        assertEquals(2, plan.totalDirs);
        assertEquals(5 + 5 + 5 + 8 + 8, plan.totalBytes);
        assertTrue(plan.warnings.isEmpty(), plan.warnings.toString());

        Path target = temp.resolve("target");
        RecordingProgress progress = new RecordingProgress();
        SftpService.downloadLocalPlanTo(fake.channel(), plan, target, progress);

        assertEquals("hello", read(target.resolve("a.txt")));
        assertEquals("world", read(target.resolve("dir/b.txt")));
        assertTrue(Files.isDirectory(target.resolve("dir/empty")));
        assertEquals("colon", read(target.resolve("a_b.txt")));
        assertEquals("question", read(target.resolve("a_b-2.txt")));
        assertEquals("reserved", read(target.resolve("_CON.txt")));
        assertEquals(5, progress.files.size());
        assertEquals(5 + 5 + 5 + 8 + 8, progress.bytes);
        assertTrue(progress.failed.isEmpty(), progress.failed.toString());
        assertTrue(progress.renamed.size() >= 3, progress.renamed.toString());
    }

    @Test
    void reportsBadFileAndKeepsGoodOnes() throws Exception {
        FakeSftp fake = new FakeSftp();
        fake.file("/root/good.txt", "ok");
        fake.file("/root/bad.txt", null);

        SftpService.LocalDownloadPlan plan = SftpService.planLocalDownloadTo(fake.channel(), "/root",
                Arrays.asList("/root/good.txt", "/root/bad.txt"));
        Path target = temp.resolve("partial");
        RecordingProgress progress = new RecordingProgress();
        SftpService.downloadLocalPlanTo(fake.channel(), plan, target, progress);

        assertEquals("ok", read(target.resolve("good.txt")));
        assertFalse(Files.exists(target.resolve("bad.txt")));
        assertEquals(1, progress.files.size());
        assertEquals(1, progress.failed.size());
        assertTrue(progress.failed.get(0).contains("bad.txt"), progress.failed.toString());
        try (java.util.stream.Stream<Path> stream = Files.list(target)) {
            assertFalse(stream.anyMatch(p -> p.getFileName().toString().contains(".deepshell-")),
                    "临时文件应已清理");
        }
    }

    @Test
    void planSkipsSymlinkLoop() throws Exception {
        FakeSftp fake = new FakeSftp();
        fake.dir("/root/dir");
        fake.file("/root/dir/b.txt", "world");
        fake.children("/root/dir", "b.txt");
        fake.dir("/root/loop");
        fake.children("/root/loop", "b.txt");
        fake.realpath("/root/loop", "/root/dir");

        SftpService.LocalDownloadPlan plan = SftpService.planLocalDownloadTo(fake.channel(), "/root",
                Arrays.asList("/root/dir", "/root/loop"));

        assertEquals(1, plan.totalFiles);
        assertTrue(plan.warnings.toString().contains("loop"), plan.warnings.toString());
        assertTrue(plan.warnings.toString().contains("重复目录"), plan.warnings.toString());
    }

    @Test
    void sanitizesWindowsNames() {
        assertEquals("a_b.txt", SftpService.safeLocalName("a:b.txt"));
        assertEquals("a_b_c_d_e_f_g_h_.txt",
                SftpService.safeLocalName("a/b:c*d?e\"f<g>h|.txt"));
        assertTrue(SftpService.safeLocalName("CON").startsWith("_"));
        assertTrue(SftpService.safeLocalName("con.txt").startsWith("_"));
        assertTrue(SftpService.safeLocalName("NUL ").startsWith("_"));
        assertEquals("name", SftpService.safeLocalName("name..."));
        assertEquals("_", SftpService.safeLocalName("   "));
        assertEquals("_", SftpService.safeLocalName(".."));
    }

    private static String read(Path path) throws Exception {
        return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
    }

    private static final class RecordingProgress implements SftpService.LocalDownloadProgress {
        final List<String> files = new ArrayList<>();
        final List<String> failed = new ArrayList<>();
        final List<String> renamed = new ArrayList<>();
        long bytes;

        @Override
        public void onEntryStarted(String relativePath, long size) {
        }

        @Override
        public void onBytes(long delta) {
            bytes += delta;
        }

        @Override
        public void onFileDone(String relativePath, String localPath, long size) {
            files.add(relativePath);
        }

        @Override
        public void onFileFailed(String relativePath, String message) {
            failed.add(relativePath + ":" + message);
        }

        @Override
        public void onDirCreated(String relativePath, String localPath) {
        }

        @Override
        public void onDirFailed(String relativePath, String message) {
            failed.add(relativePath + ":" + message);
        }

        @Override
        public void onRenamed(String relativePath, String localName) {
            renamed.add(relativePath + "->" + localName);
        }
    }
}
