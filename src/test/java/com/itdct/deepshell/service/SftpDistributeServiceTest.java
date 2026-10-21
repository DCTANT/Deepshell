package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.SshConnection;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.SftpException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SftpDistributeServiceTest {

    @TempDir
    Path temp;

    private SftpDistributeService service;

    @AfterEach
    void tearDown() {
        if (service != null) {
            service.shutdown();
        }
    }

    @Test
    void distributesSameFilesToAllTargets() throws Exception {
        SshConnection c1 = connection(1L, "web-1", "10.0.0.1");
        SshConnection c2 = connection(2L, "web-2", "10.0.0.2");
        ConnectionService connectionService = mock(ConnectionService.class);
        when(connectionService.list()).thenReturn(Arrays.asList(c1, c2));
        AuditService audit = mock(AuditService.class);

        Map<String, byte[]> received1 = new ConcurrentHashMap<>();
        Map<String, byte[]> received2 = new ConcurrentHashMap<>();
        ChannelSftp channel1 = mockChannel(received1);
        ChannelSftp channel2 = mockChannel(received2);
        SshSessionManager sessions = mock(SshSessionManager.class);
        when(sessions.openSftp(1L)).thenReturn(
                new SshSessionManager.SftpHandle(channel1, null, false));
        when(sessions.openSftp(2L)).thenReturn(
                new SshSessionManager.SftpHandle(channel2, null, false));

        service = new SftpDistributeService(sessions, connectionService, audit);
        service.initAt(temp.resolve("distribute"));

        byte[] deploy = "#!/bin/sh\necho deploy\n".getBytes(StandardCharsets.UTF_8);
        byte[] conf = "port=8080\nworkers=4\n".getBytes(StandardCharsets.UTF_8);
        List<MultipartFile> files = Arrays.asList(
                new MockMultipartFile("files", "deploy.sh", "text/plain", deploy),
                new MockMultipartFile("files", "app.conf", "text/plain", conf));

        Map<String, Object> started = service.distribute(files, Arrays.asList(1L, 2L),
                "/opt/deepshell/");
        assertEquals("/opt/deepshell", started.get("targetPath"));
        Map<String, Object> done = await(service, String.valueOf(started.get("id")));

        assertEquals("done", done.get("status"));
        assertEquals(2, ((Number) done.get("doneTargets")).intValue());
        assertEquals(0, ((Number) done.get("failedTargets")).intValue());
        assertEquals((long) (deploy.length + conf.length) * 2,
                ((Number) done.get("doneBytes")).longValue());

        assertEquals(2, received1.size());
        assertEquals(2, received2.size());
        assertTrue(Arrays.equals(deploy, received1.get("/opt/deepshell/deploy.sh")));
        assertTrue(Arrays.equals(conf, received1.get("/opt/deepshell/app.conf")));
        assertTrue(Arrays.equals(deploy, received2.get("/opt/deepshell/deploy.sh")));
        assertTrue(Arrays.equals(conf, received2.get("/opt/deepshell/app.conf")));
        Path distributeRoot = temp.resolve("distribute");
        long deadline = System.currentTimeMillis() + 2000;
        long leftovers = 1;
        while (System.currentTimeMillis() < deadline) {
            try (java.util.stream.Stream<Path> stream = Files.list(distributeRoot)) {
                leftovers = stream.count();
            }
            if (leftovers == 0) {
                break;
            }
            Thread.sleep(50);
        }
        assertEquals(0, leftovers, "全部成功后应释放暂存文件");
    }

    @Test
    void rejectsRelativeTargetPathAndCleansStaging() throws Exception {
        ConnectionService connectionService = mock(ConnectionService.class);
        AuditService audit = mock(AuditService.class);
        SshSessionManager sessions = mock(SshSessionManager.class);
        service = new SftpDistributeService(sessions, connectionService, audit);
        Path root = temp.resolve("distribute");
        service.initAt(root);

        List<MultipartFile> files = Arrays.asList(
                new MockMultipartFile("files", "a.txt", "text/plain", "a".getBytes()));
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.distribute(files, Arrays.asList(1L), "opt/app"));
        assertTrue(e.getMessage().contains("绝对路径"));
        try (java.util.stream.Stream<Path> stream = Files.list(root)) {
            assertEquals(0, stream.count(), "暂存目录应被清理");
        }
    }

    @Test
    void rejectsDuplicateFileNames() throws Exception {
        service = new SftpDistributeService(mock(SshSessionManager.class),
                mock(ConnectionService.class), mock(AuditService.class));
        service.initAt(temp.resolve("distribute"));

        List<MultipartFile> files = Arrays.asList(
                new MockMultipartFile("files", "same.txt", "text/plain", "1".getBytes()),
                new MockMultipartFile("files", "same.txt", "text/plain", "2".getBytes()));
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.distribute(files, Arrays.asList(1L), "/tmp"));
        assertTrue(e.getMessage().contains("同名文件"));
    }

    private static ChannelSftp mockChannel(Map<String, byte[]> received) throws Exception {
        ChannelSftp channel = mock(ChannelSftp.class);
        when(channel.stat(anyString())).thenThrow(
                new SftpException(ChannelSftp.SSH_FX_NO_SUCH_FILE, "missing"));
        doAnswer(invocation -> {
            InputStream in = invocation.getArgument(0);
            String path = invocation.getArgument(1);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            received.put(path, out.toByteArray());
            return null;
        }).when(channel).put(any(InputStream.class), anyString(), eq(ChannelSftp.OVERWRITE));
        return channel;
    }

    private static SshConnection connection(Long id, String name, String host) {
        SshConnection c = new SshConnection();
        c.setId(id);
        c.setName(name);
        c.setHost(host);
        c.setPort(22);
        c.setUsername("root");
        return c;
    }

    private static Map<String, Object> await(SftpDistributeService service, String taskId)
            throws Exception {
        long deadline = System.currentTimeMillis() + 5000;
        while (System.currentTimeMillis() < deadline) {
            Map<String, Object> snapshot = service.get(taskId);
            if (!"running".equals(snapshot.get("status"))) {
                return snapshot;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("分发任务超时");
    }
}
