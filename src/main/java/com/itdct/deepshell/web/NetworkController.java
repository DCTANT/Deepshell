package com.itdct.deepshell.web;

import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.AuthService;
import com.itdct.deepshell.service.TlsService;
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
import java.util.*;

/**
 * 局域网访问开关：设置存数据目录下的 network.properties，
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

    private final AuthService auth;
    private final TlsService tls;

    public NetworkController(AuthService auth, TlsService tls) {
        this.auth = auth;
        this.tls = tls;
    }

    private Path cfgFile() {
        return DataDir.root().resolve("network.properties");
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
        m.put("authEnabled", auth.isEnabled());
        m.put("defaultPassword", auth.isDefaultPassword());
        m.put("tlsEnabled", tls.isEnabled());
        m.put("tlsMode", tls.getMode());
        m.put("tlsSelfSigned", tls.isSelfSigned());
        m.put("tlsNextEnabled", tls.wouldEnable(saved));
        m.put("localUrl", tls.getScheme() + "://127.0.0.1:" + port);
        m.put("lanUrls", lanUrls());
        return R.ok(m);
    }

    @PostMapping
    public R<Map<String, Object>> update(@RequestBody Map<String, Object> body) throws Exception {
        boolean enable = Boolean.parseBoolean(String.valueOf(body.get("lanEnabled")));
        if (enable) {
            if (!auth.isEnabled()) {
                throw new IllegalArgumentException("开放局域网访问前，请先在 application.yml 中设置 "
                        + "deepshell.auth.enabled: true 并修改默认密码，然后重启应用。");
            }
            if (auth.isDefaultPassword()) {
                throw new IllegalArgumentException("开放局域网访问前，请先修改默认密码 "
                        + "deepshell.auth.password，然后重启应用。");
            }
        }
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
        String nextScheme = tls.wouldEnable(enable) ? "HTTPS" : "HTTP";
        m.put("message", enable == effective
                ? "设置已生效"
                : ("已保存，重启应用后生效" + (enable ? "；局域网访问将使用 " + nextScheme : "")));
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
                        urls.add(tls.getScheme() + "://" + a.getHostAddress() + ":" + port);
                    }
                }
            }
        } catch (Exception ignore) {
        }
        return urls;
    }
}
