package com.itdct.deepshell.protocol;

import com.itdct.deepshell.config.LocalServerInfo;
import com.itdct.deepshell.service.ProtocolLaunchService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * 服务就绪后：
 * 1. 写入本实例地址（供后续 deepshell:// 调用转发）；
 * 2. 异步刷新 URL 协议注册；
 * 3. 如果是通过外部调用冷启动的，打开链接对应的连接 / 错误提示页。
 *
 * 必须早于 BrowserLauncher 执行，后者检测到 pending 时不会再打开首页。
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ProtocolBootstrap implements ApplicationListener<ApplicationReadyEvent> {

    private final LocalServerInfo serverInfo;
    private final ProtocolRegistrar registrar;
    private final ProtocolLaunchService launchService;

    public ProtocolBootstrap(LocalServerInfo serverInfo, ProtocolRegistrar registrar,
                             ProtocolLaunchService launchService) {
        this.serverInfo = serverInfo;
        this.registrar = registrar;
        this.launchService = launchService;
    }

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        try {
            ProtocolFiles.ensureSecret();
        } catch (Exception e) {
            ProtocolFiles.log("生成协议握手密钥失败: " + e.getMessage());
            log.warn("生成协议握手密钥失败: {}", e.getMessage());
        }
        ProtocolFiles.writeRuntime(serverInfo.baseUrl(), serverInfo.port());
        registrar.registerAsync();

        String uri = ProtocolLaunchSupport.pendingUri();
        if (uri == null) {
            return;
        }
        try {
            launchService.openFromProtocol(uri, "127.0.0.1");
        } catch (Exception e) {
            // 错误提示页已经由 ProtocolLaunchService 打开，这里只记录
            log.warn("冷启动外部调用失败: {}", e.getMessage());
        }
    }
}
