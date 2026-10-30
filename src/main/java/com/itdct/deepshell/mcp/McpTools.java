package com.itdct.deepshell.mcp;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

/** MCP 工具目录。实现类负责具体 SSH / SFTP / 监控能力。 */
public interface McpTools {

    List<McpTool> list();

    McpToolResult call(String name, JsonNode arguments) throws Exception;
}
