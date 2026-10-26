package com.itdct.deepshell.mcp;

/** 工具执行结果：error=true 时作为 MCP 的 isError 内容返回，让模型可以自行修正。 */
public final class McpToolResult {

    private final boolean error;
    private final String text;

    private McpToolResult(boolean error, String text) {
        this.error = error;
        this.text = text == null ? "" : text;
    }

    public static McpToolResult ok(String text) {
        return new McpToolResult(false, text);
    }

    public static McpToolResult error(String text) {
        return new McpToolResult(true, text);
    }

    public boolean isError() {
        return error;
    }

    public String getText() {
        return text;
    }
}
