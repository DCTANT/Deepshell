package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 对话标题总结：新对话首条消息后自动生成，也支持用户确认后重新总结覆盖。
 * 只把用户与 AI 的文字回复交给模型，不携带命令输出等大段内容。
 */
@Slf4j
@Service
public class AiConversationTitleService {

    private static final String SYSTEM_PROMPT = "你负责给 AI 终端对话生成简短标题。"
            + "根据对话内容概括用户要完成的任务或讨论主题，标题语言与对话主要语言一致。"
            + "只输出标题本身，不要解释、不要 JSON、不要 Markdown；"
            + "中文不超过 20 个汉字，英文不超过 8 个单词；不要引号、书名号、序号、句号。"
            + "如果无法判断主题，输出“新对话”。";
    private static final int MAX_TRANSCRIPT_CHARS = 6000;
    private static final int TRANSCRIPT_HEAD_CHARS = 1500;
    private static final int MAX_MESSAGE_CHARS = 2000;
    private static final int MAX_TITLE_CHARS = 30;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AiChatClient chatClient;
    private final AiConversationService convService;

    public AiConversationTitleService(AiChatClient chatClient, AiConversationService convService) {
        this.chatClient = chatClient;
        this.convService = convService;
    }

    /**
     * force=true：用户确认后无条件覆盖标题；force=false：只替换占位标题或 expectedTitle，
     * 自动生成失败时保持原样，不打断当前 AI 任务。
     */
    public AiConversationService.ConvDto generate(Long id, boolean force, String hint, String expectedTitle) {
        AiConversationService.ConvDto conv = convService.get(id);
        String transcript = transcript(conv.msgs, hint);
        if (transcript.isEmpty()) {
            if (!force) {
                return conv;
            }
            throw new IllegalArgumentException("当前对话还没有内容，无法总结标题");
        }

        String title;
        try {
            Map<String, String> message = new LinkedHashMap<>();
            message.put("role", "user");
            message.put("content", transcript);
            AiChatClient.ChatResult result = chatClient.completeDetailed(
                    SYSTEM_PROMPT, Collections.singletonList(message));
            title = cleanTitle(result.text);
        } catch (RuntimeException e) {
            if (force) {
                throw e;
            }
            log.debug("自动总结对话标题失败: {}", e.getMessage());
            return convService.get(id);
        }
        if (title.isEmpty()) {
            if (!force) {
                return convService.get(id);
            }
            throw new IllegalStateException("模型没有返回有效标题，请重试");
        }
        return force ? convService.forceTitle(id, title)
                : convService.applyAutoTitle(id, title, expectedTitle);
    }

    /** 只取用户与 AI 的文字内容；太长时保留开头和结尾，兼顾初始任务与最新话题 */
    static String transcript(JsonNode msgs, String hint) {
        StringBuilder sb = new StringBuilder();
        if (msgs != null && msgs.isArray()) {
            for (JsonNode m : msgs) {
                if (m == null || !m.isObject()) {
                    continue;
                }
                String role = m.path("role").asText("");
                String text = m.path("text").asText("").trim();
                if (text.isEmpty()) {
                    continue;
                }
                if ("user".equals(role)) {
                    sb.append("用户：");
                } else if ("ai".equals(role)) {
                    sb.append("助手：");
                } else {
                    continue;
                }
                if (text.length() > MAX_MESSAGE_CHARS) {
                    text = text.substring(0, MAX_MESSAGE_CHARS) + "…";
                }
                sb.append(text).append('\n');
            }
        }
        if (sb.length() == 0 && hint != null && !hint.trim().isEmpty()) {
            String text = hint.trim();
            if (text.length() > MAX_MESSAGE_CHARS) {
                text = text.substring(0, MAX_MESSAGE_CHARS) + "…";
            }
            sb.append("用户：").append(text).append('\n');
        }
        String all = sb.toString().trim();
        if (all.length() > MAX_TRANSCRIPT_CHARS) {
            all = all.substring(0, TRANSCRIPT_HEAD_CHARS) + "\n…（中间省略）…\n"
                    + all.substring(all.length() - (MAX_TRANSCRIPT_CHARS - TRANSCRIPT_HEAD_CHARS));
        }
        return all;
    }

    /** 兼容模型返回引号、Markdown、JSON 包裹或“标题：”前缀 */
    static String cleanTitle(String raw) {
        if (raw == null) {
            return "";
        }
        String s = raw.trim();
        if (s.startsWith("```")) {
            int firstLine = s.indexOf('\n');
            if (firstLine >= 0) {
                s = s.substring(firstLine + 1);
            }
            int fence = s.lastIndexOf("```");
            if (fence >= 0) {
                s = s.substring(0, fence);
            }
            s = s.trim();
        }
        if (s.startsWith("{")) {
            boolean extracted = false;
            try {
                JsonNode node = MAPPER.readTree(s);
                for (String key : new String[]{"title", "标题", "name"}) {
                    if (node != null && node.hasNonNull(key)) {
                        s = node.get(key).asText("");
                        extracted = true;
                        break;
                    }
                }
            } catch (Exception ignore) {
                // 兼容模型把标题包在格式不严格的 JSON 里
            }
            if (!extracted) {
                Matcher m = Pattern.compile("\"(?:title|标题|name)\"\\s*:\\s*\"([^\"]+)\"").matcher(s);
                if (m.find()) {
                    s = m.group(1);
                } else {
                    return "";
                }
            }
        }
        int lineEnd = s.indexOf('\n');
        if (lineEnd >= 0) {
            s = s.substring(0, lineEnd);
        }
        s = s.trim();
        String edge = "[\\s#>*\\-\"'“”‘’「」『』《》]+";
        s = s.replaceFirst("^" + edge, "");
        s = s.replaceFirst("^(?:标题|对话标题)\\s*[：:]\\s*", "");
        s = s.replaceFirst("^" + edge, "");
        s = s.replaceAll(edge + "$", "");
        s = s.replaceAll("[。！？!?；;，,、：:]+$", "");
        s = s.replaceAll("\\s+", " ").trim();
        if (s.length() > MAX_TITLE_CHARS) {
            s = s.substring(0, MAX_TITLE_CHARS).trim();
        }
        return s;
    }
}
