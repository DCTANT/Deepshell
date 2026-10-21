package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.SftpEntry;
import com.itdct.deepshell.dto.TrashDeleteReq;
import com.itdct.deepshell.dto.TrashDeleteResult;
import com.itdct.deepshell.dto.TrashItem;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 回收站按 freedesktop.org Trash 规范落在 ~/.local/share/Trash，
 * 测试用一个内存假文件系统覆盖 SftpService 的读写。
 */
class RecycleBinServiceTest {

    private static final String HOME = "/home/test";
    private static final String TRASH = HOME + "/.local/share/Trash";
    private static final String FILES = TRASH + "/files";
    private static final String INFO = TRASH + "/info";

    @Test
    void usesFreedesktopLayoutAndRoundTripsFile() throws Exception {
        FakeFs fs = new FakeFs();
        fs.dir(HOME + "/Desktop");
        fs.file(HOME + "/Desktop/a.txt", "hello world!");
        RecycleBinService service = service(fs);

        String original = HOME + "/Desktop/a.txt";
        assertTrue(service.list("s").isEmpty());
        assertFalse(fs.paths.contains(TRASH), "首次删除前不应创建回收站");

        List<TrashDeleteResult> results = service.delete("s", Arrays.asList(req(original, "a.txt")));
        assertTrue(results.get(0).isOk(), results.get(0).getError());
        assertFalse(fs.paths.contains(original));
        assertTrue(fs.paths.contains(FILES));
        assertTrue(fs.paths.contains(INFO));

        List<SftpEntry> stored = fs.ls(FILES);
        assertEquals(1, stored.size());
        String storedName = stored.get(0).getName();
        assertTrue(storedName.endsWith("__a.txt"));

        String infoText = fs.contents.get(INFO + "/" + storedName + ".trashinfo");
        assertNotNull(infoText);
        assertTrue(infoText.startsWith("[Trash Info]"));
        assertTrue(infoText.contains("Path=/home/test/Desktop/a.txt"));
        assertTrue(infoText.contains("DeletionDate="));

        List<TrashItem> items = service.list("s");
        assertEquals(1, items.size());
        assertEquals("a.txt", items.get(0).getName());
        assertEquals(original, items.get(0).getOriginalPath());
        assertEquals(FILES + "/" + storedName, items.get(0).getStoredPath());
        assertEquals(12, items.get(0).getSize());
        assertFalse(items.get(0).isDir());
        assertTrue(items.get(0).getDeletedAt() > 0);

        Map<String, Object> restored = service.restore("s", items.get(0).getId());
        assertEquals(original, restored.get("path"));
        assertTrue(fs.paths.contains(original));
        assertFalse(fs.paths.contains(INFO + "/" + storedName + ".trashinfo"));
        assertTrue(service.list("s").isEmpty());

        service.delete("s", Arrays.asList(req(original, "a.txt")));
        List<TrashItem> again = service.list("s");
        assertEquals(1, again.size());
        Map<String, Object> purged = service.purge("s", Arrays.asList(again.get(0).getId()));
        assertEquals(1, ((Number) purged.get("deleted")).intValue());
        assertTrue(service.list("s").isEmpty());
        assertFalse(fs.paths.contains(FILES + "/" + storedName));

        fs.file(original, "hello world!");
        List<TrashDeleteResult> third = service.delete("s", Arrays.asList(req(original, "a.txt")));
        assertTrue(third.get(0).isOk(), third.get(0).getError());
        assertEquals(1, ((Number) service.empty("s").get("deleted")).intValue());
        assertFalse(fs.paths.contains(TRASH));
        assertTrue(service.list("s").isEmpty());
    }

