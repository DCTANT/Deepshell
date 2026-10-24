package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.SshConnection;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 无法解析的 DSML 自动让模型改写为 JSON 后重试 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AiAgentDsmlRepairTest {

    @Mock
    private AiChatClient chatClient;
    @Mock
    private SshSessionManager sessions;
    @Mock
    private ConnectionService connections;
    @Mock
    private AuditService audit;

    @Test
    void retriesWithJsonWhenDsmlCannotBeParsed() throws Exception {
        SshSessionManager.SshSession session = mock(SshSessionManager.SshSession.class);
        when(session.getConnectionId()).thenReturn(1L);
        when(sessions.get("s1")).thenReturn(session);
        SshConnection cfg = new SshConnection();
        cfg.setUsername("u");
        cfg.setHost("h");
        when(connections.get(1L)).thenReturn(cfg);

        AiChatClient.ChatResult broken = new AiChatClient.ChatResult(
                "<parameter name=\"cmd\">ls", null);
        AiChatClient.ChatResult fixed = new AiChatClient.ChatResult(
                "{\"cmd\":\"ls -la\",\"note\":\"列目录\"}", null);
        when(chatClient.streamDetailed(anyString(), anyList(), any(), any(), any()))
                .thenReturn(broken, fixed);

        AiAgentService service = new AiAgentService(chatClient, sessions, connections, audit);
        AiAgentService.AgentMessage user = new AiAgentService.AgentMessage();
        user.role = "user";
        user.content = "查看当前目录";
        AiAgentService.AgentResult r = service.stepStream("s1", "/tmp", false,
                Collections.singletonList(user), s -> { }, s -> { }, new AiCancellationToken());

        assertEquals("cmd", r.kind);
        assertEquals("ls -la", r.command);
        assertEquals("列目录", r.note);
        assertTrue(r.needConfirm);
        verify(chatClient, times(2)).streamDetailed(anyString(), anyList(), any(), any(), any());

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Map<String, String>>> history =
                ArgumentCaptor.forClass((Class) List.class);
        verify(chatClient, times(2)).streamDetailed(anyString(), history.capture(), any(), any(), any());
        List<Map<String, String>> repair = history.getAllValues().get(1);
        assertEquals("assistant", repair.get(repair.size() - 2).get("role"));
        assertTrue(repair.get(repair.size() - 2).get("content").contains("<parameter"));
        assertTrue(repair.get(repair.size() - 1).get("content").contains("只输出以下两种 JSON"));
    }
}
