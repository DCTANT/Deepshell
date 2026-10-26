package com.itdct.deepshell.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.common.RuntimeSupport;
import com.itdct.deepshell.config.LocalServerInfo;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.WorkspaceEventService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import java.io.File;
import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * MCP 接入端点：
 * - POST /mcp：MCP Streamable HTTP（JSON-RPC 2.0），使用 MCP Token 鉴权，不接受浏览器 Origin；
 * - GET /api/mcp/status 与 token/regenerate 供管理界面查看、复制配置和轮换 Token。
 */
@RestController
public class McpController {

    public static final String MCP_PATH = "/mcp";

    private final McpServerService server;
    private final McpTokenService tokens;
    private final WorkspaceEventService events;
    private final LocalServerInfo serverInfo;
    private final AuditService audit;
    private final ObjectMapper om = new ObjectMapper();

    public McpController(McpServerService server, McpTokenService tokens,
                         WorkspaceEventService events, LocalServerInfo serverInfo,
                         AuditService audit) {
        this.server = server;
        this.tokens = tokens;
        this.events = events;
        this.serverInfo = serverInfo;
        this.audit = audit;
    }

    @PostMapping(value = MCP_PATH, consumes = MediaType.ALL_VALUE,
            produces = {MediaType.APPLICATION_JSON_VALUE, MediaType.TEXT_EVENT_STREAM_VALUE})
    public ResponseEntity<String> mcp(@RequestBody(required = false) byte[] body,
                                      HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin != null && !origin.trim().isEmpty()) {
            return json(HttpStatus.FORBIDDEN, error(null, -32600,
                    "MCP 接口只接受服务端 / 命令行客户端调用，不接受浏览器跨域请求"));
        }
        if (!tokens.verify(request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .header(HttpHeaders.WWW_AUTHENTICATE, "Bearer realm=\"DeepShell MCP\"")
                    .cacheControl(org.springframework.http.CacheControl.noStore())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(error(null, -32001, "MCP Token 无效或缺失").toString());
        }
        if (body == null || body.length == 0) {
            return json(HttpStatus.BAD_REQUEST, error(null, -32700, "请求体不能为空"));
        }
        JsonNode requestNode;
        try {
            requestNode = om.readTree(body);
        } catch (Exception e) {
            return json(HttpStatus.BAD_REQUEST, error(null, -32700, "JSON 解析失败"));
        }
        JsonNode response;
        try {
            response = server.handle(requestNode);
        } catch (Exception e) {
            response = error(requestNode == null ? null : requestNode.get("id"), -32603,
                    e.getMessage() == null ? "MCP 服务内部错误" : e.getMessage());
        }
        if (response == null) {
            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .cacheControl(org.springframework.http.CacheControl.noStore())
                    .build();
        }
        String accept = request.getHeader(HttpHeaders.ACCEPT);
        boolean sse = accept != null && accept.contains(MediaType.TEXT_EVENT_STREAM_VALUE)
                && !accept.contains(MediaType.APPLICATION_JSON_VALUE);
        if (sse) {
            return ResponseEntity.ok()
                    .cacheControl(org.springframework.http.CacheControl.noStore())
                    .contentType(MediaType.TEXT_EVENT_STREAM)
                    .body("event: message\ndata: " + response.toString() + "\n\n");
        }
        return ResponseEntity.ok()
                .cacheControl(org.springframework.http.CacheControl.noStore())
                .contentType(MediaType.APPLICATION_JSON)
                .body(response.toString());
    }

    /** Streamable HTTP 的 GET 用于服务端主动推送；本服务不提供 SSE 长连接。 */
    @GetMapping(MCP_PATH)
    public ResponseEntity<String> mcpGet() {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .header(HttpHeaders.ALLOW, "POST")
                .contentType(MediaType.APPLICATION_JSON)
                .body(error(null, -32600, "该 MCP 服务只支持 POST；GET SSE 未启用").toString());
    }

