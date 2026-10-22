package com.itdct.deepshell.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 上下文压缩：把较早的对话交给模型生成结构化检查点，供前端用摘要替换旧消息。
 * 参考 DeepSeek Harness 的 compaction checkpoint 结构，保留目标、命令结果、错误和下一步等关键信息。
 */
@Service
public class AiCompactionService {

    /** 单条历史消息进入摘要请求前的长度上限 */
    static final int MAX_MESSAGE_CHARS = 12_000;
    /** 摘要请求的总字符预算，避免压缩调用本身就超出模型窗口 */
    static final int MAX_TOTAL_CHARS = 120_000;

    static final String SYSTEM_PROMPT = String.join("\n",
            "你是 DeepShell 的上下文压缩引擎。请把用户提供的对话历史压缩成一份结构化检查点，",
            "让后续模型在不看到原始对话的情况下继续完成运维任务。",
            "",
            "输出要求：",
            "- 只输出 Markdown 检查点，不要寒暄、不要解释压缩过程、不要调用工具。",
            "- 保持以下章节顺序，全部保留；没有内容的章节写“（无）”。",
            "- 使用简洁的中文要点，不要长篇复述。",
            "- 精确保留：主机 / 用户 / 路径 / 命令 / 退出码 / 报错原文 / 关键数字 / 用户明确偏好。",
            "- 如果对话中已经包含“此前对话的压缩摘要”，把其中仍然有效的信息合并进来，丢弃过时内容。",
            "- 不要虚构没有出现过的信息，不要输出大段原始日志。",
            "- 全文控制在 2000 字以内。",
            "",
            "## 用户目标与最新要求",
            "## 环境与关键约束",
            "## 已执行命令与结果",
            "## 关键文件与路径",
            "## 错误与修复",
            "## 当前进度",
            "## 下一步",
            "## 重要上下文");

    private final AiChatClient chatClient;
    private final AuditService audit;

    public AiCompactionService(AiChatClient chatClient, AuditService audit) {
        this.chatClient = chatClient;
        this.audit = audit;
    }

    public static class CompactResult {
        public String summary;
        public int messageCount;
        public int beforeChars;
        public AiChatClient.Usage usage;
    }

    public CompactResult compact(List<AiAgentService.AgentMessage> messages, String cwd) {
        if (messages == null || messages.size() < 2) {
            throw new IllegalArgumentException("对话还不够长，暂时不需要压缩");
        }
        List<Map<String, String>> history = sanitize(messages);
        if (history.size() < 2) {
            throw new IllegalArgumentException("没有可压缩的有效对话内容");
        }
        if ("assistant".equals(history.get(0).get("role"))) {
            history.add(0, message("user", "以下是一段需要压缩的 AI 终端对话历史，请按系统提示生成检查点。"));
        }
        int beforeChars = 0;
        for (Map<String, String> m : history) {
            beforeChars += m.getOrDefault("content", "").length();
        }

        List<Map<String, String>> request = new ArrayList<>(history);
        StringBuilder instruction = new StringBuilder();
        instruction.append("请把以上对话压缩成结构化检查点。严格按照系统提示中的模板输出，不要输出模板之外的任何内容。");
        if (cwd != null && !cwd.trim().isEmpty()) {
            instruction.append("\n当前工作目录：").append(cwd.trim());
        }
        request.add(message("user", instruction.toString()));

        AiChatClient.ChatResult result = chatClient.completeDetailed(SYSTEM_PROMPT, request);
        String summary = stripFence(result.text);
        if (summary.isEmpty()) {
            throw new IllegalStateException("模型未生成有效的压缩摘要，请重试");
        }
        CompactResult out = new CompactResult();
        out.summary = summary;
        out.messageCount = messages.size();
        out.beforeChars = beforeChars;
        out.usage = result.usage;
        audit.record("AI_CONTEXT_COMPACT", "AI 终端上下文", "OK",
                "压缩 " + messages.size() + " 条消息，摘要 " + summary.length() + " 字");
        return out;
    }

    /** 只保留 user / assistant；单条头尾截断，总量超预算时保留开头目标与最近进展 */
    static List<Map<String, String>> sanitize(List<AiAgentService.AgentMessage> messages) {
        List<Map<String, String>> all = new ArrayList<>();
        for (AiAgentService.AgentMessage m : messages) {
            if (m == null) {
                continue;
            }
            String role = m.role == null ? "" : m.role.trim();
            if (!"user".equals(role) && !"assistant".equals(role)) {
                continue;
            }
            String content = m.content == null ? "" : m.content;
            if (content.trim().isEmpty()) {
                continue;
            }
            if (content.length() > MAX_MESSAGE_CHARS) {
                int head = MAX_MESSAGE_CHARS * 3 / 4;
                int tail = MAX_MESSAGE_CHARS - head;
                content = content.substring(0, head)
                        + "\n…（中间内容过长，已省略 " + (content.length() - MAX_MESSAGE_CHARS) + " 字）…\n"
                        + content.substring(content.length() - tail);
            }
            all.add(message(role, content));
        }
        int total = 0;
        for (Map<String, String> m : all) {
            total += m.get("content").length();
        }
        if (total <= MAX_TOTAL_CHARS || all.size() <= 2) {
            return all;
        }
        int headBudget = MAX_TOTAL_CHARS / 5;
        int tailBudget = MAX_TOTAL_CHARS - headBudget;
        List<Map<String, String>> out = new ArrayList<>();
        int used = 0;
        for (int i = 0; i < all.size(); i++) {
            Map<String, String> m = all.get(i);
            int len = m.get("content").length();
            if (used + len > headBudget) {
                break;
            }
            out.add(m);
            used += len;
        }
        List<Map<String, String>> tail = new ArrayList<>();
        used = 0;
        for (int i = all.size() - 1; i >= 0; i--) {
            Map<String, String> m = all.get(i);
            int len = m.get("content").length();
            if (used + len > tailBudget) {
                break;
            }
            tail.add(0, m);
            used += len;
        }
        out.add(message("user", "【为控制摘要请求的长度，中间部分较早对话已省略，以下保留最近进展】"));
        out.addAll(tail);
        return out;
    }

    static String stripFence(String raw) {
        String t = raw == null ? "" : raw.trim();
        if (!t.startsWith("```")) {
            return t;
        }
        int nl = t.indexOf('\n');
        if (nl >= 0) {
            t = t.substring(nl + 1);
        }
        if (t.endsWith("```")) {
            t = t.substring(0, t.length() - 3);
        }
        return t.trim();
    }

    private static Map<String, String> message(String role, String content) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("role", role);
        m.put("content", content);
        return m;
    }
}
