package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

/** 通过 OpenAI 兼容的 Chat Completions 接口，把自然语言需求翻译为 shell 命令 */
@Service
public class AiCommandService {

    private static final String SYSTEM_PROMPT =
            "你是资深 Linux 运维专家，负责把用户的自然语言需求翻译成可直接在 bash 中执行的 shell 命令。"
                    + "要求：只输出一条命令本身；不要任何解释、说明、markdown 代码块或反引号；不要输出多行；"
                    + "如果需求模糊，给出最常用且安全的实现；涉及删除、覆盖等危险操作时优先使用保守写法。";

    private final AiConfigService config;
    private final RestTemplate rest;
    private final ObjectMapper mapper = new ObjectMapper();

    public AiCommandService(AiConfigService config) {
        this.config = config;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);
        factory.setReadTimeout(90000);
        this.rest = new RestTemplate(factory);
    }

    public String translate(String text, String cwd) {
        if (text == null || text.trim().isEmpty()) {
            throw new IllegalArgumentException("请输入要生成命令的需求描述");
        }
        String key = config.apiKey();
        if (key.isEmpty()) {
            throw new IllegalArgumentException("尚未配置 API Key：请到右上角菜单 →「AI 设置」中填写");
        }
        String base = config.baseUrl();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        String url = base + "/chat/completions";
        try {
            ObjectNode body = mapper.createObjectNode();
            body.put("model", config.model());
            body.put("stream", false);
            ArrayNode messages = body.putArray("messages");
            ObjectNode sys = messages.addObject();
            sys.put("role", "system");
            sys.put("content", SYSTEM_PROMPT);
            ObjectNode user = messages.addObject();
            user.put("role", "user");
            String prompt = text.trim();
            if (cwd != null && !cwd.trim().isEmpty()) {
                prompt = prompt + "\n（当前会话工作目录：" + cwd.trim() + "）";
            }
            user.put("content", prompt);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(key);
            String resp = rest.postForObject(url,
                    new HttpEntity<>(mapper.writeValueAsString(body), headers), String.class);
            JsonNode root = mapper.readTree(resp);
            JsonNode choices = root.path("choices");
            if (!choices.isArray() || choices.size() == 0) {
                throw new IllegalStateException("AI 返回内容为空");
            }
            String command = clean(choices.get(0).path("message").path("content").asText(""));
            if (command.isEmpty()) {
                throw new IllegalStateException("AI 返回内容为空");
            }
            return command;
        } catch (IllegalArgumentException | IllegalStateException e) {
            throw e;
        } catch (HttpStatusCodeException e) {
            throw new IllegalStateException("AI 接口调用失败（HTTP " + e.getStatusCode().value() + "）："
                    + extractError(e.getResponseBodyAsString()));
        } catch (Exception e) {
            throw new IllegalStateException("AI 接口调用失败：" + e.getMessage());
        }
    }

    /** 去掉模型可能附带的反引号代码块 / 行内反引号 / 首行 $ 提示符，只保留单行命令 */
    private static String clean(String raw) {
        String t = raw == null ? "" : raw.trim();
        if (t.startsWith("```")) {
            int idx = t.indexOf('\n');
            if (idx >= 0) {
                t = t.substring(idx + 1);
            }
            if (t.endsWith("```")) {
                t = t.substring(0, t.length() - 3);
            }
            t = t.trim();
        }
        if (t.length() >= 2 && t.startsWith("`") && t.endsWith("`")) {
            t = t.substring(1, t.length() - 1).trim();
        }
        int nl = t.indexOf('\n');
        if (nl >= 0) {
            t = t.substring(0, nl).trim();
        }
        if (t.startsWith("$ ")) {
            t = t.substring(2).trim();
        }
        return t;
    }

    /** 尽量从错误响应里取出可读信息（OpenAI 风格为 error.message） */
    private String extractError(String body) {
        if (body == null || body.trim().isEmpty()) {
            return "无响应内容";
        }
        try {
            JsonNode err = mapper.readTree(body).path("error").path("message");
            if (!err.isMissingNode() && !err.asText("").isEmpty()) {
                return err.asText();
            }
        } catch (Exception ignore) {
            // 非 JSON，按原文截断
        }
        String t = body.trim();
        return t.length() > 300 ? t.substring(0, 300) + "…" : t;
    }
}
