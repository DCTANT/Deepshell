package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Autowired;
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
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * OpenAI 兼容 Chat Completions 调用，供命令翻译与 AI 终端共用（支持普通与流式）。
 * 同时解析厂商返回的 token usage（含缓存命中 / 思考 token），供上下文用量与压缩功能使用。
 */
@Service
public class AiChatClient {

    /** 一次模型调用的 token 用量；estimated=true 表示厂商未返回 usage，由字符数估算 */
    public static class Usage {
        public Integer promptTokens;
        public Integer completionTokens;
        public Integer totalTokens;
        /** prompt 中命中厂商前缀缓存的 token 数（DeepSeek / OpenAI 等） */
        public Integer cachedTokens;
        /** 思考 / reasoning token 数 */
        public Integer reasoningTokens;
        public boolean estimated;
    }

    /** 模型回复文本与本次调用的 token 用量 */
    public static class ChatResult {
        public String text;
        public String reasoning;
        public Usage usage;

        public ChatResult(String text, Usage usage) {
            this.text = text == null ? "" : text;
            this.usage = usage;
        }

        ChatResult(String text, Usage usage, String reasoning) {
            this(text, usage);
            this.reasoning = reasoning == null ? "" : reasoning;
        }
    }

    private final AiConfigService config;
    private final AiUsageService usageService;
    private final RestTemplate rest;
    private final ObjectMapper mapper = new ObjectMapper();
    /** 已确认不接受 stream_options.include_usage 的接口地址，避免每次流式请求都多失败一次 */
    private final Set<String> usageOptionRejected = Collections.newSetFromMap(new ConcurrentHashMap<String, Boolean>());

    public AiChatClient(AiConfigService config) {
        this(config, null);
    }

    @Autowired
    public AiChatClient(AiConfigService config, AiUsageService usageService) {
        this.config = config;
        this.usageService = usageService;
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
        return completeDetailed(systemPrompt, history).text;
    }

