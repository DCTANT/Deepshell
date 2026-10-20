package com.itdct.deepshell.config;

import com.itdct.deepshell.service.TlsService;
import org.springframework.boot.web.server.Ssl;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.servlet.server.ConfigurableServletWebServerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 把 TlsService 生成/配置的证书挂到内嵌 Tomcat 上；未启用 TLS 时保持原 HTTP 行为 */
@Configuration
public class TlsConfig {

    @Bean
    public WebServerFactoryCustomizer<ConfigurableServletWebServerFactory> tlsCustomizer(TlsService tls) {
        return factory -> {
            if (!tls.isEnabled()) {
                return;
            }
            Ssl ssl = new Ssl();
            ssl.setEnabled(true);
            ssl.setKeyStore(tls.getKeystorePath());
            ssl.setKeyStorePassword(tls.getKeystorePassword());
            ssl.setKeyStoreType(tls.getKeystoreType());
            ssl.setKeyAlias(tls.getKeyAlias());
            ssl.setKeyPassword(tls.getKeyPassword());
            factory.setSsl(ssl);
        };
    }
}
