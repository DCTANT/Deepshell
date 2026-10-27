package com.itdct.deepshell.service;

import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.SftpATTRS;
import com.jcraft.jsch.SftpException;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SftpServiceConflictTest {

    @Test
    void overwriteKeepsTargetAndSkipReturnsNull() throws Exception {
        ChannelSftp channel = channelWith("/opt/a.txt");
        assertEquals("/opt/a.txt", SftpService.resolveRemoteTarget(
                channel, "/opt/a.txt", SftpService.CONFLICT_OVERWRITE, new HashSet<>()));
        assertNull(SftpService.resolveRemoteTarget(
                channel, "/opt/a.txt", SftpService.CONFLICT_SKIP, new HashSet<>()));
        assertEquals("/opt/new.txt", SftpService.resolveRemoteTarget(
                channel, "/opt/new.txt", SftpService.CONFLICT_SKIP, new HashSet<>()));
    }

    @Test
    void renameFindsNextFreeNameAndHonorsReserved() throws Exception {
        ChannelSftp channel = channelWith("/opt/a.txt", "/opt/a (2).txt", "/opt/b.txt", "/opt/b (2).txt");
        assertEquals("/opt/a (3).txt", SftpService.resolveRemoteTarget(
                channel, "/opt/a.txt", SftpService.CONFLICT_RENAME, new HashSet<>()));

        Set<String> reserved = new HashSet<>();
        reserved.add("/opt/b (2).txt");
        assertEquals("/opt/b (3).txt", SftpService.resolveRemoteTarget(
                channel, "/opt/b.txt", SftpService.CONFLICT_RENAME, reserved));
        assertEquals("/opt/b (4).txt", SftpService.resolveRemoteTarget(
                channel, "/opt/b.txt", SftpService.CONFLICT_RENAME, reserved));
    }

    @Test
    void normalizesUnknownPolicyToOverwrite() {
        assertEquals(SftpService.CONFLICT_OVERWRITE, SftpService.normalizeConflictPolicy(null));
        assertEquals(SftpService.CONFLICT_OVERWRITE, SftpService.normalizeConflictPolicy("bogus"));
        assertEquals(SftpService.CONFLICT_SKIP, SftpService.normalizeConflictPolicy(" SKIP "));
        assertEquals(SftpService.CONFLICT_RENAME, SftpService.normalizeConflictPolicy("rename"));
    }

    private static ChannelSftp channelWith(String... existingPaths) throws Exception {
        ChannelSftp channel = mock(ChannelSftp.class);
        Set<String> existing = new HashSet<>();
        for (String path : existingPaths) {
            existing.add(path);
        }
        SftpATTRS attrs = mock(SftpATTRS.class);
        when(channel.stat(anyString())).thenAnswer(invocation -> {
            String path = invocation.getArgument(0);
            if (existing.contains(path)) {
                return attrs;
            }
            throw new SftpException(ChannelSftp.SSH_FX_NO_SUCH_FILE, "no such file");
        });
        return channel;
    }
}
