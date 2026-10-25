package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class AiConversationTitleServiceTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void cleansQuotesPrefixAndTrailingPunctuation() {
        assertEquals("排查 MySQL 内存占用", AiConversationTitleService.cleanTitle("“标题：排查 MySQL 内存占用。”"));
        assertEquals("重启 nginx 服务", AiConversationTitleService.cleanTitle("### 重启 nginx 服务"));
        assertEquals("检查磁盘空间", AiConversationTitleService.cleanTitle("  检查磁盘空间。  \n补充解释"));
    }

    @Test
    void extractsTitleFromJsonAndCodeFence() {
        assertEquals("查看端口监听", AiConversationTitleService.cleanTitle("{\"title\":\"查看端口监听\"}"));
        assertEquals("查看端口监听", AiConversationTitleService.cleanTitle("```json\n{\"title\": \"查看端口监听\"}\n```"));
        assertEquals("查看端口监听", AiConversationTitleService.cleanTitle("{\"title\":\"查看端口监听\",}"));
    }

    @Test
    void rejectsJsonWithoutTitleAndCapsLength() {
        assertEquals("", AiConversationTitleService.cleanTitle("{\"foo\":\"bar\"}"));
        String longTitle = AiConversationTitleService.cleanTitle(
                "这是一个明显超过三十个字符限制的标题用于验证最终长度会被正确截断");
        assertEquals(30, longTitle.length());
    }

    @Test
    void buildsTranscriptFromUserAndAiTextOnly() {
        ArrayNode msgs = mapper.createArrayNode();
        msgs.add(msg("user", "看一下哪个进程占用内存最多"));
        msgs.add(msg("ai", "占用最多的是 mysqld"));
        msgs.add(msg("note", "已停止"));
        msgs.add(msg("ai", ""));
        msgs.add(msg("compact", "早前摘要"));

        String transcript = AiConversationTitleService.transcript(msgs, null);
        assertTrue(transcript.contains("用户：看一下哪个进程占用内存最多"));
        assertTrue(transcript.contains("助手：占用最多的是 mysqld"));
        assertTrue(!transcript.contains("已停止"));
        assertTrue(!transcript.contains("早前摘要"));
    }

    @Test
    void fallsBackToHintWhenNoStoredMessages() {
        assertEquals("用户：检查服务状态",
                AiConversationTitleService.transcript(mapper.createArrayNode(), " 检查服务状态 "));
        assertEquals("", AiConversationTitleService.transcript(null, "  "));
    }

    private ObjectNode msg(String role, String text) {
        ObjectNode n = mapper.createObjectNode();
        n.put("role", role);
        n.put("text", text);
        return n;
    }
}
