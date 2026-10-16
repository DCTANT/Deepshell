package com.itdct.deepshell.config;

import org.apache.catalina.connector.Connector;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.stereotype.Component;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;

/**
 * 回环双栈监听：默认本机模式只绑定 IPv4 回环 127.0.0.1，而系统解析 localhost 时优先返回
 * IPv6 回环 ::1，浏览器等客户端会先连 ::1，于是出现「127.0.0.1 能访问、localhost 打不开」。
 * 这里在绑定 IPv4（127.0.0.1 或局域网 0.0.0.0）时追加一个同端口的 [::1] 监听，
 * 保证两种访问方式都可用；环境不支持 IPv6 回环时自动跳过，不影响启动。
 */
@Component
public class LoopbackDualStackConfig implements WebServerFactoryCustomizer<TomcatServletWebServerFactory> {

    @Value("${server.address:127.0.0.1}")
    private String bindAddress;

    @Value("${server.port:18080}")
    private int bindPort;

    @Override
    public void customize(TomcatServletWebServerFactory factory) {
        InetAddress address = factory.getAddress();
        if (address == null) {
            try {
                address = InetAddress.getByName(bindAddress);
            } catch (Exception ignore) {
                return;
            }
        }
        int port = factory.getPort() > 0 ? factory.getPort() : bindPort;
        // 仅覆盖绑定 IPv4 的两种模式（本机 127.0.0.1 / 局域网 0.0.0.0）；随机端口（0）不做处理
        boolean ipv4Mode = address instanceof Inet4Address
                && (address.isLoopbackAddress() || address.isAnyLocalAddress());
        if (!ipv4Mode || port <= 0) {
            return;
        }
        if (!ipv6LoopbackUsable()) {
            return;
        }
        Connector ipv6 = new Connector(TomcatServletWebServerFactory.DEFAULT_PROTOCOL);
        ipv6.setPort(port);
        // 精确绑定 ::1（而非 :: 通配），与 IPv4 监听互不冲突，且不额外扩大监听范围
        ipv6.setProperty("address", "::1");
        factory.addAdditionalTomcatConnectors(ipv6);
    }

    /** 探测环境是否支持绑定 IPv6 回环，避免无 IPv6 的环境启动失败 */
    private boolean ipv6LoopbackUsable() {
        try (ServerSocket probe = new ServerSocket()) {
            probe.bind(new InetSocketAddress(InetAddress.getByName("::1"), 0));
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
