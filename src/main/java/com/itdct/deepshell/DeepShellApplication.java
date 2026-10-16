package com.itdct.deepshell;

import com.itdct.deepshell.common.DataDir;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

@SpringBootApplication
public class DeepShellApplication {

    public static void main(String[] args) throws Exception {
        Path dataDir = DataDir.root();
        // SQLite 不会自动创建缺失的父目录，需在数据源初始化前准备好
        Files.createDirectories(dataDir.resolve("db"));
        Files.createDirectories(dataDir.resolve("logs"));
        // 局域网访问开关（默认仅本机 127.0.0.1），须在容器绑定端口前读取
        String bind = "127.0.0.1";
        try {
            Path cfg = dataDir.resolve("network.properties");
            if (Files.exists(cfg)) {
                Properties p = new Properties();
                try (InputStream in = Files.newInputStream(cfg)) {
                    p.load(in);
                }
                if (Boolean.parseBoolean(p.getProperty("lan.enabled", "false"))) {
                    bind = "0.0.0.0";
                }
            }
        } catch (Exception ignore) {
            // 配置读取失败时按默认（仅本机）处理
        }
        System.setProperty("deepshell.lan-address", bind);
        SpringApplication.run(DeepShellApplication.class, args);
    }
}