    @GetMapping("/api/mcp/status")
    public R<Map<String, Object>> status() {
        String endpoint = serverInfo.baseUrl() + MCP_PATH;
        String token = tokens.token();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("endpoint", endpoint);
        data.put("urlWithToken", endpoint + "?token=" + encodeQuery(token));
        data.put("token", token);
        data.put("configured", tokens.isConfigured());
        data.put("clients", events.clientCount());
        data.put("protocolVersion", server.latestProtocolVersion());
        data.put("serverName", McpServerService.SERVER_NAME);
        data.put("toolCount", server.toolList().size());
        data.put("dataDir", DataDir.root().toString());
        List<Map<String, Object>> tools = new ArrayList<>();
        for (McpTool tool : server.toolList()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("name", tool.getName());
            row.put("title", tool.getTitle());
            row.put("description", tool.getDescription());
            tools.add(row);
        }
        data.put("tools", tools);
        data.put("httpConfig", httpConfig(endpoint, token));
        data.put("stdio", stdioConfig());
        return R.ok(data);
    }

    @PostMapping("/api/mcp/token/regenerate")
    public R<Map<String, Object>> regenerate() {
        tokens.regenerate();
        tokens.publishEndpoint(serverInfo.baseUrl() + MCP_PATH);
        audit.record("MCP_TOKEN", "mcp", "OK", "重新生成 MCP Token");
        return status();
    }

    private Map<String, Object> httpConfig(String endpoint, String token) {
        Map<String, Object> server = new LinkedHashMap<>();
        server.put("url", endpoint);
        Map<String, Object> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + token);
        server.put("headers", headers);
        Map<String, Object> servers = new LinkedHashMap<>();
        servers.put(McpServerService.SERVER_NAME, server);
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("mcpServers", servers);
        return config;
    }

    /**
     * 生成 stdio 启动配置：优先使用绿色版自带的精简 JRE + app/deepshell.jar，
     * 避免 GUI 启动器在 stdio 场景下占用标准输入输出。
     */
    private Map<String, Object> stdioConfig() {
        Map<String, Object> result = new LinkedHashMap<>();
        Path jar = RuntimeSupport.jar();
        String java = null;
        Path appDir = RuntimeSupport.appDir();
        if (appDir != null) {
            File bundled = appDir.resolve("runtime").resolve("bin")
                    .resolve(RuntimeSupport.isWindows() ? "java.exe" : "java").toFile();
            if (bundled.isFile()) {
                java = bundled.getAbsolutePath();
            }
        }
        if (java == null) {
            java = RuntimeSupport.javaExecutable();
            // javaw 没有控制台，stdio 客户端拿不到标准输入输出，必须换成 java.exe
            if (java != null && java.toLowerCase().endsWith("javaw.exe")) {
                File console = new File(java.substring(0, java.length() - "javaw.exe".length()) + "java.exe");
                if (console.isFile()) {
                    java = console.getAbsolutePath();
                }
            }
        }
        boolean available = jar != null && Files.isRegularFile(jar);
        result.put("available", available);
        if (!available) {
            result.put("reason", "当前为源码 / IDE 运行模式，没有可启动的 jar；请使用 HTTP 方式接入，或运行打包后的 DeepShell");
            return result;
        }
        List<String> args = new ArrayList<>();
        args.add("-Dfile.encoding=UTF-8");
        args.add("-jar");
        args.add(jar.toAbsolutePath().toString());
        args.add("--mcp-stdio");
        args.add("--deepshell.data-dir=" + DataDir.root());
        result.put("command", java);
        result.put("args", args);
        Map<String, Object> server = new LinkedHashMap<>();
        server.put("command", java);
        server.put("args", args);
        Map<String, Object> servers = new LinkedHashMap<>();
        servers.put(McpServerService.SERVER_NAME, server);
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("mcpServers", servers);
        result.put("config", config);
        result.put("dataDir", DataDir.root().toString());
        return result;
    }

    private static String encodeQuery(String value) {
        try {
            return URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            return "";
        }
    }

    private static ResponseEntity<String> json(HttpStatus status, ObjectNode body) {        return ResponseEntity.status(status)
                .cacheControl(org.springframework.http.CacheControl.noStore())
                .contentType(MediaType.APPLICATION_JSON)
                .body(body.toString());
    }

    private ObjectNode error(JsonNode id, int code, String message) {
        ObjectNode node = om.createObjectNode();
        node.put("jsonrpc", "2.0");
        if (id == null) {
            node.putNull("id");
        } else {
            node.set("id", id);
        }
        ObjectNode error = node.putObject("error");
        error.put("code", code);
        error.put("message", message == null ? "MCP 服务错误" : message);
        return node;
    }
}
