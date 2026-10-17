package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/** AI 设置持久化：数据目录下的 ai.properties（厂商 / OpenAI 兼容接口配置） */
@Service
public class AiConfigService {

    private static final String DEFAULT_BASE_URL = "https://api.deepseek.com";
    private static final String DEFAULT_MODEL = "deepseek-chat";

    private final Path file = DataDir.root().resolve("ai.properties");

    public synchronized Properties load() {
        Properties p = new Properties();
        try {
            if (Files.exists(file)) {
                try (InputStream in = Files.newInputStream(file)) {
                    p.load(in);
                }
            }
        } catch (Exception ignore) {
            // 读取失败按默认配置处理
        }
        return p;
    }

    /** 已保存的厂商 id；老配置（无该字段）返回空串，由调用方按地址推断 */
    public String provider() {
        return load().getProperty("provider", "").trim();
    }

    public String baseUrl() {
        String v = load().getProperty("base-url", "").trim();
        return v.isEmpty() ? DEFAULT_BASE_URL : v;
    }

    public String model() {
        String v = load().getProperty("model", "").trim();
        return v.isEmpty() ? DEFAULT_MODEL : v;
    }

    public String apiKey() {
        return load().getProperty("api-key", "").trim();
    }

    /** apiKey 传 null / 空白表示保持原值 */
    public synchronized void save(String provider, String baseUrl, String apiKey, String model) {
        Properties p = load();
        if (provider != null && !provider.trim().isEmpty()) {
            p.setProperty("provider", provider.trim());
        }
        if (baseUrl != null) {
            p.setProperty("base-url", baseUrl.trim());
        }
        if (model != null) {
            p.setProperty("model", model.trim());
        }
        if (apiKey != null && !apiKey.trim().isEmpty()) {
            p.setProperty("api-key", apiKey.trim());
        }
        try {
            Files.createDirectories(file.getParent());
            try (OutputStream out = Files.newOutputStream(file)) {
                p.store(out, "DeepShell AI settings");
            }
        } catch (Exception e) {
            throw new IllegalStateException("保存 AI 设置失败: " + e.getMessage());
        }
    }
}
