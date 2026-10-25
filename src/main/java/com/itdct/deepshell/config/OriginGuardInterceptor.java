package com.itdct.deepshell.config;

import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.net.URI;
import java.util.Locale;

/**
 * 状态变更请求的跨站防护：浏览器发起的 POST/PUT/PATCH/DELETE 必须与当前站点同源，
 * 避免任意网页在未开启登录（或已登录）时借用户的浏览器调用本机接口。
 *
 * <p>无 Origin / Sec-Fetch-Site 的请求来自 curl、启动器、JumpServer 等非浏览器客户端，保持放行；
 * 这些客户端的鉴权由各自接口的 Token / 回环校验负责。</p>
 */
@Component
public class OriginGuardInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        String method = request.getMethod();
        if ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)
                || "OPTIONS".equalsIgnoreCase(method)) {
            return true;
        }
        String fetchSite = request.getHeader("Sec-Fetch-Site");
        if (fetchSite != null && !fetchSite.trim().isEmpty()) {
            String site = fetchSite.trim().toLowerCase(Locale.ROOT);
            if (!"same-origin".equals(site) && !"none".equals(site)) {
                return reject(response, "拒绝跨站请求");
            }
        }
        String origin = request.getHeader(HttpHeaders.ORIGIN);
        if (origin == null || origin.trim().isEmpty()) {
            return true;
        }
        if ("null".equalsIgnoreCase(origin.trim()) || !isSameOrigin(request, origin.trim())) {
            return reject(response, "拒绝跨站请求");
        }
        return true;
    }

    private static boolean isSameOrigin(HttpServletRequest request, String origin) {
        try {
            URI originUri = URI.create(origin);
            String scheme = originUri.getScheme() == null
                    ? "" : originUri.getScheme().toLowerCase(Locale.ROOT);
            if (!"http".equals(scheme) && !"https".equals(scheme)) {
                return false;
            }
            String originHost = normalizeHost(originUri.getHost());
            if (originHost == null) {
                return false;
            }
            int originPort = originUri.getPort() < 0
                    ? ("https".equals(scheme) ? 443 : 80) : originUri.getPort();
            int defaultPort = "https".equals(scheme) ? 443 : 80;
            // 反向代理可能重写 Host，此时允许用代理透传的原始 Host 比对
            if (hostMatches(request.getHeader(HttpHeaders.HOST), originHost, originPort, defaultPort)) {
                return true;
            }
            String forwarded = request.getHeader("X-Forwarded-Host");
            if (forwarded != null && !forwarded.trim().isEmpty()) {
                String first = forwarded.split(",")[0].trim();
                return hostMatches(first, originHost, originPort, defaultPort);
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean hostMatches(String hostHeader, String originHost, int originPort,
                                       int defaultPort) {
        if (hostHeader == null || hostHeader.trim().isEmpty()) {
            return false;
        }
        URI hostUri = URI.create("http://" + hostHeader.trim());
        String requestHost = normalizeHost(hostUri.getHost());
        int requestPort = hostUri.getPort() < 0 ? defaultPort : hostUri.getPort();
        return requestHost != null && originHost.equalsIgnoreCase(requestHost)
                && originPort == requestPort;
    }

    private static String normalizeHost(String host) {
        if (host == null) {
            return null;
        }
        String value = host.trim();
        if (value.startsWith("[") && value.endsWith("]")) {
            value = value.substring(1, value.length() - 1);
        }
        return value.isEmpty() ? null : value;
    }

    private static boolean reject(HttpServletResponse response, String message) throws Exception {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setCharacterEncoding("UTF-8");
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":403,\"msg\":\"" + message + "\"}");
        return false;
    }
}
