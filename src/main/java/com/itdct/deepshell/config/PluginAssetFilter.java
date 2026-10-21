package com.itdct.deepshell.config;

import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * 插件资源允许沙箱 iframe 跨源读取自身文件（fetch JSON / 模块等），
 * 同时关闭 MIME 嗅探；插件页面本身仍由 iframe sandbox 隔离，不能访问父页面。
 */
@Component
public class PluginAssetFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String uri = request.getRequestURI();
        if (uri != null && uri.startsWith("/plugin-assets/")) {
            response.setHeader("Access-Control-Allow-Origin", "*");
            response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
            response.setHeader("X-Content-Type-Options", "nosniff");
            if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
                response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
                response.setHeader("Access-Control-Allow-Headers", "*");
                response.setStatus(HttpServletResponse.SC_NO_CONTENT);
                return;
            }
        }
        filterChain.doFilter(request, response);
    }
}