    /** 非流式调用：返回文本及厂商 usage（缺失时按字符数估算） */
    public ChatResult completeDetailed(String systemPrompt, List<Map<String, String>> history) {
        String key = apiKeyOrThrow();
        String url = completionsUrl();
        try {
            ObjectNode body = buildBody(systemPrompt, history, false, false);

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
            String text = choices.get(0).path("message").path("content").asText("");
            String reasoning = reasoningText(choices.get(0).path("message"));
            ChatResult result = new ChatResult(text,
                    usageOrEstimateFromResponse(root, systemPrompt, history, text), reasoning);
            recordUsage(result.usage);
            return result;
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
        return streamDetailed(systemPrompt, history, onDelta, null, new AiCancellationToken()).text;
    }

    /** 可取消的流式调用：前端停止时断开 HTTP 连接并尽快退出读取循环 */
    public String stream(String systemPrompt, List<Map<String, String>> history,
                         Consumer<String> onDelta, AiCancellationToken token) {
        return streamDetailed(systemPrompt, history, onDelta, null, token).text;
    }

    /**
     * 可取消的流式调用（含思考过程）：reasoning_content 逐段回调 onReasoning，
     * 正文逐段回调 onDelta。兼容把 reasoning 放在 reasoning / reasoning_content 两种字段的服务。
     */
    public String stream(String systemPrompt, List<Map<String, String>> history,
                         Consumer<String> onDelta, Consumer<String> onReasoning,
                         AiCancellationToken token) {
        return streamDetailed(systemPrompt, history, onDelta, onReasoning, token).text;
    }

    /**
     * 带 token usage 的流式调用。优先请求厂商在最后一个 SSE chunk 中返回 usage；
     * 若接口拒绝 stream_options 参数，自动去掉该参数重试一次，后续请求也不再携带。
     */
    public ChatResult streamDetailed(String systemPrompt, List<Map<String, String>> history,
                                     Consumer<String> onDelta, Consumer<String> onReasoning,
                                     AiCancellationToken token) {
        String endpoint = completionsUrl();
        boolean includeUsage = !usageOptionRejected.contains(endpoint);
        ChatResult result;
        try {
            result = streamOnce(systemPrompt, history, onDelta, onReasoning, token, includeUsage);
        } catch (IllegalStateException e) {
            if (includeUsage && looksLikeUsageOptionRejection(e.getMessage())) {
                usageOptionRejected.add(endpoint);
                result = streamOnce(systemPrompt, history, onDelta, onReasoning, token, false);
            } else {
                throw e;
            }
        }
        recordUsage(result.usage);
        return result;
    }

    /** 记录一次成功模型调用的 token 用量；统计失败不影响对话 */
    private void recordUsage(Usage usage) {
        if (usageService != null) {
            usageService.record(usage);
        }
    }

    private ChatResult streamOnce(String systemPrompt, List<Map<String, String>> history,
                                  Consumer<String> onDelta, Consumer<String> onReasoning,
                                  AiCancellationToken token, boolean includeUsage) {
        final AiCancellationToken cancel = token == null ? new AiCancellationToken() : token;
        final Consumer<String> reasonSink = onReasoning == null ? s -> { } : onReasoning;
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
            byte[] payload = mapper.writeValueAsBytes(buildBody(systemPrompt, history, true, includeUsage));
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
                String resp = readAll(conn.getInputStream());
                JsonNode root = mapper.readTree(resp);
                JsonNode message = extractMessageNode(root);
                String text = message == null ? "" : message.path("content").asText("");
                String reasoning = message == null ? "" : reasoningText(message);
                if (cancel.isCancelled()) {
                    throw new AiCancellationToken.CancelledException();
                }
                if (!text.isEmpty()) {
                    if (!reasoning.isEmpty()) {
                        reasonSink.accept(reasoning);
                    }
                    onDelta.accept(text);
                    return new ChatResult(text, usageOrEstimateFromResponse(root, systemPrompt, history, text), reasoning);
                }
                if (!reasoning.isEmpty()) {
                    // 少数模型把工具调用（DSML）只放在 reasoning_content 里，交给上层解析
                    reasonSink.accept(reasoning);
                    return new ChatResult("", usageOrEstimateFromResponse(root, systemPrompt, history, ""), reasoning);
                }
                throw new IllegalStateException("AI 返回内容为空");
            }

            StringBuilder all = new StringBuilder();
            StringBuilder reasoningAll = new StringBuilder();
            JsonNode usageNode = null;
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
                    // 流式 usage 通常出现在 choices 为空的最后一个 chunk 中
                    JsonNode u = root.path("usage");
                    if (u.isObject()) {
                        usageNode = u;
                    }
                    JsonNode choices = root.path("choices");
                    if (!choices.isArray() || choices.size() == 0) {
                        JsonNode err = root.path("error").path("message");
                        if (!err.isMissingNode() && !err.asText("").isEmpty()) {
                            throw new IllegalStateException("AI 接口调用失败：" + err.asText());
                        }
                        continue;
                    }
                    // 思考过程（DeepSeek reasoner 等）单独回调，正文仍只取 content
                    JsonNode deltaNode = choices.get(0).path("delta");
                    String reasoning = reasoningText(deltaNode);
                    if (!reasoning.isEmpty()) {
                        if (cancel.isCancelled()) {
                            throw new AiCancellationToken.CancelledException();
                        }
                        reasoningAll.append(reasoning);
                        reasonSink.accept(reasoning);
                    }
                    String delta = deltaNode.path("content").asText("");
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
                if (reasoningAll.length() > 0) {
                    // 少数模型把工具调用（DSML）只放在 reasoning_content 里
                    return new ChatResult("",
                            usageOrEstimateFromUsage(usageNode, systemPrompt, history, ""),
                            reasoningAll.toString());
                }
                throw new IllegalStateException("AI 返回内容为空");
            }
            return new ChatResult(all.toString(),
                    usageOrEstimateFromUsage(usageNode, systemPrompt, history, all.toString()),
                    reasoningAll.toString());
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

