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

class SftpControllerVideoTest {

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
        }).when(sftp).streamRange(eq("s1"), eq("/data/demo.mp4"), anyLong(), anyLong(), any());
    }

    @Test
    void servesFullFileWithoutRange() throws Exception {
        when(sftp.fileSize("s1", "/data/demo.mp4")).thenReturn(1000L);
        streamBytes(1000);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/sftp/video");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        controller.video("s1", "/data/demo.mp4", req, resp);

        assertEquals(200, resp.getStatus());
        assertEquals("video/mp4", resp.getContentType());
        assertEquals("bytes", resp.getHeader("Accept-Ranges"));
        assertEquals("1000", resp.getHeader("Content-Length"));
        assertEquals(1000, resp.getContentAsByteArray().length);
        verify(sftp).streamRange(eq("s1"), eq("/data/demo.mp4"), eq(0L), eq(1000L),
                any(OutputStream.class));
    }

    @Test
    void servesPartialRange() throws Exception {
        when(sftp.fileSize("s1", "/data/demo.mp4")).thenReturn(1000L);
        streamBytes(100);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/sftp/video");
        req.addHeader("Range", "bytes=100-199");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        controller.video("s1", "/data/demo.mp4", req, resp);

        assertEquals(206, resp.getStatus());
        assertEquals("bytes 100-199/1000", resp.getHeader("Content-Range"));
        assertEquals("100", resp.getHeader("Content-Length"));
        assertEquals(100, resp.getContentAsByteArray().length);
    }

    @Test
    void servesSuffixRange() throws Exception {
        when(sftp.fileSize("s1", "/data/demo.mp4")).thenReturn(1000L);
        streamBytes(100);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/sftp/video");
        req.addHeader("Range", "bytes=-100");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        controller.video("s1", "/data/demo.mp4", req, resp);

        assertEquals(206, resp.getStatus());
        assertEquals("bytes 900-999/1000", resp.getHeader("Content-Range"));
    }

    @Test
    void rejectsUnsatisfiableRange() throws Exception {
        when(sftp.fileSize("s1", "/data/demo.mp4")).thenReturn(1000L);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/sftp/video");
        req.addHeader("Range", "bytes=2000-");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        controller.video("s1", "/data/demo.mp4", req, resp);

        assertEquals(416, resp.getStatus());
        assertEquals("bytes */1000", resp.getHeader("Content-Range"));
        verify(sftp, never()).streamRange(any(), any(), anyLong(), anyLong(), any());
    }

    @Test
    void headRequestSetsLengthWithoutBody() throws Exception {
        when(sftp.fileSize("s1", "/data/demo.mp4")).thenReturn(1000L);
        MockHttpServletRequest req = new MockHttpServletRequest("HEAD", "/api/sftp/video");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        controller.video("s1", "/data/demo.mp4", req, resp);

        assertEquals(200, resp.getStatus());
        assertEquals("1000", resp.getHeader("Content-Length"));
        assertEquals(0, resp.getContentAsByteArray().length);
        verify(sftp, never()).streamRange(any(), any(), anyLong(), anyLong(), any());
    }

    @Test
    void rejectsNonVideoExtension() {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/sftp/video");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> controller.video("s1", "/data/readme.txt", req, resp));
        assertTrue(error.getMessage().contains("不支持视频预览"));
    }
}
