package com.itdct.deepshell.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.HostKeyCheckException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * MCP（Model Context Protocol）JSON-RPC 2.0 服务端。
 * 目前实现 tools 能力：initialize / ping / tools/list / tools/call；
 * 协议版本兼容 2024-11-05、2025-03-26 与 2025-06-18。
 */
@Slf4j
@Service
public class McpServerService {

    public static final String SERVER_NAME = "deepshell";
    private static final String LATEST_PROTOCOL = "2025-06-18";
    private static final List<String> SUPPORTED_PROTOCOLS =
            Arrays.asList("2024-11-05", "2025-03-26", "2025-06-18");

    private final McpTools tools;
    private final AuditService audit;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${deepshell.version:1.6.2}")
    private String version;

    public McpServerService(McpTools tools, AuditService audit) {
        this.tools = tools;
        this.audit = audit;
    }

    public List<McpTool> toolList() {
        return tools.list();
    }

    public String latestProtocolVersion() {
        return LATEST_PROTOCOL;
    }

    /**
     * 处理一条（或一批）JSON-RPC 消息。
     *
     * @return 需要写回客户端的响应；通知消息或纯通知批次返回 null
     */
    public JsonNode handle(JsonNode request) {
        if (request == null || request.isNull()) {
            return errorResponse(null, -32600, "请求不能为空");
        }
        if (request.isArray()) {
            ArrayNode responses = om.createArrayNode();
            for (JsonNode item : request) {
                JsonNode response = handleSingle(item);
                if (response != null) {
                    responses.add(response);
                }
            }
            return responses.size() == 0 ? null : responses;
        }
        return handleSingle(request);
    }

    private JsonNode handleSingle(JsonNode request) {
        if (request == null || !request.isObject()) {
            return errorResponse(null, -32600, "无效的 JSON-RPC 请求");
        }
        JsonNode idNode = request.get("id");
        boolean notification = idNode == null || idNode.isNull();
        String method = request.path("method").asText("");
        if (method.isEmpty()) {
            return notification ? null : errorResponse(idNode, -32600, "缺少 method");
        }
        if (notification) {
            // 通知没有响应；只处理 MCP 生命周期里常见的通知，避免静默产生副作用
            return null;
        }
        JsonNode params = request.get("params");
        try {
            switch (method) {
                case "initialize":
                    return resultResponse(idNode, initialize(params));
                case "ping":
                    return resultResponse(idNode, om.createObjectNode());
                case "tools/list":
                    return resultResponse(idNode, listTools());
                case "tools/call":
                    return resultResponse(idNode, callTool(params));
                default:
                    return errorResponse(idNode, -32601, "不支持的方法：" + method);
            }
        } catch (IllegalArgumentException e) {
            return errorResponse(idNode, -32602, messageOf(e));
        } catch (Exception e) {
            log.warn("MCP 请求处理失败 method={}: {}", method, e.toString());
            return errorResponse(idNode, -32603, messageOf(e));
        }
    }

    private ObjectNode initialize(JsonNode params) {
        String requested = params == null ? "" : params.path("protocolVersion").asText("");
        String protocol = SUPPORTED_PROTOCOLS.contains(requested) ? requested : LATEST_PROTOCOL;

        ObjectNode result = om.createObjectNode();
        result.put("protocolVersion", protocol);
        ObjectNode capabilities = result.putObject("capabilities");
        ObjectNode toolsCapability = capabilities.putObject("tools");
        toolsCapability.put("listChanged", false);
        ObjectNode serverInfo = result.putObject("serverInfo");
        serverInfo.put("name", SERVER_NAME);
        serverInfo.put("title", "DeepShell");
        serverInfo.put("version", version == null ? "" : version);
        result.put("instructions",
                "DeepShell 是 SSH / SFTP 运维工具，工具调用会真实操作远程服务器。"
                        + "第一次操作前先调用 list_connections 获取 connectionId；"
                        + "执行命令用 run_command，文件操作用 list_files / read_file / write_file / upload_file / download_file。"
                        + "命令会以保存的连接凭据执行，所有操作都会写入审计日志。");
        return result;
    }

