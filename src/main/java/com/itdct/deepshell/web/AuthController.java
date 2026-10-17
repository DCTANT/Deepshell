package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.AuthService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.util.Map;

/**
 * 登录相关接口：状态、登录、退出、Token 有效期设置与心跳续期。
 * 开启登录后，除 status/login/logout 外的接口都由 AuthInterceptor 保护。
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    /** 登录状态与当前 Token 有效期（公开接口，登录页也会调用） */
    @GetMapping("/status")
    public R<Map<String, Object>> status(HttpServletRequest request) {
        AuthService.TokenInfo info = auth.verify(auth.tokenFromRequest(request));
        return R.ok(auth.status(info));
    }

    @PostMapping("/login")
    public ResponseEntity<R<Map<String, Object>>> login(@RequestBody(required = false) Map<String, Object> body,
                                                        HttpServletRequest request,
                                                        HttpServletResponse response) {
        if (!auth.isEnabled()) {
            return ResponseEntity.ok(R.ok(auth.status(null)));
        }
        String user = text(body, "username");
        String pass = text(body, "password");
        if (!auth.matches(user, pass)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(R.err("用户名或密码错误"));
        }
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
