package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.dto.TrashDeleteReq;
import com.itdct.deepshell.dto.TrashDeleteResult;
import com.itdct.deepshell.dto.TrashItem;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RecycleBinServiceTest {

    @Test
    void movesToTrashRestoresPurgesAndRemovesDirectoryWhenEmpty() throws Exception {
        Set<String> paths = new HashSet<>();
        Map<String, String> files = new HashMap<>();
        SftpService sftp = mock(SftpService.class);
        when(sftp.home("s")).thenReturn("/home/test");
        when(sftp.exists(eq("s"), anyString())).thenAnswer(inv ->
                paths.contains(inv.getArgument(1)));
        doAnswer(inv -> {
            paths.add(inv.getArgument(1));
            return null;
        }).when(sftp).mkdirs(eq("s"), anyString());
        doAnswer(inv -> {
            String src = inv.getArgument(1);
            String dest = inv.getArgument(2);
            paths.remove(src);
            paths.add(dest);
            return null;
        }).when(sftp).renameAbsolute(eq("s"), anyString(), anyString());
        doAnswer(inv -> {
            String path = inv.getArgument(1);
            files.put(path, inv.getArgument(2));
            paths.add(path);
            return null;
        }).when(sftp).writeText(eq("s"), anyString(), anyString());
        when(sftp.readText(eq("s"), anyString())).thenAnswer(inv ->
                files.get(inv.getArgument(1)));
        doAnswer(inv -> {
            String path = inv.getArgument(1);
            paths.removeIf(p -> p.equals(path) || p.startsWith(path + "/"));
            files.keySet().removeIf(p -> p.equals(path) || p.startsWith(path + "/"));
            return null;
        }).when(sftp).delete(eq("s"), anyString());

        RecycleBinService service = new RecycleBinService(sftp, mock(AuditService.class),
                new ObjectMapper());
        String original = "/home/test/Desktop/a.txt";
        paths.add(original);
        assertTrue(service.list("s").isEmpty());
        assertFalse(paths.contains("/home/test/.recycle-bin"), "首次删除前不应创建回收站");

        TrashDeleteReq.Item req = new TrashDeleteReq.Item();
        req.setPath(original);
        req.setName("a.txt");
        req.setSize(12);
        List<TrashDeleteResult> results = service.delete("s", Arrays.asList(req));
        assertTrue(results.get(0).isOk());
        assertFalse(paths.contains(original));
        assertTrue(paths.contains("/home/test/.recycle-bin"));

        List<TrashItem> items = service.list("s");
        assertEquals(1, items.size());
        assertEquals("a.txt", items.get(0).getName());
        assertEquals(original, items.get(0).getOriginalPath());

        Map<String, Object> restored = service.restore("s", items.get(0).getId());
        assertEquals(original, restored.get("path"));
        assertTrue(paths.contains(original));
        assertTrue(service.list("s").isEmpty());

        paths.add(original);
        results = service.delete("s", Arrays.asList(req));
        assertTrue(results.get(0).isOk());
        List<TrashItem> again = service.list("s");
        assertEquals(1, again.size());
        Map<String, Object> purged = service.purge("s", Arrays.asList(again.get(0).getId()));
        assertEquals(1, ((Number) purged.get("deleted")).intValue());
        assertTrue(service.list("s").isEmpty());

        paths.add(original);
        service.delete("s", Arrays.asList(req));
        service.empty("s");
        assertFalse(paths.contains("/home/test/.recycle-bin"));
        assertTrue(service.list("s").isEmpty());
    }

    @Test
    void refusesToTrashRecycleBinItself() throws Exception {
        SftpService sftp = mock(SftpService.class);
        when(sftp.home("s")).thenReturn("/home/test");
        when(sftp.exists(eq("s"), anyString())).thenAnswer(inv ->
                "/home/test/Desktop".equals(inv.getArgument(1)));
        doAnswer(inv -> null).when(sftp).mkdirs(eq("s"), anyString());
        RecycleBinService service = new RecycleBinService(sftp, mock(AuditService.class),
                new ObjectMapper());

        TrashDeleteReq.Item req = new TrashDeleteReq.Item();
        req.setPath("/home/test");
        req.setName("test");
        List<TrashDeleteResult> results = new ArrayList<>();
        results.addAll(service.delete("s", Arrays.asList(req)));
        assertFalse(results.get(0).isOk());
        assertTrue(results.get(0).getError().contains("回收站"));
    }
}
