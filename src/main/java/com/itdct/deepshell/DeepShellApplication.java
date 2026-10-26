package com.itdct.deepshell;

import com.itdct.deepshell.common.AppRestartSupport;
import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.common.RuntimeSupport;
import com.itdct.deepshell.mcp.McpStdioBridge;
import com.itdct.deepshell.protocol.ProtocolLaunchSupport;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.Properties;

@Slf4j
@SpringBootApplication
public class DeepShellApplication {

    public static void main(String[] args) throws Exception {
        // 让 --deepshell.data-dir=... 与 -Ddeepshell.data-dir=... 一样在数据目录解析前生效，
        // 避免数据库走 CLI 参数、密钥/证书/日志却落到 ~/.deepshell
        applyDataDirFromArgs(args);
        // AI 客户端以 stdio 方式启动本 jar：只做 JSON-RPC 转发，不启动 Spring / 图形界面
        if (McpStdioBridge.hasStdioArg(args)) {
            System.setProperty("java.awt.headless", "true");
            McpStdioBridge.run(args);
            return;
        }
        // 开机自启 / 托盘后台启动：不自动弹出浏览器
        if (RuntimeSupport.hasBackgroundArg(args)) {
            System.setProperty("deepshell.background", "true");
        }
        // 绿色版由 jpackage 启动器启动，application.yml 可能不在启动目录；显式加载程序目录的外置配置
        applyPackagedDefaults();
        // 托盘与原生目录选择需要 AWT；无桌面会话的服务器保持 headless
        if (RuntimeSupport.hasDesktopSession()) {
            System.setProperty("java.awt.headless", "false");
        }
        // 界面发起的「重启 DeepShell」会以该参数拉起重启助手：等旧进程退出后再启动新实例
        if (AppRestartSupport.isHelper(args)) {
            AppRestartSupport.runHelper(args);
            return;
        }
        // deepshell:// 外部调用：已有实例在运行就交给它并立即退出，避免重复启动 / 端口冲突；
        // 没有实例则继续启动，ProtocolBootstrap 会在就绪后打开对应连接。
        if (ProtocolLaunchSupport.handleEarly(args)) {
            return;
        }
        Path dataDir = DataDir.root();
        // 数据目录解析结果固定为系统属性，保证 Spring 的 datasource/logging 占位符与 DataDir 完全一致
        if (System.getProperty("deepshell.data-dir") == null) {
            System.setProperty("deepshell.data-dir", dataDir.toString());
        }
        // SQLite 不会自动创建缺失的父目录，需在数据源初始化前准备好
        Files.createDirectories(dataDir.resolve("db"));
        Files.createDirectories(dataDir.resolve("logs"));
        // 局域网访问开关：界面保存过 network.properties 时以它为准（系统属性优先级高于配置文件）；
        // 没保存过则完全交给 application.yml 的 server.address（默认 127.0.0.1）
        if (System.getProperty("server.address") == null
                && System.getenv("SERVER_ADDRESS") == null
                && !hasBindArg(args)) {
            Boolean saved = savedLanEnabled(dataDir);
            if (saved != null) {
                String bind = saved ? "0.0.0.0" : "127.0.0.1";
                System.setProperty("server.address", bind);
                log.info("监听地址由界面「局域网访问」开关决定：{}（{}），application.yml 中的 server.address 不生效",
                        bind, dataDir.resolve("network.properties"));
            }
        }
        SpringApplication app = new SpringApplication(DeepShellApplication.class);
        // 最低优先级兜底：即使配置文件删掉了 server.address，也默认只监听本机
        app.setDefaultProperties(Collections.singletonMap("server.address", "127.0.0.1"));
        app.run(args);
    }

    /**
     * 绿色版（jpackage app-image）的程序目录里带外置 application.yml / data。
     * 启动器可能不把工作目录设为程序目录，这里显式补上 Spring 配置位置。
     */
    private static void applyPackagedDefaults() {
        Path appDir = RuntimeSupport.appDir();
        if (appDir == null) {
            return;
        }
        Path config = appDir.resolve("application.yml");
        if (Files.isRegularFile(config)
                && System.getProperty("spring.config.additional-location") == null) {
            System.setProperty("spring.config.additional-location",
                    "optional:file:" + config.toString().replace('\\', '/'));
        }
    }

    /** 支持 --deepshell.data-dir=... 与 --deepshell.data-dir ... 两种写法。 */
    private static void applyDataDirFromArgs(String[] args) {
        if (System.getProperty("deepshell.data-dir") != null) {
            return;
        }
        for (int i = 0; i < args.length; i++) {
            String arg = args[i];
            if (arg != null && arg.startsWith("--deepshell.data-dir=")) {
                System.setProperty("deepshell.data-dir", arg.substring("--deepshell.data-dir=".length()));
                return;
            }
            if ("--deepshell.data-dir".equals(arg) && i + 1 < args.length) {
                System.setProperty("deepshell.data-dir", args[i + 1]);
                return;
            }
        }
    }

    /** 返回 network.properties 中保存的开关；文件不存在或读取失败返回 null（交给配置默认值）。 */
    private static Boolean savedLanEnabled(Path dataDir) {
        Path cfg = dataDir.resolve("network.properties");
        if (!Files.exists(cfg)) {
            return null;
        }
        try (InputStream in = Files.newInputStream(cfg)) {
            Properties p = new Properties();
            p.load(in);
            return Boolean.parseBoolean(p.getProperty("lan.enabled", "false"));
        } catch (Exception ignore) {
            return null;
        }
    }

    /** 命令行是否显式指定了监听地址（含旧版的 deepshell.lan-address 写法）。 */
    private static boolean hasBindArg(String[] args) {
        for (String arg : args) {
            if (arg == null) {
                continue;
            }
            if (arg.equals("--server.address") || arg.startsWith("--server.address=")
                    || arg.equals("--deepshell.lan-address")
                    || arg.startsWith("--deepshell.lan-address=")) {
                return true;
            }
        }
        return false;
    }
}
