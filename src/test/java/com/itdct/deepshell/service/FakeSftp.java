package com.itdct.deepshell.service;

import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.SftpATTRS;
import com.jcraft.jsch.SftpException;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Vector;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 供 SFTP 相关单测使用的内存文件树 */
final class FakeSftp {

    private static final int MTIME = 1700000000;

    private final ChannelSftp channel = mock(ChannelSftp.class);
    private final SftpATTRS dirAttrs = mock(SftpATTRS.class);
    private final Map<String, Boolean> types = new HashMap<>();
    private final Map<String, SftpATTRS> attrs = new HashMap<>();
    private final Map<String, String> contents = new HashMap<>();
    private final Map<String, Vector<ChannelSftp.LsEntry>> children = new HashMap<>();
    private final Map<String, String> realPaths = new HashMap<>();

    FakeSftp() throws Exception {
        when(dirAttrs.isDir()).thenReturn(true);
        when(dirAttrs.getMTime()).thenReturn(MTIME);
        when(channel.stat(anyString())).thenAnswer(inv -> {
            String path = inv.getArgument(0);
            if (!types.containsKey(path)) {
                throw new SftpException(ChannelSftp.SSH_FX_NO_SUCH_FILE, "no such file: " + path);
            }
            return types.get(path) ? dirAttrs : attrs.get(path);
        });
        when(channel.realpath(anyString())).thenAnswer(inv -> {
            String path = inv.getArgument(0);
            return realPaths.containsKey(path) ? realPaths.get(path) : path;
        });
        when(channel.ls(anyString())).thenAnswer(inv -> {
            String path = inv.getArgument(0);
            Vector<ChannelSftp.LsEntry> list = children.get(path);
            if (list == null) {
                throw new SftpException(ChannelSftp.SSH_FX_NO_SUCH_FILE, "no such dir: " + path);
            }
            return list;
        });
        when(channel.get(anyString())).thenAnswer(inv -> {
            String path = inv.getArgument(0);
            if (!contents.containsKey(path) || contents.get(path) == null) {
                throw new SftpException(ChannelSftp.SSH_FX_FAILURE, "read failed: " + path);
            }
            return new ByteArrayInputStream(contents.get(path).getBytes(StandardCharsets.UTF_8));
        });
    }

    ChannelSftp channel() {
        return channel;
    }

    void file(String path, String content) throws Exception {
        types.put(path, false);
        SftpATTRS fileAttrs = mock(SftpATTRS.class);
        when(fileAttrs.isDir()).thenReturn(false);
        when(fileAttrs.getMTime()).thenReturn(MTIME);
        when(fileAttrs.getSize()).thenReturn(content == null
                ? 0L : content.getBytes(StandardCharsets.UTF_8).length);
        attrs.put(path, fileAttrs);
        contents.put(path, content);
    }

    void dir(String path) {
        types.put(path, true);
    }

    void children(String path, String... names) {
        Vector<ChannelSftp.LsEntry> list = new Vector<>();
        for (String name : names) {
            ChannelSftp.LsEntry entry = mock(ChannelSftp.LsEntry.class);
            when(entry.getFilename()).thenReturn(name);
            list.add(entry);
        }
        children.put(path, list);
    }

    void realpath(String path, String real) {
        realPaths.put(path, real);
    }
}
