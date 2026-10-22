package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class AiChatClientUsageTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void parsesOpenAiStyleUsageIncludingCacheAndReasoning() throws Exception {
        AiChatClient.Usage u = AiChatClient.parseUsage(mapper.readTree(
                "{\"prompt_tokens\":1200,\"completion_tokens\":340,\"total_tokens\":1540,"
                        + "\"prompt_tokens_details\":{\"cached_tokens\":900},"
                        + "\"completion_tokens_details\":{\"reasoning_tokens\":120}}"));

        assertEquals(Integer.valueOf(1200), u.promptTokens);
        assertEquals(Integer.valueOf(340), u.completionTokens);
        assertEquals(Integer.valueOf(1540), u.totalTokens);
        assertEquals(Integer.valueOf(900), u.cachedTokens);
        assertEquals(Integer.valueOf(120), u.reasoningTokens);
        assertFalse(u.estimated);
    }

    @Test
    void parsesDeepSeekCacheHitField() throws Exception {
        AiChatClient.Usage u = AiChatClient.parseUsage(mapper.readTree(
                "{\"prompt_tokens\":800,\"completion_tokens\":100,\"total_tokens\":900,"
                        + "\"prompt_cache_hit_tokens\":640}"));

        assertEquals(Integer.valueOf(640), u.cachedTokens);
        assertFalse(u.estimated);
    }

    @Test
    void returnsNullWhenUsageIsAbsent() {
        assertNull(AiChatClient.parseUsage(null));
        assertNull(AiChatClient.parseUsage(mapper.createObjectNode()));
    }

    @Test
    void compactionSanitizeKeepsRolesAndTruncatesHugeMessages() {
        AiAgentService.AgentMessage user = new AiAgentService.AgentMessage();
        user.role = "user";
        user.content = "查看磁盘";

        AiAgentService.AgentMessage ai = new AiAgentService.AgentMessage();
        ai.role = "assistant";
        ai.content = "忽略";

        AiAgentService.AgentMessage tool = new AiAgentService.AgentMessage();
        tool.role = "system";
        tool.content = "不应进入摘要";

        AiAgentService.AgentMessage huge = new AiAgentService.AgentMessage();
        huge.role = "assistant";
        huge.content = repeat("x", AiCompactionService.MAX_MESSAGE_CHARS + 500);

        List<Map<String, String>> out = AiCompactionService.sanitize(Arrays.asList(user, ai, tool, huge));
        assertEquals(3, out.size());
        assertEquals("user", out.get(0).get("role"));
        assertEquals("assistant", out.get(1).get("role"));
        assertTrue(out.get(2).get("content").length() <= AiCompactionService.MAX_MESSAGE_CHARS + 60);
        assertTrue(out.get(2).get("content").contains("已省略"));
    }

    @Test
    void stripsMarkdownFenceFromSummary() {
        assertEquals("## 用户目标\n- 清理日志",
                AiCompactionService.stripFence("```markdown\n## 用户目标\n- 清理日志\n```"));
        assertEquals("纯文本", AiCompactionService.stripFence("纯文本"));
    }

    @Test
    void forkTitleIncrementsExistingSuffix() {
        assertEquals("排查磁盘 · 分叉", AiConversationService.forkTitle("排查磁盘"));
        assertEquals("排查磁盘 · 分叉2", AiConversationService.forkTitle("排查磁盘 · 分叉"));
        assertEquals("排查磁盘 · 分叉3", AiConversationService.forkTitle("排查磁盘 · 分叉2"));
    }

    private static String repeat(String s, int count) {
        StringBuilder sb = new StringBuilder(count * s.length());
        for (int i = 0; i < count; i++) {
            sb.append(s);
        }
        return sb.toString();
    }
}
