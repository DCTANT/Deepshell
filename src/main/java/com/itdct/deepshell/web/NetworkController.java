package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

/**
 * 局域网访问开关：设置存 ~/.deepshell/network.properties，
 * 应用启动时读取决定绑定 127.0.0.1（默认）或 0.0.0.0；切换需重启生效。
 */
@Slf4j
@RestController
@RequestMapping("/api/network")
public class NetworkController {

    @Value("${server.port:18080}")
    private int port;

    @Value("${server.address:127.0.0.1}")
    private String boundAddress;

    private Path cfgFile() {
        return Paths.get(System.getProperty("user.home"), ".deepshell", "network.properties");
    }

    private boolean savedLanEnabled() {
        try {
            Path f = cfgFile();
            if (Files.exists(f)) {
                Properties p = new Properties();
                try (InputStream in = Files.newInputStream(f)) {
                    p.load(in);
                }
                return Boolean.parseBoolean(p.getProperty("lan.enabled", "false"));
            }
        } catch (Exception e) {
            log.warn("读取网络配置失败: {}", e.getMessage());
        }
        return false;
    }

    @GetMapping
    public R<Map<String, Object>> info() {
        boolean saved = savedLanEnabled();
        boolean effective = "0.0.0.0".equals(boundAddress);
        Map<String, Object> m = new HashMap<>();
        m.put("lanEnabled", saved);
        m.put("effectiveLan", effective);
        m.put("restartRequired", saved != effective);
        m.put("port", port);
        m.put("boundAddress", boundAddress);
        m.put("localUrl", "http://127.0.0.1:" + port);
        m.put("lanUrls", lanUrls());
        return R.ok(m);
    }

    @PostMapping
    public R<Map<String, Object>> update(@RequestBody Map<String, Object> body) throws Exception {
        boolean enable = Boolean.parseBoolean(String.valueOf(body.get("lanEnabled")));
        Path f = cfgFile();
        Files.createDirectories(f.getParent());
        Properties p = new Properties();
        p.setProperty("lan.enabled", String.valueOf(enable));
        try (OutputStream out = Files.newOutputStream(f)) {
            p.store(out, "DeepShell network settings");
        }
        boolean effective = "0.0.0.0".equals(boundAddress);
        Map<String, Object> m = new HashMap<>();
        m.put("lanEnabled", enable);
        m.put("restartRequired", enable != effective);
        m.put("message", enable == effective ? "设置已生效" : "已保存，重启应用后生效");
        return R.ok(m);
    }

    private List<String> lanUrls() {
        List<String> urls = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            while (nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) {
                    continue;
                }
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) {
                        urls.add("http://" + a.getHostAddress() + ":" + port);
                    }
                }
            }
        } catch (Exception ignore) {
        }
        return urls;
    }
}
