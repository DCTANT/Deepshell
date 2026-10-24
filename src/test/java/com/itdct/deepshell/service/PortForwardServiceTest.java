package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.PortForwardForm;
import com.itdct.deepshell.entity.PortForwardRule;
import com.itdct.deepshell.entity.SshConnection;
import com.itdct.deepshell.repo.PortForwardRuleRepository;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Arrays;
import java.util.Collections;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 端口转发规则校验、按连接复用与跨会话停止 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PortForwardServiceTest {

    @Mock
    private PortForwardRuleRepository repo;
    @Mock
    private SshSessionManager sessions;
    @Mock
    private ConnectionService connections;
    @Mock
    private AuditService audit;

    private PortForwardService service;

    private SshSessionManager.SshSession session1;
    private SshSessionManager.SshSession session2;
    private Session jsch1;
    private Session jsch2;

    @BeforeEach
    void setUp() {
        service = new PortForwardService(repo, sessions, connections, audit);
        when(repo.existsById(anyLong())).thenReturn(true);
        jsch1 = mock(Session.class);
        jsch2 = mock(Session.class);
        session1 = session("s1", jsch1);
        session2 = session("s2", jsch2);
    }

    @Test
    void createRejectsUnknownConnection() {
        when(connections.get(99L)).thenThrow(new IllegalArgumentException("连接不存在: 99"));
        PortForwardForm form = form(99L, "127.0.0.1", 8080, "127.0.0.1", 80);

        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.create(form, null));

        assertTrue(e.getMessage().contains("连接不存在"));
        verify(repo, never()).save(any());
    }

    @Test
    void createDefaultsBindHostToLoopbackForSafety() {
        stubConnection(1L);
        when(repo.findByConnectionIdOrderByIdAsc(1L)).thenReturn(Collections.emptyList());
        when(repo.save(any(PortForwardRule.class))).thenAnswer(inv -> withId(inv.getArgument(0), 10L));
        PortForwardForm form = form(1L, null, 8080, "db.internal", 3306);
        form.setAutoStart(false);

        Map<?, ?> ruleView = (Map<?, ?>) service.create(form, null).get("rule");

        assertEquals("127.0.0.1", ruleView.get("bindHost"));
        assertEquals(Boolean.FALSE, ruleView.get("running"));
    }

    @Test
    void startLocalForwardBindsAndReportsPort() throws Exception {
        PortForwardRule rule = rule("LOCAL", "127.0.0.1", 8080, "db.internal", 3306);
        when(repo.findById(10L)).thenReturn(Optional.of(rule));
        when(sessions.get("s1")).thenReturn(session1);
        when(sessions.liveSessionsForConnection(1L)).thenReturn(Collections.singletonList(session1));
        when(jsch1.setPortForwardingL("127.0.0.1", 8080, "db.internal", 3306)).thenReturn(8080);

        PortForwardService.RuntimeForward rt = service.start(10L, "s1");

        assertTrue(rt.running);
        assertEquals(8080, rt.actualPort);
        verify(jsch1).setPortForwardingL("127.0.0.1", 8080, "db.internal", 3306);
    }

    @Test
    void remoteForwardUsesRemoteBindAddress() throws Exception {
        PortForwardRule rule = rule("REMOTE", "127.0.0.1", 9000, "127.0.0.1", 3000);
        when(repo.findById(10L)).thenReturn(Optional.of(rule));
        when(sessions.get("s1")).thenReturn(session1);
        when(sessions.liveSessionsForConnection(1L)).thenReturn(Collections.singletonList(session1));

        PortForwardService.RuntimeForward rt = service.start(10L, "s1");

        assertTrue(rt.running);
        assertEquals(9000, rt.actualPort);
        verify(jsch1).setPortForwardingR("127.0.0.1", 9000, "127.0.0.1", 3000);
    }

    @Test
    void bindFailureIsReportedNotThrown() throws Exception {
        stubConnection(1L);
        when(repo.findByConnectionIdOrderByIdAsc(1L)).thenReturn(Collections.emptyList());
        when(repo.save(any(PortForwardRule.class))).thenAnswer(inv -> withId(inv.getArgument(0), 10L));
        when(sessions.get("s1")).thenReturn(session1);
        when(sessions.liveSessionsForConnection(1L)).thenReturn(Collections.singletonList(session1));
        when(jsch1.setPortForwardingL(anyString(), anyInt(), anyString(), anyInt()))
                .thenThrow(new JSchException("Address already in use"));

        Map<?, ?> ruleView = (Map<?, ?>) service.create(
                form(1L, "127.0.0.1", 8080, "127.0.0.1", 80), "s1").get("rule");

        assertEquals(Boolean.FALSE, ruleView.get("running"));
        assertTrue(String.valueOf(ruleView.get("error")).contains("被占用"));
    }

    @Test
    void secondSessionReusesRunningRuleInsteadOfBindingAgain() throws Exception {
        PortForwardRule rule = rule("LOCAL", "127.0.0.1", 8080, "127.0.0.1", 80);
        when(repo.findById(10L)).thenReturn(Optional.of(rule));
        when(sessions.get("s1")).thenReturn(session1);
        when(sessions.get("s2")).thenReturn(session2);
        when(sessions.liveSessionsForConnection(1L)).thenReturn(Arrays.asList(session1, session2));
        when(jsch1.setPortForwardingL("127.0.0.1", 8080, "127.0.0.1", 80)).thenReturn(8080);

        assertTrue(service.start(10L, "s1").running);
        PortForwardService.RuntimeForward second = service.start(10L, "s2");

        assertTrue(second.running);
        verify(jsch2, never()).setPortForwardingL(anyString(), anyInt(), anyString(), anyInt());
    }

    @Test
    void deleteStopsForwardStartedByAnotherSession() throws Exception {
        PortForwardRule rule = rule("LOCAL", "127.0.0.1", 8080, "127.0.0.1", 80);
        when(repo.findById(10L)).thenReturn(Optional.of(rule));
        when(sessions.get("s1")).thenReturn(session1);
        when(sessions.get("s2")).thenReturn(session2);
        when(sessions.liveSessionsForConnection(1L)).thenReturn(Arrays.asList(session1, session2));
        when(jsch1.setPortForwardingL("127.0.0.1", 8080, "127.0.0.1", 80)).thenReturn(8080);

        service.start(10L, "s1");
        service.delete(10L, "s2");

        verify(jsch1).delPortForwardingL("127.0.0.1", 8080);
        verify(repo).delete(rule);
    }

    @Test
    void updateRejectsMovingRuleToAnotherConnection() {
        PortForwardRule rule = rule("LOCAL", "127.0.0.1", 8080, "127.0.0.1", 80);
        when(repo.findById(10L)).thenReturn(Optional.of(rule));

        assertThrows(IllegalArgumentException.class,
                () -> service.update(10L, form(2L, "127.0.0.1", 8080, "127.0.0.1", 80), null));
        verify(repo, never()).save(any());
    }

    @Test
    void duplicateListenPortOnSameConnectionIsRejected() {
        stubConnection(1L);
        PortForwardRule existing = rule("LOCAL", "127.0.0.1", 8080, "127.0.0.1", 80);
        when(repo.findByConnectionIdOrderByIdAsc(1L)).thenReturn(Collections.singletonList(existing));

        assertThrows(IllegalArgumentException.class,
                () -> service.create(form(1L, "127.0.0.1", 8080, "other", 443), null));
        verify(repo, never()).save(any());
    }

    @Test
    void rejectsInvalidAddressPortAndDirection() {
        stubConnection(1L);
        assertThrows(IllegalArgumentException.class,
                () -> service.create(form(1L, "127.0.0.1", 8080, "db host", 3306), null));
        assertThrows(IllegalArgumentException.class,
                () -> service.create(form(1L, "127.0.0.1", 0, "db", 3306), null));

        PortForwardForm badDirection = form(1L, "127.0.0.1", 8080, "db", 3306);
        badDirection.setDirection("DYNAMIC");
        assertThrows(IllegalArgumentException.class, () -> service.create(badDirection, null));
    }

    private void stubConnection(Long id) {
        when(connections.get(id)).thenReturn(new SshConnection());
    }

    private static SshSessionManager.SshSession session(String id, Session jsch) {
        SshSessionManager.SshSession s = mock(SshSessionManager.SshSession.class);
        when(s.getId()).thenReturn(id);
        when(s.getConnectionId()).thenReturn(1L);
        when(s.getJsch()).thenReturn(jsch);
        when(s.isClosed()).thenReturn(false);
        return s;
    }

    private static PortForwardRule rule(String direction, String bindHost, int bindPort,
                                        String destHost, int destPort) {
        PortForwardRule rule = new PortForwardRule();
        rule.setId(10L);
        rule.setConnectionId(1L);
        rule.setDirection(direction);
        rule.setBindHost(bindHost);
        rule.setBindPort(bindPort);
        rule.setDestHost(destHost);
        rule.setDestPort(destPort);
        rule.setAutoStart(true);
        return rule;
    }

    private static PortForwardRule withId(PortForwardRule rule, Long id) {
        rule.setId(id);
        return rule;
    }

    private static PortForwardForm form(Long connectionId, String bindHost, int bindPort,
                                        String destHost, int destPort) {
        PortForwardForm form = new PortForwardForm();
        form.setConnectionId(connectionId);
        form.setDirection("LOCAL");
        form.setBindHost(bindHost);
        form.setBindPort(bindPort);
        form.setDestHost(destHost);
        form.setDestPort(destPort);
        form.setAutoStart(true);
        return form;
    }
}