    @Test
    void readsTrashLeftByDesktopApps() throws Exception {
        FakeFs fs = new FakeFs();
        fs.dir(INFO);
        fs.dir(FILES);
        // 模拟 GNOME 删除的文件：files/ 下是本体，info/ 下是百分号编码过的元数据
        fs.file(FILES + "/notes.txt", "from nautilus");
        fs.file(INFO + "/notes.txt.trashinfo",
                "[Trash Info]\n"
                        + "Path=/home/test/Documents/%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC.txt\n"
                        + "DeletionDate=2026-01-02T03:04:05\n");
        RecycleBinService service = service(fs);

        List<TrashItem> items = service.list("s");
        assertEquals(1, items.size());
        TrashItem item = items.get(0);
        assertEquals("notes.txt", item.getId());
        assertEquals("中文 空格.txt", item.getName());
        assertEquals(HOME + "/Documents/中文 空格.txt", item.getOriginalPath());
        assertEquals(13, item.getSize());

        Map<String, Object> restored = service.restore("s", item.getId());
        assertEquals(HOME + "/Documents/中文 空格.txt", restored.get("path"));
        assertTrue(fs.paths.contains(HOME + "/Documents/中文 空格.txt"));
        assertFalse(fs.paths.contains(INFO + "/notes.txt.trashinfo"));
    }

    @Test
    void dropsMetadataWhosePayloadIsGone() throws Exception {
        FakeFs fs = new FakeFs();
        fs.dir(INFO);
        fs.dir(FILES);
        fs.file(INFO + "/ghost.trashinfo",
                "[Trash Info]\n"
                        + "Path=/home/test/ghost.txt\n"
                        + "DeletionDate=2026-01-02T03:04:05\n");
        RecycleBinService service = service(fs);

        assertTrue(service.list("s").isEmpty());
        assertFalse(fs.paths.contains(INFO + "/ghost.trashinfo"));
    }

    @Test
    void refusesToTrashTrashItselfOrItsContents() throws Exception {
        FakeFs fs = new FakeFs();
        fs.dir(TRASH);
        fs.dir(FILES);
        fs.file(FILES + "/kept.txt", "x");
        RecycleBinService service = service(fs);

        List<TrashDeleteResult> root = service.delete("s", Arrays.asList(req(TRASH, "Trash")));
        assertFalse(root.get(0).isOk());
        assertTrue(root.get(0).getError().contains("回收站"));

        List<TrashDeleteResult> inside = service.delete("s",
                Arrays.asList(req(FILES + "/kept.txt", "kept.txt")));
        assertFalse(inside.get(0).isOk());
        assertTrue(inside.get(0).getError().contains("回收站"));
        assertTrue(fs.paths.contains(FILES + "/kept.txt"));

        List<TrashDeleteResult> ancestor = service.delete("s",
                Arrays.asList(req(HOME + "/.local", ".local")));
        assertFalse(ancestor.get(0).isOk());
        assertTrue(ancestor.get(0).getError().contains("回收站"));
    }

    @Test
    void rollsBackRenameWhenMetadataCannotBeWritten() throws Exception {
        FakeFs fs = new FakeFs();
        fs.file(HOME + "/Desktop/a.txt", "hello");
        SftpService sftp = sftp(fs);
        doThrow(new IOException("磁盘已满"))
                .when(sftp).writeText(anyString(), contains(".trashinfo"), anyString());
        RecycleBinService service = new RecycleBinService(sftp, mock(AuditService.class));

        String original = HOME + "/Desktop/a.txt";
        List<TrashDeleteResult> results = service.delete("s", Arrays.asList(req(original, "a.txt")));
        assertFalse(results.get(0).isOk());
        assertTrue(results.get(0).getError().contains("已取消删除"));
        assertTrue(fs.paths.contains(original), "元数据写入失败后文件应回到原位置");
        assertTrue(fs.ls(FILES).isEmpty());
    }

    @Test
    void rejectsBadRestoreIds() throws Exception {
        RecycleBinService service = service(new FakeFs());
        assertThrows(IllegalArgumentException.class, () -> service.restore("s", "../etc/passwd"));
        assertThrows(IllegalArgumentException.class, () -> service.restore("s", " "));
    }

    private static RecycleBinService service(FakeFs fs) throws Exception {
        return new RecycleBinService(sftp(fs), mock(AuditService.class));
    }