    private boolean looksLikeUsageOptionRejection(String message) {
        if (message == null) {
            return false;
        }
        String m = message.toLowerCase();
        return (m.contains("http 400") || m.contains("http 422"))
                && (m.contains("stream_options") || m.contains("include_usage"));
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

    private ObjectNode buildBody(String systemPrompt, List<Map<String, String>> history,
                                 boolean stream, boolean includeUsage) {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", config.model());
        body.put("stream", stream);
        if (stream && includeUsage) {
            body.putObject("stream_options").put("include_usage", true);
        }
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

    /* ---------- token usage ---------- */

    private Usage usageOrEstimateFromResponse(JsonNode root, String systemPrompt,
                                              List<Map<String, String>> history, String responseText) {
        Usage usage = root == null || root.isMissingNode() ? null : parseUsage(root.path("usage"));
        if (usage != null) {
            return usage;
        }
        return estimateUsage(systemPrompt, history, responseText);
    }

    private Usage usageOrEstimateFromUsage(JsonNode usageNode, String systemPrompt,
                                           List<Map<String, String>> history, String responseText) {
        Usage usage = parseUsage(usageNode);
        if (usage != null) {
            return usage;
        }
        return estimateUsage(systemPrompt, history, responseText);
    }

    static Usage parseUsage(JsonNode usageNode) {
        if (usageNode == null || !usageNode.isObject()) {
            return null;
        }
        Integer prompt = firstInt(usageNode, "prompt_tokens", "input_tokens");
        Integer completion = firstInt(usageNode, "completion_tokens", "output_tokens");
        Integer total = firstInt(usageNode, "total_tokens");
        if (prompt == null && completion == null && total == null) {
            return null;
        }
        Usage u = new Usage();
        u.promptTokens = prompt;
        u.completionTokens = completion;
        u.totalTokens = total != null ? total
                : Integer.valueOf(nullToZero(prompt) + nullToZero(completion));
        u.cachedTokens = firstInt(usageNode,
                "prompt_cache_hit_tokens", "cache_read_input_tokens", "cached_tokens");
        if (u.cachedTokens == null) {
            u.cachedTokens = nestedInt(usageNode, "prompt_tokens_details", "cached_tokens");
        }
        if (u.cachedTokens == null) {
            u.cachedTokens = nestedInt(usageNode, "input_tokens_details", "cached_tokens");
        }
        u.reasoningTokens = firstInt(usageNode, "reasoning_tokens");
        if (u.reasoningTokens == null) {
            u.reasoningTokens = nestedInt(usageNode, "completion_tokens_details", "reasoning_tokens");
        }
        if (u.reasoningTokens == null) {
            u.reasoningTokens = nestedInt(usageNode, "output_tokens_details", "reasoning_tokens");
        }
        u.estimated = false;
        return u;
    }

    /** 厂商未返回 usage 时的兜底估算：混合文本约 4 字符/token，另加每条消息的角色开销 */
    private Usage estimateUsage(String systemPrompt, List<Map<String, String>> history, String responseText) {
        long chars = systemPrompt == null ? 0 : systemPrompt.length();
        int count = 0;
        if (history != null) {
            for (Map<String, String> m : history) {
                if (m == null) {
                    continue;
                }
                String c = m.get("content");
                chars += c == null ? 0 : c.length();
                count++;
            }
        }
        Usage u = new Usage();
        u.promptTokens = (int) (Math.ceil(chars / 4.0) + count * 4L);
        u.completionTokens = (int) Math.ceil((responseText == null ? 0 : responseText.length()) / 4.0);
        u.totalTokens = u.promptTokens + u.completionTokens;
        u.estimated = true;
        return u;
    }

    private static Integer firstInt(JsonNode node, String... keys) {
        if (node == null) {
            return null;
        }
        for (String key : keys) {
            JsonNode v = node.path(key);
            if (v.isNumber()) {
                return v.asInt();
            }
        }
        return null;
    }

    private static Integer nestedInt(JsonNode node, String parent, String child) {
        if (node == null) {
            return null;
        }
        JsonNode p = node.path(parent);
        if (!p.isObject()) {
            return null;
        }
        JsonNode v = p.path(child);
        return v.isNumber() ? v.asInt() : null;
    }

    private static int nullToZero(Integer v) {
        return v == null ? 0 : v;
    }

    /** 从非流式响应中取出 message 节点（找不到时返回 null） */
    private JsonNode extractMessageNode(JsonNode root) {
        if (root == null) {
            return null;
        }
        JsonNode err = root.path("error").path("message");
        if (!err.isMissingNode() && !err.asText("").isEmpty()) {
            throw new IllegalStateException("AI 接口调用失败：" + err.asText());
        }
        JsonNode choices = root.path("choices");
        if (!choices.isArray() || choices.size() == 0) {
            return null;
        }
        return choices.get(0).path("message");
    }

    /** 兼容 reasoning_content / reasoning 两种思考过程字段 */
    private static String reasoningText(JsonNode node) {
        if (node == null || node.isMissingNode()) {
            return "";
        }
        String s = node.path("reasoning_content").asText("");
        if (s.isEmpty()) {
            s = node.path("reasoning").asText("");
        }
        return s == null ? "" : s;
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
