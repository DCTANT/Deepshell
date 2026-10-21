package com.itdct.deepshell.config;

import com.itdct.deepshell.common.DataDir;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 插件静态资源：/plugin-assets/{pluginId}/... 直接映射到数据目录 plugins/。
 * 插件运行在沙箱 iframe 中，资源请求不带登录 Token，因此该路径在认证拦截器中放行。
 */
@Configuration
public class PluginAssetConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        Path root = DataDir.root().resolve("plugins");
        try {
            Files.createDirectories(root);
        } catch (Exception e) {
            throw new IllegalStateException("创建插件目录失败: " + e.getMessage(), e);
        }
        registry.addResourceHandler("/plugin-assets/**")
                .addResourceLocations(root.toUri().toString())
                .setCacheControl(CacheControl.noCache());
    }
}
