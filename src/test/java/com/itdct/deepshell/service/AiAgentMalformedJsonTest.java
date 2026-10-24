package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.SshConnection;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 模型 JSON 命令格式损坏时的宽松解析与自动重试 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AiAgentMalformedJsonTest {

    /** 线上实际出现的输出：note 字符串漏掉了收尾引号 */
    private static final String MISSING_QUOTE =
            "{\"cmd\":\"ls -R /data/a /data/b\",\"note\":\"列出框架 file 包下所有内容}";

    @Mock
    private AiChatClient chatClient;
    @Mock
    private SshSessionManager sessions;
    @Mock
    private ConnectionService connections;
    @Mock
    private AuditService audit;

    @Test
    void extractsAndExecutesCommandWhenClosingQuoteIsMissing() throws Exception {
        prepareSession();
        when(chatClient.streamDetailed(anyString(), anyList(), any(), any(), any()))
                .thenReturn(new AiChatClient.ChatResult(MISSING_QUOTE, null));
        SshSessionManager.ExecResult exec = new SshSessionManager.ExecResult();
        exec.output = "file list";
        exec.exitCode = 0;
        exec.cwd = "/tmp";
        when(sessions.execInShell(any(), anyString(), anyString(), anyLong(), anyInt(), any()))
                .thenReturn(exec);

        AiAgentService.AgentResult r = run("查看 file 包");

        assertEquals("cmd", r.kind);
        assertEquals("ls -R /data/a /data/b", r.command);
        assertEquals("列出框架 file 包下所有内容", r.note);
        assertFalse(r.needConfirm);
        assertTrue(r.executed);
        verify(sessions).execInShell(any(), anyString(), anyString(), anyLong(), anyInt(), any());
    }

    @Test
    void asksModelToRewriteWhenCommandJsonCannotBeRecovered() throws Exception {
        prepareSession();
        AiChatClient.ChatResult broken = new AiChatClient.ChatResult("{\"cmd\":}", null);
        AiChatClient.ChatResult fixed = new AiChatClient.ChatResult(
                "{\"cmd\":\"pwd\",\"note\":\"查看目录\"}", null);
        when(chatClient.streamDetailed(anyString(), anyList(), any(), any(), any()))
                .thenReturn(broken, fixed);
        SshSessionManager.ExecResult exec = new SshSessionManager.ExecResult();
        exec.output = "/tmp";
        exec.exitCode = 0;
        when(sessions.execInShell(any(), anyString(), anyString(), anyLong(), anyInt(), any()))
                .thenReturn(exec);

        AiAgentService.AgentResult r = run("查看当前目录");

        assertEquals("cmd", r.kind);
        assertEquals("pwd", r.command);
        assertEquals("查看目录", r.note);
        verify(chatClient, times(2)).streamDetailed(anyString(), anyList(), any(), any(), any());
    }

    @Test
    void doesNotExecuteTruncatedCommandAndAsksForRewrite() throws Exception {
        prepareSession();
        AiChatClient.ChatResult truncated = new AiChatClient.ChatResult("{\"cmd\":\"rm -rf /tmp/unsafe", null);
        AiChatClient.ChatResult fixed = new AiChatClient.ChatResult(
                "{\"cmd\":\"pwd\",\"note\":\"查看目录\"}", null);
        when(chatClient.streamDetailed(anyString(), anyList(), any(), any(), any()))
                .thenReturn(truncated, fixed);
        SshSessionManager.ExecResult exec = new SshSessionManager.ExecResult();
        exec.output = "/tmp";
        exec.exitCode = 0;
        when(sessions.execInShell(any(), anyString(), anyString(), anyLong(), anyInt(), any()))
                .thenReturn(exec);

        AiAgentService.AgentResult r = run("查看当前目录");

        assertEquals("cmd", r.kind);
        assertEquals("pwd", r.command);
        verify(chatClient, times(2)).streamDetailed(anyString(), anyList(), any(), any(), any());
    }

    @Test
    void returnsReadableReplyWhenRepairsAlsoFail() throws Exception {
        prepareSession();
        when(chatClient.streamDetailed(anyString(), anyList(), any(), any(), any()))
                .thenReturn(new AiChatClient.ChatResult("{\"cmd\":}", null));
        when(sessions.execInShell(any(), anyString(), anyString(), anyLong(), anyInt(), any()))
                .thenReturn(new SshSessionManager.ExecResult());

        AiAgentService.AgentResult r = run("查看当前目录");

        assertEquals("reply", r.kind);
        assertTrue(r.text.contains("格式不完整"));
        assertFalse(r.text.contains("{\"cmd\""));
        verify(chatClient, times(3)).streamDetailed(anyString(), anyList(), any(), any(), any());
    }

    private void prepareSession() {
        SshSessionManager.SshSession session = mock(SshSessionManager.SshSession.class);
        when(session.getConnectionId()).thenReturn(1L);
        when(sessions.get("s1")).thenReturn(session);
        SshConnection cfg = new SshConnection();
        cfg.setUsername("u");
        cfg.setHost("h");
        when(connections.get(1L)).thenReturn(cfg);
    }

    private AiAgentService.AgentResult run(String text) {
        AiAgentService service = new AiAgentService(chatClient, sessions, connections, audit);
        AiAgentService.AgentMessage user = new AiAgentService.AgentMessage();
        user.role = "user";
        user.content = text;
        return service.stepStream("s1", "/tmp", true,
                Collections.singletonList(user), s -> { }, s -> { }, new AiCancellationToken());
    }
}
