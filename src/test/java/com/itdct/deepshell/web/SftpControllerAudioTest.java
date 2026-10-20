package com.itdct.deepshell.web;

import com.itdct.deepshell.service.ArchiveService;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.DownloadTaskService;
import com.itdct.deepshell.service.SftpService;
import com.itdct.deepshell.service.TransferService;
import com.itdct.deepshell.service.VscodeEditService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.io.OutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SftpControllerAudioTest {

    private SftpService sftp;
    private SftpController controller;

    @BeforeEach
    void setUp() {
        sftp = mock(SftpService.class);
        controller = new SftpController(sftp,
                mock(VscodeEditService.class),
                mock(ArchiveService.class),
                mock(TransferService.class),
                mock(AuditService.class),
                mock(DownloadTaskService.class));
    }

    private void streamBytes(long expectedLength) throws Exception {
        doAnswer(inv -> {
            OutputStream out = inv.getArgument(4);
            out.write(new byte[(int) expectedLength]);
            return null;
        }).when(sftp).streamRange(eq("s1"), eq("/music/demo.mp3"), anyLong(), anyLong(), any());
    }

    @Test
    void servesFullAudioWithoutRange() throws Exception {
        when(sftp.fileSize("s1", "/music/demo.mp3")).thenReturn(2048L);
        streamBytes(2048);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/sftp/audio");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        controller.audio("s1", "/music/demo.mp3", req, resp);

        assertEquals(200, resp.getStatus());
        assertEquals("audio/mpeg", resp.getContentType());
        assertEquals("bytes", resp.getHeader("Accept-Ranges"));
        assertEquals("2048", resp.getHeader("Content-Length"));
        assertEquals(2048, resp.getContentAsByteArray().length);
        verify(sftp).streamRange(eq("s1"), eq("/music/demo.mp3"), eq(0L), eq(2048L),
                any(OutputStream.class));
    }

    @Test
    void servesPartialRange() throws Exception {
        when(sftp.fileSize("s1", "/music/demo.mp3")).thenReturn(1000L);
        streamBytes(100);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/sftp/audio");
        req.addHeader("Range", "bytes=200-299");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        controller.audio("s1", "/music/demo.mp3", req, resp);

        assertEquals(206, resp.getStatus());
        assertEquals("bytes 200-299/1000", resp.getHeader("Content-Range"));
        assertEquals("100", resp.getHeader("Content-Length"));
        assertEquals(100, resp.getContentAsByteArray().length);
    }

    @Test
    void rejectsUnsatisfiableRange() throws Exception {
        when(sftp.fileSize("s1", "/music/demo.mp3")).thenReturn(1000L);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/sftp/audio");
        req.addHeader("Range", "bytes=2000-");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        controller.audio("s1", "/music/demo.mp3", req, resp);

        assertEquals(416, resp.getStatus());
        assertEquals("bytes */1000", resp.getHeader("Content-Range"));
        verify(sftp, never()).streamRange(any(), any(), anyLong(), anyLong(), any());
    }

    @Test
    void headRequestSetsLengthWithoutBody() throws Exception {
        when(sftp.fileSize("s1", "/music/demo.mp3")).thenReturn(1000L);
        MockHttpServletRequest req = new MockHttpServletRequest("HEAD", "/api/sftp/audio");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        controller.audio("s1", "/music/demo.mp3", req, resp);

        assertEquals(200, resp.getStatus());
        assertEquals("1000", resp.getHeader("Content-Length"));
        assertEquals(0, resp.getContentAsByteArray().length);
        verify(sftp, never()).streamRange(any(), any(), anyLong(), anyLong(), any());
    }

    @Test
    void rejectsNonAudioExtension() {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/sftp/audio");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> controller.audio("s1", "/data/readme.txt", req, resp));
        assertTrue(error.getMessage().contains("不支持音频预览"));
    }

    @Test
    void mapsCommonAudioExtensions() {
        assertEquals("audio/mpeg", SftpController.audioContentType("song.mp3"));
        assertEquals("audio/wav", SftpController.audioContentType("track.WAV"));
        assertEquals("audio/flac", SftpController.audioContentType("lossless.flac"));
        assertEquals("audio/aac", SftpController.audioContentType("radio.aac"));
        assertEquals("audio/ogg", SftpController.audioContentType("voice.ogg"));
        assertEquals("audio/ogg", SftpController.audioContentType("voice.opus"));
        assertEquals("audio/mp4", SftpController.audioContentType("podcast.m4a"));
        assertEquals("audio/x-ms-wma", SftpController.audioContentType("old.wma"));
        assertNull(SftpController.audioContentType("movie.mp4"));
        assertNull(SftpController.audioContentType("noext"));
    }
}