    private ObjectNode listTools() {
        ObjectNode result = om.createObjectNode();
        ArrayNode arr = result.putArray("tools");
        for (McpTool tool : tools.list()) {
            ObjectNode node = arr.addObject();
            node.put("name", tool.getName());
            node.put("title", tool.getTitle());
            node.put("description", tool.getDescription());
            node.set("inputSchema", om.valueToTree(tool.getInputSchema()));
        }
        return result;
    }

    private ObjectNode callTool(JsonNode params) throws Exception {
        if (params == null || !params.isObject()) {
            throw new IllegalArgumentException("tools/call 缺少 params");
        }
        String name = params.path("name").asText("").trim();
        if (name.isEmpty()) {
            throw new IllegalArgumentException("tools/call 缺少工具名称");
        }
        JsonNode arguments = params.get("arguments");
        long startedAt = System.nanoTime();
        McpToolResult result;
        try {
            result = tools.call(name, arguments);
            if (result == null) {
                result = McpToolResult.error("工具没有返回结果");
            }
        } catch (Exception e) {
            // 工具执行失败用 isError 返回，让模型能读到原因并自行修正
            String message = messageOf(e);
            if (e instanceof HostKeyCheckException) {
                message += "；请先在 DeepShell 界面中连接该服务器并确认主机指纹，然后再让 AI 重试";
            }
            result = McpToolResult.error(message);
            if (!(e instanceof IllegalArgumentException)) {
                log.warn("MCP 工具调用失败 {}: {}", name, e.toString());
            }
        }
        long cost = Math.max(0, (System.nanoTime() - startedAt) / 1_000_000);
        String summary = summarizeArguments(name, arguments);
        try {
            audit.record("MCP_TOOL", name,
                    result.isError() ? "FAIL" : "OK",
                    cost + "ms" + (summary.isEmpty() ? "" : " | " + summary));
        } catch (Exception ignore) {
            // 审计失败不影响工具调用
        }
        ObjectNode out = om.createObjectNode();
        ArrayNode content = out.putArray("content");
        ObjectNode text = content.addObject();
        text.put("type", "text");
        text.put("text", result.getText());
        out.put("isError", result.isError());
        return out;
    }

    /** 审计里只保留少量关键参数，避免把整段文件内容写进审计表。 */
    private String summarizeArguments(String tool, JsonNode args) {
        if (args == null || args.isNull()) {
            return "";
        }
        Map<String, String> picked = new LinkedHashMap<>();
        String[] keys = {"connectionId", "connection", "sessionId", "command", "cwd",
                "path", "remotePath", "localPath", "keyword", "limit", "timeoutSeconds", "view"};
        for (String key : keys) {
            JsonNode n = args.get(key);
            if (n == null || n.isNull()) {
                continue;
            }
            String value = n.isTextual() ? n.asText() : n.toString();
            if (value.length() > 300) {
                value = value.substring(0, 300) + "…";
            }
            picked.put(key, value);
        }
        if (picked.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : picked.entrySet()) {
            if (sb.length() > 0) {
                sb.append(", ");
            }
            sb.append(e.getKey()).append('=').append(e.getValue().replaceAll("\\s+", " "));
        }
        return sb.toString();
    }

    private ObjectNode resultResponse(JsonNode id, JsonNode result) {
        ObjectNode node = om.createObjectNode();
        node.put("jsonrpc", "2.0");
        node.set("id", id);
        node.set("result", result);
        return node;
    }

    private ObjectNode errorResponse(JsonNode id, int code, String message) {
        ObjectNode node = om.createObjectNode();
        node.put("jsonrpc", "2.0");
        node.set("id", id);
        ObjectNode error = node.putObject("error");
        error.put("code", code);
        error.put("message", message);
        return node;
    }

    private static String messageOf(Exception e) {
        String message = e.getMessage();
        if (message == null || message.trim().isEmpty()) {
            message = e.getClass().getSimpleName();
        }
        return message;
    }
}
