package com.itdct.deepshell.web;

import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.common.RuntimeSupport;
import com.itdct.deepshell.protocol.ProtocolRegistrar;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.File;
import java.lang.management.ManagementFactory;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/app-info")
public class AppInfoController {

    private final ProtocolRegistrar protocolRegistrar;

    @Value("${deepshell.version:1.4.0}")
    private String configuredVersion;

    public AppInfoController(ProtocolRegistrar protocolRegistrar) {
        this.protocolRegistrar = protocolRegistrar;
    }

    @GetMapping
    public R<Map<String, String>> info() {
        Map<String, String> m = new HashMap<>();
        m.put("name", "DeepShell");
        String v = AppInfoController.class.getPackage().getImplementationVersion();
        m.put("version", v == null ? configuredVersion : v);
        m.put("buildTime", resolveBuildTime());
        m.put("java", System.getProperty("java.version"));
        m.put("os", System.getProperty("os.name") + " " + System.getProperty("os.arch"));
        m.put("dataDir", DataDir.root().toString());
        m.put("packaged", String.valueOf(RuntimeSupport.isPackaged()));
        m.put("launcher", RuntimeSupport.launcher() == null ? ""
                : RuntimeSupport.launcher().toAbsolutePath().toString());
        m.put("installDir", RuntimeSupport.appDir() == null ? ""
                : RuntimeSupport.appDir().toAbsolutePath().toString());
        // 进程启动时间：前端重启后用它判断响应是否已来自新进程
        m.put("startedAt", String.valueOf(ManagementFactory.getRuntimeMXBean().getStartTime()));
        Map<String, Object> protocol = protocolRegistrar.status();
        m.put("protocolState", String.valueOf(protocol.get("state")));
        m.put("protocolScheme", String.valueOf(protocol.get("scheme")));
        m.put("protocolDetail", String.valueOf(protocol.get("detail")));
        return R.ok(m);
    }

    /** 当前运行包（jar 或 classes 目录）的构建/打包时间，用于系统应用属性展示。 */
    private String resolveBuildTime() {
        try {
            URL loc = AppInfoController.class.getProtectionDomain().getCodeSource().getLocation();
            File file = null;
            if (loc != null) {
                String spec = loc.toString();
                if (spec.startsWith("jar:")) {
                    int bang = spec.indexOf("!/");
                    String inner = bang > 0 ? spec.substring(4, bang) : spec.substring(4);
                    file = new File(java.net.URI.create(inner));
                } else if ("file".equals(loc.getProtocol())) {
                    file = new File(loc.toURI());
                }
            }
            if (file == null || !file.exists()) {
                String cp = System.getProperty("java.class.path", "");
                for (String entry : cp.split(File.pathSeparator)) {
                    File candidate = new File(entry);
                    if (candidate.isFile() && candidate.getName().endsWith(".jar")) {
                        file = candidate;
                        break;
                    }
                }
            }
            if (file != null && file.exists()) {
                return new SimpleDateFormat("yyyy-MM-dd HH:mm").format(new Date(file.lastModified()));
            }
        } catch (Exception ignored) {
            // 无法获取运行包位置时由前端使用兜底发布时间
        }
        return "";
    }
}
