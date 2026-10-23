package com.itdct.deepshell.common;

import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 程序数据目录解析（数据库 / 密钥 / 日志 / 背景图等统一存放于该目录）。
 * 优先级：-Ddeepshell.data-dir 系统属性 &gt; 启动目录外置 application.yml 的 deepshell.data-dir
 * &gt; 绿色版程序目录 data &gt; ~/.deepshell。
 * main() 在 Spring 上下文之前就要用数据目录，因此外置配置在这里自行读取一次；
 * 与外置配置同时生效的 Spring 占位符（application.yml 中的 ${deepshell.data-dir:...}）保持同一解析结果。
 */
public final class DataDir {

    private static final Path ROOT = resolve();

    private DataDir() {
    }

    public static Path root() {
        return ROOT;
    }

    private static Path resolve() {
        String prop = System.getProperty("deepshell.data-dir");
        if (prop != null && !prop.trim().isEmpty()) {
            return Paths.get(prop.trim()).toAbsolutePath().normalize();
        }
        List<Path> candidates = new ArrayList<>();
        candidates.add(Paths.get("./application.yml"));
        candidates.add(Paths.get("./config/application.yml"));
        Path appDir = RuntimeSupport.appDir();
        if (appDir != null) {
            // 绿色版的启动器可能不把工作目录设为程序目录，外置配置需要单独查找
            candidates.add(appDir.resolve("application.yml"));
            candidates.add(appDir.resolve("config").resolve("application.yml"));
        }
        for (Path file : candidates) {
            if (!Files.isRegularFile(file)) {
                continue;
            }
            try (InputStream in = Files.newInputStream(file)) {
                Object o = new Yaml().load(in);
                if (o instanceof Map) {
                    Object section = ((Map<?, ?>) o).get("deepshell");
                    if (section instanceof Map) {
                        Object dir = ((Map<?, ?>) section).get("data-dir");
                        if (dir != null && !dir.toString().trim().isEmpty()) {
                            Path configured = Paths.get(dir.toString().trim());
                            if (!configured.isAbsolute()) {
                                Path anchor = file.toAbsolutePath().normalize().getParent();
                                configured = anchor == null ? configured : anchor.resolve(configured);
                            }
                            return configured.toAbsolutePath().normalize();
                        }
                    }
                }
            } catch (Exception ignore) {
                // 外置配置不可读时按默认目录处理
            }
        }
        if (appDir != null) {
            return appDir.resolve("data").toAbsolutePath().normalize();
        }
        return Paths.get(System.getProperty("user.home"), ".deepshell").toAbsolutePath().normalize();
    }
}
