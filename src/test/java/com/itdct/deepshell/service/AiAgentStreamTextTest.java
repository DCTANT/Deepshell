package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** 流式输出增量解析：模型分片到达时，只把可展示的 reply 文本推给前端 */
class AiAgentStreamTextTest {

    @Test
    void emitsReplyTextIncrementally() {
        assertEquals("你好，世界！", streamed(new String[]{
                "{", "\"reply\"", ":\"", "你好", "，世界", "！\"", "}"}));
    }

    @Test
    void handlesEscapesAndUnicodeSplitAcrossChunks() {
        String content = "{\"reply\":\"A\\nB \\u4e2d\\u6587 \\\"q\\\"\"}";
        String[] chunks = new String[content.length()];
        for (int i = 0; i < content.length(); i++) {
            chunks[i] = content.substring(i, i + 1);
        }
        assertEquals("A\nB 中文 \"q\"", streamed(chunks));
    }

    @Test
    void doesNotLeakCommandJson() {
        assertEquals("", streamed(new String[]{"{\"cmd\":\"ls -la\",\"note\":\"查看目录\"}"}));
        assertEquals("", streamed(new String[]{"```json\n", "{\"cmd\":\"df -h\"", ",\"note\":\"磁盘\"}"}));
    }

    @Test
    void fallsBackToPlainTextAndStripsFence() {
        assertEquals("当前磁盘正常，无需处理。", streamed(new String[]{"当前磁盘正常，", "无需处理。"}));
        assertEquals("一切正常", streamed(new String[]{"```", "\n", "一切正常", "\n```"}));
    }

    @Test
    void matchesFinalJsonValue() {
        assertEquals("你好，世界！",
                AiAgentService.partialJsonString("{\"reply\":\"你好，世界！\"}", "reply"));
        assertEquals("磁盘",
                AiAgentService.partialJsonString("{\"cmd\":\"df -h\",\"note\":\"磁盘\"}", "note"));
    }

    /** 按分片累积，模拟 stepStream 中「只推送新增前缀」的逻辑 */
    private static String streamed(String[] chunks) {
        StringBuilder acc = new StringBuilder();
        StringBuilder emitted = new StringBuilder();
        String shown = "";
        for (String chunk : chunks) {
            acc.append(chunk);
            String visible = AiAgentService.visibleReplyText(acc.toString());
            if (visible.length() > shown.length() && visible.startsWith(shown)) {
                emitted.append(visible.substring(shown.length()));
                shown = visible;
            }
        }
        return emitted.toString();
    }
}
