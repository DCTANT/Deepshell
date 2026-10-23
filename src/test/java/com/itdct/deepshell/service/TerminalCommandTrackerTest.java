package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TerminalCommandTrackerTest {

    @Test
    void emitsCommandOnEnter() {
        TerminalCommandTracker tracker = new TerminalCommandTracker();
        assertEquals(Collections.singletonList("ls -la"), tracker.feed("ls -la\r"));
    }

    @Test
    void handlesBackspace() {
        TerminalCommandTracker tracker = new TerminalCommandTracker();
        tracker.feed("echo hellp");
        tracker.feed("\u007f");
        tracker.feed("o");
        assertEquals(Collections.singletonList("echo hello"), tracker.feed("\r"));
    }

    @Test
    void ignoresArrowSequences() {
        TerminalCommandTracker tracker = new TerminalCommandTracker();
        tracker.feed("\u001b[A\u001b[B");
        assertEquals(Collections.singletonList("echo ok"), tracker.feed("echo ok\r"));
    }

    @Test
    void crlfEmitsOnceAndMultiLineSplits() {
        TerminalCommandTracker tracker = new TerminalCommandTracker();
        assertEquals(Collections.singletonList("pwd"), tracker.feed("pwd\r\n"));
        assertEquals(Arrays.asList("uname -a", "whoami"), tracker.feed("uname -a\nwhoami\n"));
    }

    @Test
    void ctrlCClearsCurrentLine() {
        TerminalCommandTracker tracker = new TerminalCommandTracker();
        tracker.feed("rm -rf /");
        tracker.feed("\u0003");
        assertTrue(tracker.feed("\r").isEmpty());
    }

    @Test
    void skipsEmptyLines() {
        TerminalCommandTracker tracker = new TerminalCommandTracker();
        assertTrue(tracker.feed("\r\n\n").isEmpty());
    }
}
