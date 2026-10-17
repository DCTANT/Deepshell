package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.AuthService;
import com.itdct.deepshell.service.CaptchaService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 登录相关接口：状态、登录、验证码、退出、Token 有效期设置与心跳续期。
 * 开启登录后，除 status/login/captcha/logout 外的接口都由 AuthInterceptor 保护。
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final CaptchaService captcha;

    public AuthController(AuthService auth, CaptchaService captcha) {
        this.auth = auth;
        this.captcha = captcha;
    }

    /** 登录状态与当前 Token 有效期（公开接口，登录页也会调用） */
    @GetMapping("/status")
    public R<Map<String, Object>> status(HttpServletRequest request) {
        AuthService.TokenInfo info = auth.verify(auth.tokenFromRequest(request));
        Map<String, Object> data = auth.status(info);
        data.put("captchaRequired", auth.isEnabled() && captcha.isCaptchaRequired(clientIp(request)));
        return R.ok(data);
    }

    /** 登录验证码（公开接口）：按当前 IP 判定，同一 IP 失败 2 次后登录必须携带验证码 */
    @GetMapping("/captcha")
    public ResponseEntity<R<Map<String, Object>>> captcha() {
        CaptchaService.Challenge challenge = captcha.challenge();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("captchaId", challenge.captchaId);
        data.put("imageBase64", challenge.imageBase64);
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store, no-cache, must-revalidate")
                .header("Pragma", "no-cache")
                .body(R.ok(data));
    }

    @PostMapping("/login")
    public ResponseEntity<R<Map<String, Object>>> login(@RequestBody(required = false) Map<String, Object> body,
                                                        HttpServletRequest request,
                                                        HttpServletResponse response) {
        if (!auth.isEnabled()) {
            return ResponseEntity.ok(R.ok(auth.status(null)));
        }
        String ip = clientIp(request);

        // 同一 IP 连续失败达到阈值后，先校验验证码再核对账号密码，验证码不通过不会消耗密码尝试
        if (captcha.isCaptchaRequired(ip)) {
            CaptchaService.VerifyResult result = captcha.verify(
                    text(body, "captchaId"), text(body, "captchaCode"));
            if (result == CaptchaService.VerifyResult.MISSING) {
                return loginFailure("请输入验证码", true);
            }
            if (result == CaptchaService.VerifyResult.INVALID) {
                return loginFailure("验证码错误，请重新输入", true);
            }
        }

        String user = text(body, "username");
        String pass = text(body, "password");
        if (!auth.matches(user, pass)) {
            captcha.recordFailure(ip);
            boolean captchaRequired = captcha.isCaptchaRequired(ip);
            return loginFailure(captchaRequired ? "用户名或密码错误，请输入验证码后重试" : "用户名或密码错误",
                    captchaRequired);
        }
        captcha.resetFailures(ip);
        String token = auth.issueToken();
        response.addHeader(HttpHeaders.SET_COOKIE, auth.buildCookie(token, request).toString());
        return ResponseEntity.ok(R.ok(auth.status(auth.verify(token))));
    }

    /** 退出登录：清除 Cookie（即使 Token 已过期也允许调用） */
    @PostMapping("/logout")
    public R<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, auth.clearCookie(request).toString());
        return R.ok();
    }

    @GetMapping("/settings")
    public R<Map<String, Object>> settings(HttpServletRequest request) {
        AuthService.TokenInfo info = auth.verify(auth.tokenFromRequest(request));
        return R.ok(auth.status(info));
    }

    /** 修改 Token 有效期，并立即按新有效期重新签发 Token */
    @PutMapping("/settings")
    public ResponseEntity<R<Map<String, Object>>> updateSettings(
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request, HttpServletResponse response) {
        if (!auth.isEnabled()) {
            return ResponseEntity.ok(R.ok(auth.status(null)));
        }
        Integer hours = parseInt(body == null ? null : body.get("tokenExpireHours"));
        if (hours == null || hours < AuthService.MIN_EXPIRE_HOURS
                || hours > AuthService.MAX_EXPIRE_HOURS) {
            return ResponseEntity.badRequest().body(R.err(
                    "Token 有效期需在 " + AuthService.MIN_EXPIRE_HOURS + " - "
                            + AuthService.MAX_EXPIRE_HOURS + " 小时之间"));
        }
        auth.updateExpireHours(hours);
        String token = auth.issueToken();
        response.addHeader(HttpHeaders.SET_COOKIE, auth.buildCookie(token, request).toString());
        return ResponseEntity.ok(R.ok(auth.status(auth.verify(token))));
    }

    /** 前端定时心跳：持续使用时刷新 Token，实现滑动过期 */
    @PostMapping("/ping")
    public R<Map<String, Object>> ping(HttpServletRequest request, HttpServletResponse response) {
        if (!auth.isEnabled()) {
            return R.ok(auth.status(null));
        }
        AuthService.TokenInfo current = auth.verify(auth.tokenFromRequest(request));
        if (current == null) {
            throw new IllegalStateException("登录已过期，请重新登录");
        }
        String token = auth.issueToken();
        response.addHeader(HttpHeaders.SET_COOKIE, auth.buildCookie(token, request).toString());
        return R.ok(auth.status(auth.verify(token)));
    }

    private static ResponseEntity<R<Map<String, Object>>> loginFailure(String message,
                                                                       boolean captchaRequired) {
        R<Map<String, Object>> body = R.err(message);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("captchaRequired", captchaRequired);
        body.setData(data);
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(body);
    }

    /**
     * 当前登录 IP：使用 TCP 对端地址，不信任 X-Forwarded-For，
     * 避免通过伪造请求头绕过验证码阈值。IPv6 回环地址归一化为 127.0.0.1。
     */
    private static String clientIp(HttpServletRequest request) {
        String ip = request.getRemoteAddr();
        if (ip == null || ip.isEmpty()) {
            return "unknown";
        }
        if ("0:0:0:0:0:0:0:1".equals(ip) || "::1".equals(ip)) {
            return "127.0.0.1";
        }
        if (ip.startsWith("::ffff:")) {
            return ip.substring(7);
        }
        return ip;
    }

    private static String text(Map<String, Object> body, String key) {
        Object value = body == null ? null : body.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private static Integer parseInt(Object value) {
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        if (value != null) {
            try {
                return Integer.parseInt(String.valueOf(value).trim());
            } catch (NumberFormatException ignore) {
                return null;
            }
        }
        return null;
    }
}
