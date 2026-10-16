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

import java.util.List;
import java.util.Map;

/** OpenAI 兼容 Chat Completions 调用（非流式），供命令翻译与 AI 终端共用 */
@Service
public class AiChatClient {

    private final AiConfigService config;
    private final RestTemplate rest;
    private final ObjectMapper mapper = new ObjectMapper();

    public AiChatClient(AiConfigService config) {
        this.config = config;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);
        factory.setReadTimeout(120000);
        this.rest = new RestTemplate(factory);
    }

    /**
     * history 元素为 {"role": "user"/"assistant", "content": "..."}；systemPrompt 为空时不带 system 消息。
     * 返回模型回复文本（可能为空串）。
     */
    public String complete(String systemPrompt, List<Map<String, String>> history) {
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
            if (systemPrompt != null && !systemPrompt.trim().isEmpty()) {
                ObjectNode sys = messages.addObject();
                sys.put("role", "system");
                sys.put("content", systemPrompt);
            }
            for (Map<String, String> m : history) {
                ObjectNode n = messages.addObject();
                n.put("role", m.getOrDefault("role", "user"));
                n.put("content", m.getOrDefault("content", ""));
            }

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
            return choices.get(0).path("message").path("content").asText("");
        } catch (IllegalArgumentException | IllegalStateException e) {
            throw e;
        } catch (HttpStatusCodeException e) {
            throw new IllegalStateException("AI 接口调用失败（HTTP " + e.getStatusCode().value() + "）："
                    + extractError(e.getResponseBodyAsString()));
        } catch (Exception e) {
            throw new IllegalStateException("AI 接口调用失败：" + e.getMessage());
        }
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
