package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 已打开工作台页面的轻量事件通道。
 * 外部 HTTP 接口新增/更新连接后通过这里通知所有在线页面主动打开连接标签；
 * 只广播连接 ID / 名称 / 视图等非敏感信息，不传密码。
 */
@Slf4j
@Service
public class WorkspaceEventService {

    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();
    private final ObjectMapper om = new ObjectMapper();

    public void register(WebSocketSession session) {
        sessions.add(session);
    }

    public void unregister(WebSocketSession session) {
        sessions.remove(session);
    }

    public int clientCount() {
        int open = 0;
        for (WebSocketSession session : sessions) {
            if (session.isOpen()) {
                open++;
            } else {
                sessions.remove(session);
            }
        }
        return open;
    }

    /**
     * @return 成功收到事件的在线页面数；0 表示当前没有已打开的 DeepShell 页面
     */
    public int broadcastOpen(Long connectionId, String name, String view,
                             String source, String workspaceUrl) {
        ObjectNode event = om.createObjectNode();
        event.put("type", "open-connection");
        event.put("connId", connectionId);
        event.put("name", name == null ? "" : name);
        event.put("view", view == null ? "" : view);
        event.put("source", source == null ? "" : source);
        event.put("workspaceUrl", workspaceUrl == null ? "" : workspaceUrl);
        return send(event.toString());
    }

    /** 只保存连接时通知在线页面刷新连接列表，不主动打开标签。 */
    public int broadcastConnectionsChanged() {
        ObjectNode event = om.createObjectNode();
        event.put("type", "connections-changed");
        return send(event.toString());
    }

    private int send(String json) {
        int sent = 0;
        for (WebSocketSession session : sessions) {
            if (!session.isOpen()) {
                sessions.remove(session);
                continue;
            }
            try {
                synchronized (session) {
                    session.sendMessage(new TextMessage(json));
                }
                sent++;
            } catch (Exception e) {
                sessions.remove(session);
                try {
                    session.close();
                } catch (Exception ignore) {
                    // 浏览器已断开
                }
            }
        }
        return sent;
    }
}
