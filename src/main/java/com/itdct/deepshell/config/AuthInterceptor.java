package com.itdct.deepshell.config;

import com.itdct.deepshell.service.AuthService;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.net.URLEncoder;

/**
 * 页面与 REST API 的登录校验：未登录页面跳转 /login，API 返回 401；
 * 已登录且 Token 剩余不足一半时自动续签（滑动过期）。
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    private final AuthService auth;

    public AuthInterceptor(AuthService auth) {
        this.auth = auth;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if (!auth.isEnabled()) {
            return true;
        }
        String token = auth.tokenFromRequest(request);
        AuthService.TokenInfo info = auth.verify(token);
        if (info == null) {
            if (isApiRequest(request)) {
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                response.setCharacterEncoding("UTF-8");
                response.setContentType("application/json;charset=UTF-8");
                response.getWriter().write("{\"code\":401,\"msg\":\"登录已过期，请重新登录\"}");
            } else {
                String target = request.getRequestURI();
                String query = request.getQueryString();
                if (query != null && !query.isEmpty()) {
                    target += "?" + query;
                }
                response.sendRedirect("/login?redirect=" + URLEncoder.encode(target, "UTF-8"));
            }
            return false;
        }
        if (auth.shouldRenew(info)) {
            response.addHeader(HttpHeaders.SET_COOKIE, auth.buildCookie(auth.issueToken(), request).toString());
        }
        return true;
    }

    private static boolean isApiRequest(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return uri != null && (uri.startsWith("/api/") || uri.startsWith("/ws/"));
    }
}
