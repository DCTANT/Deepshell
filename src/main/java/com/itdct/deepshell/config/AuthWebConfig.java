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
    private final OriginGuardInterceptor originGuardInterceptor;

    public AuthWebConfig(AuthInterceptor authInterceptor,
                         OriginGuardInterceptor originGuardInterceptor) {
        this.authInterceptor = authInterceptor;
        this.originGuardInterceptor = originGuardInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 先做跨站校验（与是否开启登录无关），再校验登录态
        registry.addInterceptor(originGuardInterceptor)
                .addPathPatterns("/**")
                .excludePathPatterns("/ws/**", "/plugin-assets/**", "/css/**", "/js/**",
                        "/vendor/**", "/img/**");
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/**")
                .excludePathPatterns(
                        "/login",
                        "/api/auth/login",
                        "/api/auth/captcha",
                        "/api/auth/status",
                        "/api/auth/logout",
                        // 本机启动器转发外部调用；接口内部校验回环地址 + 数据目录握手密钥
                        "/api/protocol/ping",
                        "/api/protocol/handoff",
                        // JumpServer / 门户 HTTP 接口：接口内部校验集成 Token
                        "/api/integration/connections/open",
                        "/css/**",
                        "/js/**",
                        "/vendor/**",
                        "/img/**",
                        "/plugin-assets/**",
                        "/favicon.ico",
                        "/error");
    }
}
