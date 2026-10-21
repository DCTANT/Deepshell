package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** VSCode 本地副本保存同步：原子替换与失败重试 */
class VscodeEditServiceTest {

    @TempDir
    Path dir;

    private SshSessionManager sessions() {
        SshSessionManager sessions = mock(SshSessionManager.class);
        when(sessions.get("s1")).thenReturn(mock(SshSessionManager.SshSession.class));
        return sessions;
    }

    @Test
    void atomicSaveIsUploaded() throws Exception {
        Path local = dir.resolve("app.conf");
        Files.write(local, "old".getBytes(StandardCharsets.UTF_8));
        SshSessionManager sessions = sessions();
        SftpService sftp = mock(SftpService.class);
        VscodeEditService service = new VscodeEditService(sessions, sftp);
        service.startWatchIfAbsent("s1", "/etc/app.conf", local);

        // VSCode 默认原子保存：写临时文件后重命名覆盖目标文件
        Path tmp = dir.resolve("app.conf.tmp");
        Files.write(tmp, "new content".getBytes(StandardCharsets.UTF_8));
        Files.move(tmp, local, StandardCopyOption.REPLACE_EXISTING);

        verify(sftp, timeout(5000).times(1)).putBytes(
                eq("s1"), eq("/etc/app.conf"),
                argThat(data -> "new content".equals(new String(data, StandardCharsets.UTF_8))));
        when(sessions.get("s1")).thenThrow(new IllegalStateException("closed"));
    }

    @Test
    void failedUploadIsRetried() throws Exception {
        Path local = dir.resolve("app.conf");
        Files.write(local, "old".getBytes(StandardCharsets.UTF_8));
        SshSessionManager sessions = sessions();
        SftpService sftp = mock(SftpService.class);
        doThrow(new IllegalStateException("temporary-1"))
                .doThrow(new IllegalStateException("temporary-2"))
                .doNothing()
                .when(sftp).putBytes(anyString(), anyString(), any(byte[].class));
        VscodeEditService service = new VscodeEditService(sessions, sftp);
        service.startWatchIfAbsent("s1", "/etc/app.conf", local);

        Files.write(local, "saved after retry".getBytes(StandardCharsets.UTF_8));

        verify(sftp, timeout(6000).times(3)).putBytes(
                eq("s1"), eq("/etc/app.conf"), any(byte[].class));
        when(sessions.get("s1")).thenThrow(new IllegalStateException("closed"));
    }
}
