package com.itdct.deepshell.web;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class SftpControllerRangeTest {

    @Test
    void parsesBoundedRange() {
        assertArrayEquals(new long[]{100, 199}, SftpController.parseRange("bytes=100-199", 1000));
    }

    @Test
    void parsesOpenEndedRange() {
        assertArrayEquals(new long[]{100, 999}, SftpController.parseRange("bytes=100-", 1000));
    }

    @Test
    void parsesSuffixRange() {
        assertArrayEquals(new long[]{800, 999}, SftpController.parseRange("bytes=-200", 1000));
    }

    @Test
    void suffixLargerThanFileCoversWholeFile() {
        assertArrayEquals(new long[]{0, 999}, SftpController.parseRange("bytes=-5000", 1000));
    }

    @Test
    void endBeyondFileIsClamped() {
        assertArrayEquals(new long[]{900, 999}, SftpController.parseRange("bytes=900-5000", 1000));
    }

    @Test
    void acceptsCaseInsensitiveUnitAndWhitespace() {
        assertArrayEquals(new long[]{0, 1}, SftpController.parseRange(" Bytes=0-1 ", 1000));
    }

    @Test
    void rejectsInvalidRanges() {
        assertNull(SftpController.parseRange("bytes=1000-", 1000));
        assertNull(SftpController.parseRange("bytes=-0", 1000));
        assertNull(SftpController.parseRange("bytes=200-100", 1000));
        assertNull(SftpController.parseRange("bytes=0-1,4-5", 1000));
        assertNull(SftpController.parseRange("items=0-1", 1000));
        assertNull(SftpController.parseRange("bytes=abc-def", 1000));
        assertNull(SftpController.parseRange("bytes=0-", 0));
        assertNull(SftpController.parseRange(null, 1000));
    }

    @Test
    void mapsVideoContentTypes() {
        assertEquals("video/mp4", SftpController.videoContentType("movie.mp4"));
        assertEquals("video/mp4", SftpController.videoContentType("MOVIE.M4V"));
        assertEquals("video/webm", SftpController.videoContentType("clip.webm"));
        assertEquals("video/x-matroska", SftpController.videoContentType("clip.mkv"));
        assertEquals("video/mp2t", SftpController.videoContentType("stream.ts"));
        assertNull(SftpController.videoContentType("readme.txt"));
        assertNull(SftpController.videoContentType("noext"));
    }
}
