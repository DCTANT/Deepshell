package com.itdct.deepshell.ws;

import com.itdct.deepshell.service.WorkspaceEventService;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/** 工作台事件通道：外部接口新增/更新连接后，通知在线页面自动打开连接标签。 */
@Component
public class WorkspaceEventWebSocketHandler extends TextWebSocketHandler {

    private final WorkspaceEventService events;

    public WorkspaceEventWebSocketHandler(WorkspaceEventService events) {
        this.events = events;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        events.register(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        // 前端目前只接收事件；保留 ping 便于将来做心跳
        if ("ping".equalsIgnoreCase(message.getPayload())) {
            try {
                synchronized (session) {
                    session.sendMessage(new TextMessage("pong"));
                }
            } catch (Exception ignore) {
                // 浏览器已断开
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        events.unregister(session);
    }
}
