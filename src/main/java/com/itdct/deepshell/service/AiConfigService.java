package com.itdct.deepshell.service;

import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Properties;

/** AI 设置持久化：~/.deepshell/ai.properties（OpenAI 兼容接口配置） */
@Service
public class AiConfigService {

    private static final String DEFAULT_BASE_URL = "https://api.deepseek.com";
    private static final String DEFAULT_MODEL = "deepseek-chat";

    private final Path file = Paths.get(System.getProperty("user.home"), ".deepshell", "ai.properties");

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
    public synchronized void save(String baseUrl, String apiKey, String model) {
        Properties p = load();
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
