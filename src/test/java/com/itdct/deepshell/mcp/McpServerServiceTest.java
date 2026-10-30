package com.itdct.deepshell.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.service.AuditService;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class McpServerServiceTest {

    private final ObjectMapper om = new ObjectMapper();

    private McpServerService service() {
        McpTool tool = new McpTool("echo", "回显", "测试工具",
                McpTool.schema(McpTool.props("text", McpTool.stringProp("文本")), "text"));
        McpTools tools = new McpTools() {
            @Override
            public List<McpTool> list() {
                return Collections.singletonList(tool);
            }

            @Override
            public McpToolResult call(String name, JsonNode arguments) {
                if ("boom".equals(name)) {
                    throw new IllegalStateException("模拟失败");
                }
                return McpToolResult.ok("echo:" + arguments.path("text").asText(""));
            }
        };
        return new McpServerService(tools, mock(AuditService.class));
    }

    private JsonNode parse(String json) throws Exception {
        return om.readTree(json);
    }

    @Test
    void initializeEchoesSupportedProtocolAndAdvertisesTools() throws Exception {
        JsonNode response = service().handle(parse("{"
                + "\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\","
                + "\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},"
                + "\"clientInfo\":{\"name\":\"test\",\"version\":\"1\"}}}"));

        assertEquals("2.0", response.path("jsonrpc").asText());
        assertEquals(1, response.path("id").asInt());
        assertEquals("2025-03-26", response.path("result").path("protocolVersion").asText());
        assertEquals("deepshell", response.path("result").path("serverInfo").path("name").asText());
        assertTrue(response.path("result").path("capabilities").path("tools").has("listChanged"));
        assertTrue(response.path("result").path("instructions").asText().contains("list_connections"));
    }

    @Test
    void initializeFallsBackToLatestForUnknownVersion() throws Exception {
        JsonNode response = service().handle(parse("{"
                + "\"jsonrpc\":\"2.0\",\"id\":\"a\",\"method\":\"initialize\","
                + "\"params\":{\"protocolVersion\":\"1999-01-01\"}}"));
        assertEquals("2025-06-18", response.path("result").path("protocolVersion").asText());
    }

    @Test
    void toolsListReturnsSchema() throws Exception {
        JsonNode response = service().handle(parse(
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}"));
        JsonNode tool = response.path("result").path("tools").get(0);
        assertEquals("echo", tool.path("name").asText());
        assertEquals("object", tool.path("inputSchema").path("type").asText());
        assertEquals("text", tool.path("inputSchema").path("required").get(0).asText());
    }

    @Test
    void toolsCallReturnsTextAndAudits() throws Exception {
        AuditService audit = mock(AuditService.class);
        McpTool tool = new McpTool("echo", "回显", "测试",
                McpTool.schema(McpTool.props("text", McpTool.stringProp("文本")), "text"));
        McpTools tools = new McpTools() {
            @Override
            public List<McpTool> list() {
                return Collections.singletonList(tool);
            }

            @Override
            public McpToolResult call(String name, JsonNode arguments) {
                return McpToolResult.ok("echo:" + arguments.path("text").asText(""));
            }
        };
        McpServerService service = new McpServerService(tools, audit);

        JsonNode response = service.handle(parse("{\"jsonrpc\":\"2.0\",\"id\":3,"
                + "\"method\":\"tools/call\",\"params\":{\"name\":\"echo\","
                + "\"arguments\":{\"text\":\"hi\"}}}"));

        assertEquals("echo:hi", response.path("result").path("content").get(0).path("text").asText());
        assertEquals(false, response.path("result").path("isError").asBoolean());
        verify(audit).record(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void toolExceptionBecomesErrorContent() throws Exception {
        McpServerService service = service();
        JsonNode response = service.handle(parse("{\"jsonrpc\":\"2.0\",\"id\":4,"
                + "\"method\":\"tools/call\",\"params\":{\"name\":\"boom\",\"arguments\":{}}}"));
        assertTrue(response.path("result").path("isError").asBoolean());
        assertTrue(response.path("result").path("content").get(0).path("text").asText()
                .contains("模拟失败"));
    }

    @Test
    void unknownMethodReturnsJsonRpcError() throws Exception {
        JsonNode response = service().handle(parse(
                "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"resources/list\"}"));
        assertEquals(-32601, response.path("error").path("code").asInt());
    }

    @Test
    void notificationsHaveNoResponse() throws Exception {
        McpServerService service = service();
        assertNull(service.handle(parse(
                "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}")));
        assertNull(service.handle(parse(
                "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/cancelled\","
                        + "\"params\":{\"requestId\":1}}")));
    }

    @Test
    void batchRequestsReturnArray() throws Exception {
        JsonNode response = service().handle(parse("["
                + "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"},"
                + "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}]"));
        assertNotNull(response);
        assertTrue(response.isArray());
        assertEquals(2, response.size());
    }

    @Test
    void invalidTopLevelReturnsError() {
        JsonNode response = service().handle((JsonNode) null);
        assertEquals(-32600, response.path("error").path("code").asInt());
    }

    @Test
    void stdioArgDetection() {
        assertTrue(McpStdioBridge.hasStdioArg(new String[]{"--mcp-stdio"}));
        assertTrue(McpStdioBridge.hasStdioArg(new String[]{"--deepshell.data-dir=x", "--mcp-stdio"}));
        assertEquals(false, McpStdioBridge.hasStdioArg(new String[]{"--other"}));
        assertEquals(false, McpStdioBridge.hasStdioArg(null));
    }
}
