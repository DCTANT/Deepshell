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

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** OpenAI 兼容 Chat Completions 调用，供命令翻译与 AI 终端共用（支持普通与流式） */
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
        String key = apiKeyOrThrow();
        String url = completionsUrl();
        try {
            ObjectNode body = buildBody(systemPrompt, history, false);

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

    /**
     * 流式调用：模型每产生一段内容就回调 onDelta（增量文本），返回完整文本。
     * 若服务端忽略 stream 参数而返回一次性 JSON，会自动退化为单次回调。
     */
    public String stream(String systemPrompt, List<Map<String, String>> history, Consumer<String> onDelta) {
        return stream(systemPrompt, history, onDelta, new AiCancellationToken());
    }

    /** 可取消的流式调用：前端停止时断开 HTTP 连接并尽快退出读取循环 */
    public String stream(String systemPrompt, List<Map<String, String>> history,
                         Consumer<String> onDelta, AiCancellationToken token) {
        final AiCancellationToken cancel = token == null ? new AiCancellationToken() : token;
        if (cancel.isCancelled()) {
            throw new AiCancellationToken.CancelledException();
        }
        String key = apiKeyOrThrow();
        String url = completionsUrl();
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            cancel.bind(conn);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(180000);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("Accept", "text/event-stream");
            conn.setRequestProperty("Authorization", "Bearer " + key);
            byte[] payload = mapper.writeValueAsBytes(buildBody(systemPrompt, history, true));
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
                os.flush();
            }

            if (cancel.isCancelled()) {
                throw new AiCancellationToken.CancelledException();
            }
            int code = conn.getResponseCode();
            if (code >= 400) {
                throw new IllegalStateException("AI 接口调用失败（HTTP " + code + "）："
                        + extractError(readAll(conn.getErrorStream())));
            }

            String contentType = conn.getContentType();
            if (contentType == null || !contentType.toLowerCase().contains("event-stream")) {
                // 部分兼容服务忽略 stream 参数，仍返回普通 JSON
                String text = extractMessageContent(readAll(conn.getInputStream()));
                if (cancel.isCancelled()) {
                    throw new AiCancellationToken.CancelledException();
                }
                if (!text.isEmpty()) {
                    onDelta.accept(text);
                    return text;
                }
                throw new IllegalStateException("AI 返回内容为空");
            }

            StringBuilder all = new StringBuilder();
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    if (cancel.isCancelled()) {
                        throw new AiCancellationToken.CancelledException();
                    }
                    if (!line.startsWith("data:")) {
                        continue;
                    }
                    String data = line.substring(5).trim();
                    if (data.isEmpty()) {
                        continue;
                    }
                    if ("[DONE]".equals(data)) {
                        break;
                    }
                    JsonNode root;
                    try {
                        root = mapper.readTree(data);
                    } catch (Exception ignore) {
                        continue;
                    }
                    JsonNode choices = root.path("choices");
                    if (!choices.isArray() || choices.size() == 0) {
                        JsonNode err = root.path("error").path("message");
                        if (!err.isMissingNode() && !err.asText("").isEmpty()) {
                            throw new IllegalStateException("AI 接口调用失败：" + err.asText());
                        }
                        continue;
                    }
                    // 只取正式内容，忽略 reasoning_content 等思考过程字段
                    String delta = choices.get(0).path("delta").path("content").asText("");
                    if (!delta.isEmpty()) {
                        if (cancel.isCancelled()) {
                            throw new AiCancellationToken.CancelledException();
                        }
                        all.append(delta);
                        onDelta.accept(delta);
                    }
                }
            }
            if (cancel.isCancelled()) {
                throw new AiCancellationToken.CancelledException();
            }
            if (all.length() == 0) {
                throw new IllegalStateException("AI 返回内容为空");
            }
            return all.toString();
        } catch (AiCancellationToken.CancelledException e) {
            throw e;
        } catch (IllegalArgumentException | IllegalStateException e) {
            if (cancel.isCancelled()) {
                throw new AiCancellationToken.CancelledException();
            }
            throw e;
        } catch (Exception e) {
            if (cancel.isCancelled()) {
                throw new AiCancellationToken.CancelledException();
            }
            throw new IllegalStateException("AI 接口调用失败：" + e.getMessage());
        } finally {
            cancel.clear();
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private String apiKeyOrThrow() {
        String key = config.apiKey();
        if (key.isEmpty()) {
            throw new IllegalArgumentException("尚未配置 API Key：请到右上角菜单 →「AI 设置」中填写");
        }
        return key;
    }

    private String completionsUrl() {
        String base = config.baseUrl();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base + "/chat/completions";
    }

    private ObjectNode buildBody(String systemPrompt, List<Map<String, String>> history, boolean stream) {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", config.model());
        body.put("stream", stream);
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
        return body;
    }

    private String extractMessageContent(String resp) {
        try {
            JsonNode root = mapper.readTree(resp);
            JsonNode err = root.path("error").path("message");
            if (!err.isMissingNode() && !err.asText("").isEmpty()) {
                throw new IllegalStateException("AI 接口调用失败：" + err.asText());
            }
            JsonNode choices = root.path("choices");
            if (!choices.isArray() || choices.size() == 0) {
                return "";
            }
            return choices.get(0).path("message").path("content").asText("");
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            return "";
        }
    }

    private static String readAll(InputStream in) {
        if (in == null) {
            return "";
        }
        try (InputStream is = in) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
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
