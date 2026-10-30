package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.GatewaySettingsService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 执行网关（服务端角色）：
 * - /settings 与 /token/regenerate 由登录态保护，供本机界面配置；
 * - /info 使用网关 Token 鉴权，供其他 DeepShell 实例探测能力。
 */
@RestController
@RequestMapping("/api/gateway")
public class GatewayController {

    private final GatewaySettingsService settings;
    private final AuditService audit;

    @Value("${deepshell.version:1.8.0}")
    private String configuredVersion;

    public GatewayController(GatewaySettingsService settings, AuditService audit) {
        this.settings = settings;
        this.audit = audit;
    }

    @GetMapping("/settings")
    public R<Map<String, Object>> settings() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", settings.isEnabled());
        m.put("allowlist", settings.allowlist());
        m.put("maxConnections", settings.maxConnections());
        m.put("activeTunnels", settings.activeTunnels());
        m.put("token", settings.token());
        m.put("tokenConfigured", settings.isConfiguredToken());
        m.put("version", version());
        return R.ok(m);
    }

    @PutMapping("/settings")
    public R<Map<String, Object>> save(@RequestBody Map<String, Object> body) {
        if (body.containsKey("enabled")) {
            settings.setEnabled(Boolean.parseBoolean(String.valueOf(body.get("enabled"))));
        }
        if (body.containsKey("allowlist")) {
            settings.setAllowlist(parseAllowlist(body.get("allowlist")));
        }
        if (body.containsKey("maxConnections")) {
            try {
                settings.setMaxConnections(Integer.parseInt(String.valueOf(body.get("maxConnections"))));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("并发上限需为数字");
            }
        }
        audit.record("GATEWAY_SETTINGS", "执行网关", "OK",
                "启用=" + settings.isEnabled() + "，白名单 " + settings.allowlist().size() + " 条");
        return settings();
    }

    @PostMapping("/token/regenerate")
    public R<Map<String, Object>> regenerate() {
        String token = settings.regenerateToken();
        audit.record("GATEWAY_TOKEN", "执行网关", "OK", "重新生成 Token");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("token", token);
        return R.ok(m);
    }

    /**
     * 供其他 DeepShell 实例调用；接口内部校验网关注入 Token，不接受浏览器 Origin。
     */
    @GetMapping("/info")
    public ResponseEntity<R<Map<String, Object>>> info(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin != null && !origin.trim().isEmpty()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(R.<Map<String, Object>>err("该接口仅支持服务端调用，不接受浏览器 Origin"));
        }
        if (!settings.verifyToken(suppliedToken(request))) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .header(HttpHeaders.WWW_AUTHENTICATE, "Bearer realm=\"DeepShell Gateway\"")
                    .body(R.<Map<String, Object>>err("网关 Token 无效"));
        }
        if (!settings.isEnabled()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(R.<Map<String, Object>>err("对方 DeepShell 未启用执行网关"));
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", true);
        m.put("version", version());
        m.put("maxConnections", settings.maxConnections());
        m.put("activeTunnels", settings.activeTunnels());
        m.put("allowlistCount", settings.allowlist().size());
        List<String> caps = new ArrayList<>();
        caps.add("tcp-tunnel");
        m.put("capabilities", caps);
        return ResponseEntity.ok(R.ok(m));
    }

    private static String suppliedToken(HttpServletRequest request) {
        String supplied = request.getHeader(GatewaySettingsService.HEADER);
        if (supplied != null && !supplied.trim().isEmpty()) {
            return supplied.trim();
        }
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return authorization.substring(7).trim();
        }
        return null;
    }

    private static List<String> parseAllowlist(Object raw) {
        List<String> out = new ArrayList<>();
        if (raw instanceof List) {
            for (Object o : (List<?>) raw) {
                addEntries(out, String.valueOf(o));
            }
        } else if (raw != null) {
            addEntries(out, String.valueOf(raw));
        }
        return out;
    }

    private static void addEntries(List<String> out, String raw) {
        for (String line : raw.split("[,\\r\\n]+")) {
            String v = line == null ? "" : line.trim();
            if (!v.isEmpty() && !out.contains(v)) {
                out.add(v);
            }
        }
    }

    private String version() {
        String v = GatewayController.class.getPackage().getImplementationVersion();
        return v == null ? configuredVersion : v;
    }
}
