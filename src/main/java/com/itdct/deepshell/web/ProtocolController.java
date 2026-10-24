package com.itdct.deepshell.web;

import com.itdct.deepshell.common.LocalRequest;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.protocol.ProtocolClient;
import com.itdct.deepshell.protocol.ProtocolFiles;
import com.itdct.deepshell.protocol.ProtocolRegistrar;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.ProtocolLaunchService;
import com.itdct.deepshell.service.ProtocolOpenService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.lang.management.ManagementFactory;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 外部调用接口。
 * ping / handoff 由本机启动器调用，不使用登录 Cookie，因此只接受回环地址 + 数据目录握手密钥，
 * 并拒绝带 Origin 的浏览器请求；status / register 仍走正常登录保护。
 */
@RestController
@RequestMapping("/api/protocol")
public class ProtocolController {

    private final ProtocolLaunchService launchService;
    private final ProtocolRegistrar registrar;
    private final AuditService audit;

    public ProtocolController(ProtocolLaunchService launchService, ProtocolRegistrar registrar,
                              AuditService audit) {
        this.launchService = launchService;
        this.registrar = registrar;
        this.audit = audit;
    }

    @GetMapping("/ping")
    public ResponseEntity<R<Map<String, Object>>> ping(HttpServletRequest request) {
        String denied = rejectReason(request);
        if (denied != null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(R.<Map<String, Object>>err(denied));
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("name", "DeepShell");
        data.put("pid", ProtocolFiles.currentPid());
        data.put("startedAt", ManagementFactory.getRuntimeMXBean().getStartTime());
        return ResponseEntity.ok(R.ok(data));
    }

    @PostMapping("/handoff")
    public ResponseEntity<R<ProtocolOpenService.Result>> handoff(
            @RequestParam("uri") String uri, HttpServletRequest request) {
        String denied = rejectReason(request);
        if (denied != null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(R.<ProtocolOpenService.Result>err(denied));
        }
        if (uri == null || uri.trim().isEmpty()) {
            return ResponseEntity.ok(R.<ProtocolOpenService.Result>err("外部调用链接为空"));
        }
        try {
            ProtocolOpenService.Result result = launchService.openFromProtocol(
                    uri, String.valueOf(request.getRemoteAddr()));
            return ResponseEntity.ok(R.ok(result));
        } catch (Exception e) {
            return ResponseEntity.ok(R.<ProtocolOpenService.Result>err(
                    e.getMessage() == null ? "外部调用处理失败" : e.getMessage()));
        }
    }

    @GetMapping("/status")
    public R<Map<String, Object>> status() {
        return R.ok(registrar.status());
    }

    @PostMapping("/register")
    public R<Map<String, Object>> register(HttpServletRequest request) {
        // 会写本机注册表 / xdg 桌面文件，只允许本机操作
        LocalRequest.requireLocal(request, "注册 deepshell:// 协议");
        Map<String, Object> status = registrar.register();
        audit.record("PROTOCOL_REGISTER", String.valueOf(status.get("scheme")), "OK",
                String.valueOf(status.get("detail")));
        return R.ok(status);
    }

    /** 回环校验 + 密钥校验；通过返回 null，否则返回拒绝原因。 */
    private String rejectReason(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin != null && !origin.trim().isEmpty()) {
            return "外部调用接口不接受浏览器跨域请求";
        }
        if (!isLoopback(request.getRemoteAddr())) {
            return "外部调用仅允许本机访问";
        }
        String expected = ProtocolFiles.readSecret();
        String actual = request.getHeader(ProtocolClient.HEADER_SECRET);
        if (expected == null || actual == null || !constantTimeEquals(expected, actual)) {
            return "外部调用密钥无效，请从本机重新启动 DeepShell 后再试";
        }
        return null;
    }

    private static boolean constantTimeEquals(String expected, String actual) {
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                actual.getBytes(StandardCharsets.UTF_8));
    }

    private static boolean isLoopback(String address) {
        if (address == null || address.trim().isEmpty()) {
            return false;
        }
        try {
            return InetAddress.getByName(address).isLoopbackAddress();
        } catch (Exception e) {
            return false;
        }
    }
}