    private static SftpService sftp(FakeFs fs) throws Exception {
        SftpService sftp = mock(SftpService.class);
        when(sftp.home(anyString())).thenReturn(HOME);
        when(sftp.exists(anyString(), anyString()))
                .thenAnswer(inv -> fs.paths.contains(inv.getArgument(1)));
        when(sftp.list(anyString(), anyString()))
                .thenAnswer(inv -> fs.ls(inv.getArgument(1)));
        when(sftp.readText(anyString(), anyString()))
                .thenAnswer(inv -> fs.contents.get(inv.getArgument(1)));
        doAnswer(inv -> {
            fs.mkdirs(inv.getArgument(1));
            return null;
        }).when(sftp).mkdirs(anyString(), anyString());
        doAnswer(inv -> {
            fs.rename(inv.getArgument(1), inv.getArgument(2));
            return null;
        }).when(sftp).renameAbsolute(anyString(), anyString(), anyString());
        doAnswer(inv -> {
            fs.write(inv.getArgument(1), inv.getArgument(2));
            return null;
        }).when(sftp).writeText(anyString(), anyString(), anyString());
        doAnswer(inv -> {
            fs.delete(inv.getArgument(1));
            return null;
        }).when(sftp).delete(anyString(), anyString());
        return sftp;
    }

    private static TrashDeleteReq.Item req(String path, String name) {
        TrashDeleteReq.Item item = new TrashDeleteReq.Item();
        item.setPath(path);
        item.setName(name);
        return item;
    }

    /** 只覆盖回收站用到的 SFTP 操作的内存文件系统 */
    private static final class FakeFs {

        private final Set<String> paths = new HashSet<>();
        private final Set<String> dirs = new HashSet<>();
        private final Map<String, String> contents = new HashMap<>();

        void file(String path, String content) {
            mkdirs(parent(path));
            paths.add(path);
            contents.put(path, content);
        }

        void dir(String path) {
            mkdirs(path);
        }

        void mkdirs(String path) {
            String p = path;
            while (p != null && !p.isEmpty() && !"/".equals(p) && !paths.contains(p)) {
                paths.add(p);
                dirs.add(p);
                p = parent(p);
            }
        }

        void write(String path, String content) {
            mkdirs(parent(path));
            paths.add(path);
            contents.put(path, content);
        }

        void rename(String src, String dest) {
            List<String> moved = new ArrayList<>();
            for (String p : paths) {
                if (p.equals(src) || p.startsWith(src + "/")) {
                    moved.add(p);
                }
            }
            if (moved.isEmpty()) {
                throw new IllegalStateException("不存在: " + src);
            }
            for (String p : moved) {
                String target = dest + p.substring(src.length());
                String content = contents.remove(p);
                boolean dir = dirs.contains(p);
                paths.remove(p);
                dirs.remove(p);
                paths.add(target);
                if (dir) {
                    dirs.add(target);
                }
                if (content != null) {
                    contents.put(target, content);
                }
            }
        }

        void delete(String path) {
            paths.removeIf(p -> p.equals(path) || p.startsWith(path + "/"));
            dirs.removeIf(p -> p.equals(path) || p.startsWith(path + "/"));
            contents.keySet().removeIf(p -> p.equals(path) || p.startsWith(path + "/"));
        }

        List<SftpEntry> ls(String dir) {
            List<SftpEntry> out = new ArrayList<>();
            String prefix = "/".equals(dir) ? "/" : dir + "/";
            for (String p : paths) {
                if (!p.startsWith(prefix)) {
                    continue;
                }
                String name = p.substring(prefix.length());
                if (name.isEmpty() || name.indexOf('/') >= 0) {
                    continue;
                }
                boolean dirFlag = dirs.contains(p);
                long size = dirFlag ? 0
                        : contents.getOrDefault(p, "").getBytes(StandardCharsets.UTF_8).length;
                out.add(new SftpEntry(name, dirFlag, false, size, 1_700_000_000_000L, "rw-r--r--"));
            }
            return out;
        }

        static String parent(String path) {
            int i = path.lastIndexOf('/');
            return i <= 0 ? "/" : path.substring(0, i);
        }
    }
}
