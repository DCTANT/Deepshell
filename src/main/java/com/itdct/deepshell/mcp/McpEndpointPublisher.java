package com.itdct.deepshell.mcp;

import com.itdct.deepshell.config.LocalServerInfo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 启动完成后把实际 MCP 地址与 Token 写到数据目录 mcp-server.json，
 * 让同 jar 的 stdio 桥接进程不必猜测端口 / 协议。
 */
@Slf4j
@Component
public class McpEndpointPublisher {

    private final McpTokenService tokens;
    private final LocalServerInfo serverInfo;

    public McpEndpointPublisher(McpTokenService tokens, LocalServerInfo serverInfo) {
        this.tokens = tokens;
        this.serverInfo = serverInfo;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void publish() {
        try {
            tokens.publishEndpoint(serverInfo.baseUrl() + McpController.MCP_PATH);
        } catch (Exception e) {
            log.warn("发布 MCP 端点信息失败: {}", e.getMessage());
        }
    }
}
