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
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 自动执行模式不再按危险命令暂停，命令直接执行 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AiAgentAutoExecTest {

    @Mock
    private AiChatClient chatClient;
    @Mock
    private SshSessionManager sessions;
    @Mock
    private ConnectionService connections;
    @Mock
    private AuditService audit;

    @Test
    void autoModeExecutesDangerousCommandWithoutConfirm() throws Exception {
        SshSessionManager.SshSession session = mock(SshSessionManager.SshSession.class);
        when(session.getConnectionId()).thenReturn(1L);
        when(sessions.get("s1")).thenReturn(session);
        SshConnection cfg = new SshConnection();
        cfg.setUsername("u");
        cfg.setHost("h");
        when(connections.get(1L)).thenReturn(cfg);
        when(chatClient.streamDetailed(anyString(), anyList(), any(), any(), any()))
                .thenReturn(new AiChatClient.ChatResult(
                        "{\"cmd\":\"rm -rf /tmp/ds-test\",\"note\":\"删除测试目录\"}", null));
        SshSessionManager.ExecResult exec = new SshSessionManager.ExecResult();
        exec.output = "ok";
        exec.exitCode = 0;
        exec.cwd = "/tmp";
        when(sessions.execInShell(any(), anyString(), anyString(), anyLong(), anyInt(), any()))
                .thenReturn(exec);

        AiAgentService service = new AiAgentService(chatClient, sessions, connections, audit);
        AiAgentService.AgentMessage user = new AiAgentService.AgentMessage();
        user.role = "user";
        user.content = "删除测试目录";
        AiAgentService.AgentResult r = service.stepStream("s1", "/tmp", true,
                Collections.singletonList(user), s -> { }, s -> { }, new AiCancellationToken());

        assertEquals("cmd", r.kind);
        assertEquals("rm -rf /tmp/ds-test", r.command);
        assertFalse(r.needConfirm);
        assertTrue(r.executed);
        assertEquals(Integer.valueOf(0), r.exitCode);
        verify(sessions).execInShell(any(), anyString(), anyString(), anyLong(), anyInt(), any());
    }
}
