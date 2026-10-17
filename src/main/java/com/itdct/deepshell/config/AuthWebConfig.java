package com.itdct.deepshell.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 注册登录拦截器：登录页、登录/状态/退出接口与静态资源不拦截，
 * 其余页面与 API 在开启登录后都需要有效 Token。
 */
@Configuration
public class AuthWebConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;

    public AuthWebConfig(AuthInterceptor authInterceptor) {
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/**")
                .excludePathPatterns(
                        "/login",
                        "/api/auth/login",
                        "/api/auth/status",
                        "/api/auth/logout",
                        "/css/**",
                        "/js/**",
                        "/vendor/**",
                        "/favicon.ico",
                        "/error");
    }
}
