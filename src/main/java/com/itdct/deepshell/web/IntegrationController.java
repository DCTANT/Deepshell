package com.itdct.deepshell.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.config.LocalServerInfo;
import com.itdct.deepshell.dto.IntegrationOpenReq;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.IntegrationService;
import com.itdct.deepshell.service.IntegrationTokenService;
import com.itdct.deepshell.service.TlsService;
import com.itdct.deepshell.service.WorkspaceEventService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * JumpServer / 运维门户 HTTP 集成接口。
 * - POST /connections/open 使用集成 Token 鉴权，新增/更新连接并通知在线页面打开标签；
 * - /status 与 /token/regenerate 由正常登录保护，只在 DeepShell 管理界面使用。
 * 接口面向服务端调用，不接受带 Origin 的浏览器跨域请求。
 */
@RestController
@RequestMapping("/api/integration")
public class IntegrationController {

    public static final String OPEN_PATH = "/api/integration/connections/open";

    private final IntegrationTokenService tokens;
    private final IntegrationService integration;
    private final WorkspaceEventService events;
    private final TlsService tls;
    private final LocalServerInfo serverInfo;
    private final AuditService audit;
    private final ObjectMapper om = new ObjectMapper();

    public IntegrationController(IntegrationTokenService tokens, IntegrationService integration,
                                 WorkspaceEventService events, TlsService tls,
                                 LocalServerInfo serverInfo, AuditService audit) {
        this.tokens = tokens;
        this.integration = integration;
        this.events = events;
        this.tls = tls;
        this.serverInfo = serverInfo;
        this.audit = audit;
    }

    @PostMapping("/connections/open")
    public ResponseEntity<R<IntegrationService.Result>> open(
            @RequestBody(required = false) byte[] body, HttpServletRequest request) {
        // 先鉴权再解析 JSON，避免未授权请求通过解析错误探测字段
        String origin = request.getHeader("Origin");
        if (origin != null && !origin.trim().isEmpty()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(R.<IntegrationService.Result>err("该接口仅支持服务端调用，不接受浏览器 Origin"));
        }
        if (!tokens.verify(request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(R.<IntegrationService.Result>err("集成接口 Token 无效"));
        }
        if (body == null || body.length == 0) {
            return ResponseEntity.badRequest()
                    .body(R.<IntegrationService.Result>err("请求 JSON 不能为空"));
        }
        IntegrationOpenReq req;
        try {
            req = om.readValue(body, IntegrationOpenReq.class);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(R.<IntegrationService.Result>err("请求 JSON 格式错误（请使用 UTF-8 编码）"));
        }
        try {
            IntegrationService.Result result = integration.open(req, request.getRemoteAddr());
            return ResponseEntity.ok(R.ok(result));
        } catch (Exception e) {
            String message = e.getMessage() == null ? "集成接口处理失败" : e.getMessage();
            return ResponseEntity.badRequest().body(R.<IntegrationService.Result>err(message));
        }
    }

    @GetMapping("/status")
    public R<Map<String, Object>> status() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("endpoint", OPEN_PATH);
        data.put("token", tokens.token());
        data.put("configured", tokens.isConfigured());
        data.put("clients", events.clientCount());
        data.put("scheme", tls.getScheme());
        data.put("port", serverInfo.port());
        return R.ok(data);
    }

    @PostMapping("/token/regenerate")
    public R<Map<String, Object>> regenerate() {
        tokens.regenerate();
        audit.record("INTEGRATION_TOKEN", "integrations", "OK",
                "重新生成 HTTP 集成接口 Token");
        return status();
    }
}
