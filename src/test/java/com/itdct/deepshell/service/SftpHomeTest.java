package com.itdct.deepshell.service;

import com.jcraft.jsch.Channel;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.SftpATTRS;
import com.jcraft.jsch.SftpException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Termux 家目录识别：/ 不可用时回退到 Termux 的 $HOME */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SftpHomeTest {

    @Mock
    private SshSessionManager sessions;

    @Test
    void keepsNormalServerHome() throws Exception {
        ChannelSftp sftp = channel("/home/alice", null, false);

        assertEquals("/home/alice", service(sftp).home("s1"));
        verify(sftp, never()).stat(SftpService.TERMUX_HOME);
    }

    @Test
    void keepsTermuxHomeWhenServerReturnsIt() throws Exception {
        String home = "/data/data/com.termux/files/home";
        ChannelSftp sftp = channel(home, null, false);

        assertEquals(home, service(sftp).home("s1"));
        verify(sftp, never()).stat(SftpService.TERMUX_HOME);
    }

    @Test
    void fallsBackToTermuxHomeWhenSshdReturnsRoot() throws Exception {
        SftpATTRS attrs = mock(SftpATTRS.class);
        when(attrs.isDir()).thenReturn(true);
        ChannelSftp sftp = channel("/", attrs, false);

        assertEquals(SftpService.TERMUX_HOME, service(sftp).home("s1"));
    }

    @Test
    void staysWithRootWhenTermuxHomeIsAbsent() throws Exception {
        ChannelSftp sftp = channel("/", null, true);

        assertEquals("/", service(sftp).home("s1"));
    }

    private SftpService service(ChannelSftp sftp) throws Exception {
        Session jsch = mock(Session.class);
        Channel channel = mock(Channel.class);
        when(channel.getOutputStream()).thenReturn(new ByteArrayOutputStream());
        when(channel.getInputStream()).thenReturn(new ByteArrayInputStream(new byte[0]));
        SshSessionManager.SshSession session = new SshSessionManager.SshSession(
                1L, "termux", null, jsch, channel, null, null, Collections.emptyList());
        session.setSftpChannel(sftp);
        when(sessions.get("s1")).thenReturn(session);
        return new SftpService(sessions);
    }

    private static ChannelSftp channel(String home, SftpATTRS attrs, boolean missing) throws Exception {
        ChannelSftp sftp = mock(ChannelSftp.class);
        when(sftp.isConnected()).thenReturn(true);
        when(sftp.getHome()).thenReturn(home);
        if (attrs != null) {
            when(sftp.stat(SftpService.TERMUX_HOME)).thenReturn(attrs);
        } else if (missing) {
            when(sftp.stat(SftpService.TERMUX_HOME))
                    .thenThrow(new SftpException(2, "No such file"));
        }
        return sftp;
    }
}
