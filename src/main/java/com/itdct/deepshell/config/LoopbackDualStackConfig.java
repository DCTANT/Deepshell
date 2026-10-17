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
 * 这里在本机回环模式下追加一个同端口的 [::1] 监听，保证两种访问方式都可用；
 * 局域网模式（0.0.0.0）下不追加：Windows 上 ::1 先绑定会占住同端口的 IPv4 通配地址，
 * 导致 Spring Boot 随后绑定 0.0.0.0 失败（换任何端口都会报“已占用”）。
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
        if (port <= 0 || !(address instanceof Inet4Address)) {
            return;
        }
        // 局域网模式只保留 IPv4 通配监听；本机访问请用 127.0.0.1（自动打开的地址也已改为它）
        if (address.isAnyLocalAddress() || !address.isLoopbackAddress()) {
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
