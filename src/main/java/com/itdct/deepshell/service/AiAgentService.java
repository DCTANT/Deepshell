package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.entity.SshConnection;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 终端代理：把对话交给大模型 → 解析为「执行命令」或「回复」→
 * 命令经独立 exec 通道以当前 SSH 用户执行并回传结果，前端循环推进直到任务完成
 */
@Slf4j
@Service
public class AiAgentService {

    /** 单条命令最长执行时间与最大捕获输出 */
    public static final int EXEC_TIMEOUT_MS = 120_000;
    public static final int MAX_OUTPUT_BYTES = 256 * 1024;

    /** 一次请求最多携带的历史消息数（50 步约产生 100 条，留足余量） */
    private static final int MAX_HISTORY = 160;
    private static final int MAX_CONTENT_CHARS = 12000;
    /** 单次请求的上下文字符预算：超出的更早消息会被舍弃，但保留当前任务原始描述 */
    private static final int MAX_TOTAL_CHARS = 180_000;
    /** 最近若干条消息保留完整内容，更早的工具输出做头尾压缩 */
    private static final int RECENT_FULL_MESSAGES = 8;
    private static final int OLD_TOOL_HEAD = 1800;
    private static final int OLD_TOOL_TAIL = 900;
    private static final String TOOL_RESULT_PREFIX = "[命令执行结果]";

    private final AiChatClient chatClient;
    private final SshSessionManager sessions;
    private final ConnectionService connections;
    private final AuditService audit;
    private final ObjectMapper mapper = new ObjectMapper();

    public AiAgentService(AiChatClient chatClient, SshSessionManager sessions,
                          ConnectionService connections, AuditService audit) {
        this.chatClient = chatClient;
        this.sessions = sessions;
        this.connections = connections;
        this.audit = audit;
    }

    public static class AgentMessage {
        public String role;
        public String content;
    }

    public static class AgentResult {
        /** "cmd"：命令（可能已执行/待确认）；"reply"：模型给用户的回复 */
        public String kind;
        public String text;
        public String command;
        public String note;
        /** true 表示未执行、等前端让用户确认（手动「每步确认」模式） */
        public boolean needConfirm;
        public boolean executed;
        public String output;
        public Integer exitCode;
        public String cwd;
        public boolean truncated;
        public boolean timedOut;
        /** 执行层失败时的原因（kind=cmd 且 executed=false 时展示） */
        public String error;
        /** 命令执行耗时（毫秒），用于结果卡片展示 */
        public Long durationMs;
        /** 本次模型调用的 token 用量；命令执行结果不包含 */
        public AiChatClient.Usage usage;
        /** 模型输出里只有无法解析的 DSML/工具调用标记 */
        public boolean dsmlUnrecognized;
        /** 模型只返回了思考过程或空正文，没有给出可执行命令 */
        public boolean reasoningOnly;
        /** 模型输出看起来是命令 JSON，但格式损坏到无法提取 cmd（会自动重试） */
        public boolean malformedCommand;
    }

    /** 一轮对话：调用模型并解析；auto=false 时命令不自动执行，auto=true 时高危命令仍需确认 */
    public AgentResult step(String sessionId, String cwd, boolean auto, List<AgentMessage> history) {
        SshSessionManager.SshSession s = sessions.get(sessionId);
        List<Map<String, String>> messages = sanitize(history);
        AiChatClient.ChatResult result = chatClient.completeDetailed(systemPrompt(s, cwd), messages);
        AgentResult r = handleContent(s, cwd, auto, result.text, new AiCancellationToken());
        r.usage = result.usage;
        return r;
    }

    /**
     * 一轮对话（流式）：模型输出边生成边通过 onTextDelta 推送可展示的回复文本；
     * 生成结束后的解析与命令执行结果与 {@link #step} 一致。
     */
    public AgentResult stepStream(String sessionId, String cwd, boolean auto, List<AgentMessage> history,
                                  Consumer<String> onTextDelta) {
        return stepStream(sessionId, cwd, auto, history, onTextDelta, new AiCancellationToken());
    }

    /**
     * 可取消的流式一轮对话：停止令牌置位后断开模型连接，
     * 并在解析/执行命令前再次检查，保证不会在用户停止后继续执行新命令。
     */
    public AgentResult stepStream(String sessionId, String cwd, boolean auto, List<AgentMessage> history,
                                  Consumer<String> onTextDelta, AiCancellationToken token) {
        return stepStream(sessionId, cwd, auto, history, onTextDelta, null, token);
    }

    /**
     * 可取消的流式一轮对话（含思考过程）：onReasoning 接收模型的 reasoning_content，
     * 前端可像 DeepSeek Harness 一样展示可折叠的思考过程。
     */
    public AgentResult stepStream(String sessionId, String cwd, boolean auto, List<AgentMessage> history,
                                  Consumer<String> onTextDelta, Consumer<String> onReasoning,
                                  AiCancellationToken token) {
        if (token.isCancelled()) {
            throw new AiCancellationToken.CancelledException();
        }
        SshSessionManager.SshSession s = sessions.get(sessionId);
        List<Map<String, String>> messages = sanitize(history);
        String system = systemPrompt(s, cwd);
        AiChatClient.ChatResult result = readModel(system, messages, onTextDelta, onReasoning, token);
        if (token.isCancelled()) {
            throw new AiCancellationToken.CancelledException();
        }
        AgentResult r = buildResult(s, cwd, auto, result, token);
        List<Map<String, String>> repairHistory = new ArrayList<>(messages);
        for (int attempt = 0; attempt < 2
                && (r.dsmlUnrecognized || r.reasoningOnly || r.malformedCommand)
                && !token.isCancelled(); attempt++) {
            // 模型没有给出可执行 JSON：把上一轮输出（含 reasoning）带回并要求改写，最多重试两次
            repairHistory.add(repairAssistant(result));
            Map<String, String> notice = new LinkedHashMap<>();
            notice.put("role", "user");
            notice.put("content", MODEL_REPAIR_PROMPT);
            repairHistory.add(notice);
            log.info("模型未给出可执行命令（dsml={}, reasoningOnly={}, malformedJson={}），自动要求改写 JSON（第 {} 次）",
                    r.dsmlUnrecognized, r.reasoningOnly, r.malformedCommand, attempt + 1);
            result = readModel(system, repairHistory, onTextDelta, onReasoning, token);
            if (token.isCancelled()) {
                throw new AiCancellationToken.CancelledException();
            }
            r = buildResult(s, cwd, auto, result, token);
        }
        if (r.dsmlUnrecognized || r.reasoningOnly || r.malformedCommand) {
            r.kind = "reply";
            r.text = r.malformedCommand
                    ? "模型返回的命令 JSON 格式不完整，已自动重试但仍无法解析。请重试或到 AI 设置中切换模型。"
                    : "模型连续多次只返回思考过程或无法解析的工具调用，未能给出可执行命令。"
                    + "请重试或到 AI 设置中切换模型。";
        }
        return r;
    }

    /** 把上一轮模型输出整理成 assistant 消息，供修复重试使用；只有 reasoning 时也带回去 */
    private static Map<String, String> repairAssistant(AiChatClient.ChatResult result) {
        String content = result.text == null ? "" : result.text;
        if (content.trim().isEmpty() && result.reasoning != null) {
            content = result.reasoning;
        }
        content = SYSTEM_BLOCK.matcher(content).replaceAll(" ").trim();
        content = SYSTEM_TAG.matcher(content).replaceAll(" ").trim();
        if (content.isEmpty()) {
            content = "（上一轮没有正文）";
        }
        if (content.length() > MAX_CONTENT_CHARS) {
            content = content.substring(0, MAX_CONTENT_CHARS);
        }
        Map<String, String> message = new LinkedHashMap<>();
        message.put("role", "assistant");
        message.put("content", content);
        return message;
    }

    /** 只有 <system> 标签或空白，没有实际内容 */
    private static boolean isMetaOnly(String text) {
        if (text == null) {
            return true;
        }
        String cleaned = SYSTEM_BLOCK.matcher(text).replaceAll(" ").trim();
        cleaned = SYSTEM_TAG.matcher(cleaned).replaceAll(" ").trim();
        return cleaned.isEmpty();
    }

    /** 流式读取一次模型输出；每次调用使用独立的展示累积器，修复重试时不会混入上一次的文本 */
    private AiChatClient.ChatResult readModel(String system, List<Map<String, String>> messages,
                                              Consumer<String> onTextDelta, Consumer<String> onReasoning,
                                              AiCancellationToken token) {
        final StringBuilder acc = new StringBuilder();
        final String[] shown = {""};
        return chatClient.streamDetailed(system, messages, delta -> {
            if (token.isCancelled()) {
                throw new AiCancellationToken.CancelledException();
            }
            acc.append(delta);
            String visible = visibleReplyText(acc.toString());
            if (visible.length() > shown[0].length() && visible.startsWith(shown[0])) {
                onTextDelta.accept(visible.substring(shown[0].length()));
                shown[0] = visible;
            }
        }, onReasoning, token);
    }

    /** 把一次模型输出解析成命令 / 回复，并处理只有 reasoning 的情况 */
    private AgentResult buildResult(SshSessionManager.SshSession s, String cwd, boolean auto,
                                    AiChatClient.ChatResult result, AiCancellationToken token) {
        AgentResult r = handleContent(s, cwd, auto, result.text, token);
        if ("reply".equals(r.kind) && isMetaOnly(r.text)) {
            // 模型把 <system>...</system> 当成回复：视为空正文，进入自动续写
            r.text = "";
        }
        if (!"cmd".equals(r.kind) && !r.needConfirm) {
            String reasoning = result.reasoning == null ? "" : result.reasoning.trim();
            // 部分模型会把 DSML 工具调用只写在 reasoning_content 里：正文没有命令时从思考过程补解析
            if (!reasoning.isEmpty() && dsmlParameter(reasoning, "cmd") != null) {
                AgentResult fromReasoning = handleContent(s, cwd, auto, reasoning, token);
                if ("cmd".equals(fromReasoning.kind) || fromReasoning.needConfirm) {
                    r = fromReasoning;
                }
            }
            if ("reply".equals(r.kind) && (r.text == null || r.text.trim().isEmpty())) {
                r.reasoningOnly = true;
                if (!reasoning.isEmpty()) {
                    r.text = "模型只返回了思考过程，没有可执行命令。请点击重试。";
                }
            }
        }
        r.usage = result.usage;
        return r;
    }

    /** 把模型输出解析为回复或命令，并按自动模式策略执行 */
    private AgentResult handleContent(SshSessionManager.SshSession s, String cwd, boolean auto,
                                      String content, AiCancellationToken token) {
        Parsed parsed = parse(content);

        AgentResult r = new AgentResult();
        r.dsmlUnrecognized = parsed.dsmlUnrecognized;
        r.malformedCommand = parsed.malformedCommand;
        if (parsed.command != null && !parsed.command.isEmpty()) {
            r.kind = "cmd";
            r.command = parsed.command;
            r.note = parsed.note;
            if (token.isCancelled()) {
                r.kind = "reply";
                r.text = "已停止";
                return r;
            }
            if (!auto) {
                r.needConfirm = true;
                audit.record("AI_COMMAND", parsed.command, "CONFIRM", "手动确认模式");
                return r;
            }
            fillExec(r, s, parsed.command, cwd, token);
            return r;
        }
        r.kind = "reply";
        r.text = parsed.malformedCommand
                ? "模型返回的命令格式不完整，正在自动重试…"
                : (parsed.reply == null || parsed.reply.isEmpty() ? content : parsed.reply);
        return r;
    }

    /** 用户确认（或手动模式放行）后执行指定命令 */
    public AgentResult exec(String sessionId, String cwd, String command) {
        return exec(sessionId, cwd, command, new AiCancellationToken());
    }

    /** 可取消的命令执行：停止令牌置位后断开 exec 通道 */
    public AgentResult exec(String sessionId, String cwd, String command, AiCancellationToken token) {
        if (command == null || command.trim().isEmpty()) {
            throw new IllegalArgumentException("缺少要执行的命令");
        }
        SshSessionManager.SshSession s = sessions.get(sessionId);
        AgentResult r = new AgentResult();
        r.kind = "cmd";
        r.command = command.trim();
        fillExec(r, s, r.command, cwd, token);
        return r;
    }

    private void fillExec(AgentResult r, SshSessionManager.SshSession s, String command,
                          String cwd, AiCancellationToken token) {
        if (token.isCancelled()) {
            r.executed = false;
            r.error = "已停止";
            audit.record("AI_COMMAND", command, "CANCELLED", "用户停止");
            return;
        }
        long startedAt = System.nanoTime();
        try {
            SshSessionManager.ExecResult res =
                    sessions.execInShell(s, command, cwd, EXEC_TIMEOUT_MS, MAX_OUTPUT_BYTES,
                            token::isCancelled);
            r.durationMs = Math.max(0, (System.nanoTime() - startedAt) / 1_000_000);
            r.executed = true;
            r.output = cleanTerminalText(res.output);
            r.exitCode = res.exitCode;
            r.cwd = res.cwd;
            r.truncated = res.truncated;
            r.timedOut = res.timedOut;
            if (res.cancelled || token.isCancelled()) {
                r.error = "已停止";
                audit.record("AI_COMMAND", command, "CANCELLED", "用户停止");
                return;
            }
            audit.record("AI_COMMAND", command,
                    r.exitCode != null && r.exitCode != 0 ? "FAIL" : "OK",
                    "exit=" + r.exitCode + (r.timedOut ? " timeout" : ""));
        } catch (Exception e) {
            r.durationMs = Math.max(0, (System.nanoTime() - startedAt) / 1_000_000);
            if (token.isCancelled()) {
                r.executed = false;
                r.error = "已停止";
                audit.record("AI_COMMAND", command, "CANCELLED", "用户停止");
                return;
            }
            log.warn("AI 终端命令执行失败: {}", e.toString());
            r.executed = false;
            r.error = "命令执行失败：" + e.getMessage();
            audit.record("AI_COMMAND", command, "FAIL", r.error);
        }
    }

    /* ---------- 系统提示词 / 模型输出解析 ---------- */

    private String systemPrompt(SshSessionManager.SshSession s, String cwd) {
        String user = "";
        String host = "";
        try {
            SshConnection cfg = connections.get(s.getConnectionId());
            user = cfg.getUsername();
            host = cfg.getHost();
        } catch (Exception ignore) {
            // 连接配置读不到时只少展示身份信息
        }
        StringBuilder sb = new StringBuilder();
        sb.append("你是 DeepShell 内置的 AI 运维助手，正通过 SSH 以用户 ").append(user).append("@").append(host)
                .append(" 的身份操作远程 Linux 服务器。用户可以自然描述需求，你负责一步步执行 shell 命令帮他完成。\n\n")
                .append("输出要求（必须严格遵守，不要输出任何多余内容）：\n")
                .append("- 需要执行命令时，只输出一个 JSON 对象：{\"cmd\":\"要执行的命令\",\"note\":\"一句话说明\"}\n")
                .append("- 任务完成、需要说明结果或需要向用户确认/提问时，直接输出展示给用户的 Markdown 内容，不要包成 JSON。\n")
                .append("- 需要执行命令时不要用 markdown 代码块包裹 JSON，直接输出 JSON 本身。\n")
                .append("- 普通回复直接输出 Markdown；需要命令时只输出约定的 JSON。不要输出 tool_calls、function_call、<system> 或任何 XML / 协议包装。\n\n")
                .append("工作方式：\n")
                .append("- 每次只提交一条命令，等执行结果返回后再决定下一步；不要臆测命令输出。\n")
                .append("- 先观察再行动：修改、删除或重启前，先用只读命令确认当前状态，优先使用保守写法。\n")
                .append("- 达到目标后及时收尾，直接输出一段简洁的 Markdown 总结：做了什么、结果如何、还需要用户注意什么。\n")
                .append("- 缺少关键信息时，直接向用户提问并暂停执行，不要盲目尝试。\n\n")
                .append("环境说明：\n")
                .append("- 每次都是完整的 Linux 环境，命令以当前登录用户身份执行，非 root 时注意权限。\n")
                .append("- 每条命令在独立 shell 中执行：cd 切换的目录会被系统自动保留，但 export 的环境变量与别名不会保留；"
                        + "需要时把多条命令用 && 或 ; 连成一条。\n")
                .append("- 命令必须是非交互的，禁止执行需要人工输入的程序（如 vi、top、不带参数的 passwd）；"
                        + "sudo 通常没有免密，权限不足时如实向用户说明，不要反复重试。\n")
                .append("- 输出过长会被截断，请用 head/tail/grep 等控制输出量；命令结果已展示给用户，不要在 reply 里重复大段输出。\n")
                .append("- note 与普通回复用简洁中文，不要使用 emoji；普通回复可以用简短 Markdown（列表、加粗、行内代码、代码块），"
                        + "让结论更易读。");
        if (cwd != null && !cwd.trim().isEmpty()) {
            sb.append("\n- 当前工作目录：").append(cwd.trim());
        }
        return sb.toString();
    }

    private static class Parsed {
        String command;
        String note;
        String reply;
        boolean dsmlUnrecognized;
        boolean malformedCommand;
    }

    /**
     * 从流式累积的模型输出中提取「可以立刻展示」的回复文本：
     * 模型按要求输出 JSON，这里在 reply 字段尚未输出完整时就逐段解码，供前端打字机式展示；
     * 命令类输出（cmd）不展示原始 JSON，等生成结束后由前端画命令卡片。
     */
    static String visibleReplyText(String content) {
        if (content == null || content.isEmpty()) {
            return "";
        }
        if (containsDsml(content)) {
            return "";
        }
        String reply = partialJsonString(content, "reply");
        if (reply != null) {
            return reply;
        }
        if (content.indexOf("\"cmd\"") >= 0) {
            return "";
        }
        String t = stripLeadingFence(content);
        // 看起来是 JSON 但关键字段还没出现时先不展示，避免闪出 {"re
        if (t.trim().startsWith("{")) {
            return "";
        }
        return t;
    }

    /** 解析 JSON 字符串字段的当前前缀（流式场景下引号 / 转义可能尚未闭合） */
    static String partialJsonString(String content, String key) {
        String token = "\"" + key + "\"";
        int at = content.indexOf(token);
        if (at < 0) {
            return null;
        }
        int colon = content.indexOf(':', at + token.length());
        if (colon < 0) {
            return null;
        }
        int i = colon + 1;
        while (i < content.length() && Character.isWhitespace(content.charAt(i))) {
            i++;
        }
        if (i >= content.length()) {
            return "";
        }
        if (content.charAt(i) != '"') {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        for (int j = i + 1; j < content.length(); j++) {
            char c = content.charAt(j);
            if (c == '\\') {
                if (j + 1 >= content.length()) {
                    break;
                }
                char e = content.charAt(++j);
                switch (e) {
                    case 'n':
                        sb.append('\n');
                        break;
                    case 't':
                        sb.append('\t');
                        break;
                    case 'r':
                        sb.append('\r');
                        break;
                    case 'b':
                        sb.append('\b');
                        break;
                    case 'f':
                        sb.append('\f');
                        break;
                    case '"':
                    case '\\':
                    case '/':
                        sb.append(e);
                        break;
                    case 'u':
                        if (j + 4 >= content.length()) {
                            return sb.toString();
                        }
                        try {
                            sb.append((char) Integer.parseInt(content.substring(j + 1, j + 5), 16));
                        } catch (NumberFormatException ex) {
                            return sb.toString();
                        }
                        j += 4;
                        break;
                    default:
                        sb.append(e);
                }
            } else if (c == '"') {
                return sb.toString();
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /**
     * 宽松提取 JSON 里的 reply：模型偶尔输出带真实换行的“漂亮 JSON”，标准解析会失败。
     * 字符串内允许真实换行；未转义引号只有在后面紧跟 , 或 } 时才视为字段结束。
     */
    static String lenientJsonReply(String content) {
        return lenientJsonField(content, "reply");
    }

    /** 宽松提取命令：只有 cmd 字符串正常闭合才返回，避免把被截断的半条命令直接执行 */
    static String lenientJsonCommand(String content) {
        return lenientJsonField(content, "cmd", true);
    }

    /**
     * 宽松提取 JSON 字符串字段：允许字符串里有真实换行、未转义引号，
     * 也兼容模型漏掉字符串末尾引号（例如 {"cmd":"ls","note":"查看目录}）。
     */
    static String lenientJsonField(String content, String key) {
        return lenientJsonField(content, key, false);
    }

    private static String lenientJsonField(String content, String key, boolean requireClosed) {
        if (content == null || key == null || key.isEmpty()) {
            return null;
        }
        int keyAt = content.indexOf("\"" + key + "\"");
        if (keyAt < 0) {
            return null;
        }
        int colon = content.indexOf(':', keyAt + key.length() + 2);
        if (colon < 0) {
            return null;
        }
        int start = colon + 1;
        while (start < content.length() && Character.isWhitespace(content.charAt(start))) {
            start++;
        }
        if (start >= content.length() || content.charAt(start) != '"') {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        boolean unescapedQuote = false;
        for (int i = start + 1; i < content.length(); i++) {
            char c = content.charAt(i);
            if (c == '\\' && i + 1 < content.length()) {
                char e = content.charAt(++i);
                switch (e) {
                    case 'n':
                        sb.append('\n');
                        break;
                    case 'r':
                        sb.append('\r');
                        break;
                    case 't':
                        sb.append('\t');
                        break;
                    case 'b':
                        sb.append('\b');
                        break;
                    case 'f':
                        sb.append('\f');
                        break;
                    case '"':
                    case '\\':
                    case '/':
                        sb.append(e);
                        break;
                    case 'u':
                        if (i + 4 < content.length()) {
                            try {
                                sb.append((char) Integer.parseInt(content.substring(i + 1, i + 5), 16));
                                i += 4;
                            } catch (NumberFormatException ex) {
                                sb.append('u');
                            }
                        } else {
                            sb.append('u');
                        }
                        break;
                    default:
                        sb.append(e);
                }
                continue;
            }
            if (c == '"') {
                int j = i + 1;
                while (j < content.length() && Character.isWhitespace(content.charAt(j))) {
                    j++;
                }
                if (j >= content.length() || content.charAt(j) == ',' || content.charAt(j) == '}') {
                    // 命令里出现未转义引号说明 JSON 本身已损坏，不能按截断后的命令执行
                    return requireClosed && unescapedQuote ? null : sb.toString();
                }
                sb.append('"');
                unescapedQuote = true;
                continue;
            }
            sb.append(c);
        }
        if (requireClosed) {
            return null;
        }
        // 缺少收尾引号：把被吞进字符串值的对象右括号去掉
        int end = sb.length();
        while (end > 0 && Character.isWhitespace(sb.charAt(end - 1))) {
            end--;
        }
        if (end > 0 && sb.charAt(end - 1) == '}') {
            end--;
        }
        while (end > 0 && Character.isWhitespace(sb.charAt(end - 1))) {
            end--;
        }
        sb.setLength(end);
        return sb.length() > 0 ? sb.toString() : null;
    }

    /** 去掉模型可能加在开头的 markdown 代码围栏 */
    static String stripLeadingFence(String content) {
        String t = content;
        if (!t.isEmpty() && t.charAt(0) == '\uFEFF') {
            t = t.substring(1);
        }
        String stripped = t.replaceFirst("^\\s*```[a-zA-Z0-9_-]*[ \\t]*\\r?\\n", "");
        if (!stripped.equals(t)) {
            return stripped.replaceFirst("\\s*```\\s*$", "");
        }
        if (t.trim().startsWith("```")) {
            return "";
        }
        return t;
    }

    /** 解析模型输出：优先 JSON 的 cmd / reply；兼容 DeepSeek Harness 风格的 DSML 工具调用 */
    private Parsed parse(String content) {
        Parsed p = new Parsed();
        String raw = content == null ? "" : content.trim();
        String t = raw;
        if (t.startsWith("```")) {
            int nl = t.indexOf('\n');
            if (nl > 0) {
                t = t.substring(nl + 1);
            }
            if (t.endsWith("```")) {
                t = t.substring(0, t.length() - 3);
            }
            t = t.trim();
        }
        int a = t.indexOf('{');
        int b = t.lastIndexOf('}');
        if (a >= 0 && b > a) {
            try {
                JsonNode n = mapper.readTree(t.substring(a, b + 1));
                String cmd = n.path("cmd").asText("").trim();
                String note = n.path("note").asText("").trim();
                String reply = n.path("reply").asText("").trim();
                if (!cmd.isEmpty()) {
                    p.command = cmd;
                    p.note = note;
                    return p;
                }
                if (!reply.isEmpty()) {
                    p.reply = reply;
                    return p;
                }
            } catch (Exception ignore) {
                // 非 JSON，继续尝试 DSML
            }
        }
        if (t.trim().startsWith("{")) {
            // 模型偶尔输出带真实换行/未转义引号或漏掉收尾引号的“漂亮 JSON”，宽松提取命令字段
            int cmdAt = t.indexOf("\"cmd\"");
            int replyAt = t.indexOf("\"reply\"");
            boolean commandFirst = cmdAt >= 0 && (replyAt < 0 || cmdAt < replyAt);
            if (commandFirst) {
                String lenientCmd = lenientJsonCommand(t);
                if (lenientCmd != null && !lenientCmd.trim().isEmpty()) {
                    p.command = lenientCmd.trim();
                    String lenientNote = lenientJsonField(t, "note");
                    p.note = lenientNote == null ? "" : lenientNote.trim();
                    return p;
                }
            }
            // 普通回复的 JSON 包裹同样宽松解析
            String lenientReply = lenientJsonReply(t);
            if (lenientReply != null && !lenientReply.trim().isEmpty()) {
                p.reply = lenientReply.trim();
                return p;
            }
            if (commandFirst) {
                p.malformedCommand = true;
                return p;
            }
        }
        String dsmlCmd = dsmlParameter(t, "cmd");
        if (dsmlCmd != null && !dsmlCmd.trim().isEmpty()) {
            p.command = dsmlCmd.trim();
            String dsmlNote = dsmlParameter(t, "note");
            p.note = dsmlNote == null ? "" : dsmlNote.trim();
            return p;
        }
        if (containsDsml(t)) {
            p.dsmlUnrecognized = true;
            p.reply = "模型返回了未识别的 DSML 工具调用格式，本轮已停止。请点击重试，或到 AI 设置中切换模型后再试。";
            return p;
        }
        p.reply = raw;
        return p;
    }

    /* ---------- DSML 工具调用格式兼容 ---------- */

    /** DSML / DSLM 标记：兼容两种拼写、单双竖线，以及模型 token 之间的空格 */
    private static final String DSML_MARK_BODY =
            "\\|\\s*\\|?\\s*DS(?:LM|ML)\\s*\\|\\s*\\|?\\s*";

    /** 模型有时会把 <system>...</system> 之类的系统消息当正文/思考输出 */
    private static final Pattern SYSTEM_BLOCK = Pattern.compile(
            "<\\s*\\|?\\s*system\\s*\\|?\\s*>[\\s\\S]*?<\\s*/\\s*\\|?\\s*system\\s*\\|?\\s*>",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern SYSTEM_TAG = Pattern.compile(
            "<\\s*/?\\s*\\|?\\s*system\\s*\\|?\\s*>", Pattern.CASE_INSENSITIVE);

    /** 无法解析 DSML 或只有思考过程时自动发给模型，让它继续输出约定的 JSON */
    private static final String MODEL_REPAIR_PROMPT =
            "你上一条没有给出可执行的 JSON（可能只输出了思考过程，或工具调用格式无法解析）。"
                    + "请基于当前任务继续，只输出以下两种 JSON 之一：\n"
                    + "1. 需要执行命令：{\"cmd\":\"要执行的命令\",\"note\":\"一句话说明\"}\n"
                    + "2. 任务完成 / 不需要命令：{\"reply\":\"给用户的回复\"}\n"
                    + "不要输出任何 XML、DSML、<parameter>、<system> 标签，不要扮演系统消息，也不要只输出思考过程。";

    private static final Pattern DSML_PARAMETER = Pattern.compile(
            "<\\s*(?:" + DSML_MARK_BODY + ")?parameter\\b([^>]*)>(.*?)"
                    + "</\\s*(?:" + DSML_MARK_BODY + ")?parameter\\s*>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private static final Pattern DSML_NAME_CMD = Pattern.compile(
            "name\\s*=\\s*[\"'](?:cmd|command)[\"']", Pattern.CASE_INSENSITIVE);

    private static final Pattern DSML_NAME_NOTE = Pattern.compile(
            "name\\s*=\\s*[\"']note[\"']", Pattern.CASE_INSENSITIVE);

    private static final Pattern DSML_MARKER = Pattern.compile(
            "<\\s*" + DSML_MARK_BODY, Pattern.CASE_INSENSITIVE);

    /** 部分模型会把 DSML 退化成裸 <parameter> / <invoke>，没有外层 marker */
    private static final Pattern BARE_DSML_TAG = Pattern.compile(
            "<\\s*/?\\s*(?:parameter|invoke)\\b", Pattern.CASE_INSENSITIVE);

    static boolean containsDsml(String content) {
        String normalized = normalizeDsml(content);
        if (normalized == null || normalized.isEmpty()) {
            return false;
        }
        return DSML_MARKER.matcher(normalized).find() || BARE_DSML_TAG.matcher(normalized).find();
    }

    /** 部分中文模型会把 | < > 等写成全角字符，解析前统一成 ASCII */
    private static String normalizeDsml(String content) {
        if (content == null) {
            return null;
        }
        return content
                .replace('\uFF5C', '|')  // ｜
                .replace('\uFF1C', '<')  // ＜
                .replace('\uFF1E', '>')  // ＞
                .replace('\u3000', ' ')  // 全角空格
                .replace('\uFF02', '"')  // ＂
                .replace('\uFF07', '\''); // ＇
    }

    /** 从 DSML 参数块中提取 cmd / note；未闭合或不是 DSML 时返回 null */
    static String dsmlParameter(String content, String name) {
        String normalized = normalizeDsml(content);
        if (normalized == null || normalized.isEmpty()) {
            return null;
        }
        Pattern namePattern = "cmd".equals(name) ? DSML_NAME_CMD : DSML_NAME_NOTE;
        Matcher matcher = DSML_PARAMETER.matcher(normalized);
        while (matcher.find()) {
            if (!namePattern.matcher(matcher.group(1)).find()) {
                continue;
            }
            String value = matcher.group(2);
            return unescapeXml(value == null ? "" : value.trim());
        }
        return null;
    }

    private static String unescapeXml(String s) {
        return s.replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&apos;", "'")
                .replace("&#39;", "'")
                .replace("&amp;", "&");
    }

    /* ---------- 杂项 ---------- */

    /**
     * 把前端传来的完整历史整理成模型请求：限制单条长度与总量，最近的工具输出保留完整内容，
     * 更早的输出做头尾压缩；即使超预算也会保留「当前任务」的原始用户描述与最后一条消息。
     */
    private List<Map<String, String>> sanitize(List<AgentMessage> history) {
        if (history == null || history.isEmpty()) {
            throw new IllegalArgumentException("缺少对话内容");
        }
        List<Map<String, String>> all = new ArrayList<>();
        for (int i = 0; i < history.size(); i++) {
            AgentMessage m = history.get(i);
            if (m == null) {
                continue;
            }
            String role = m.role == null ? "user" : m.role.trim();
            if (!"user".equals(role) && !"assistant".equals(role)) {
                continue;
            }
            String c = m.content == null ? "" : m.content;
            if (c.length() > MAX_CONTENT_CHARS) {
                c = c.substring(0, MAX_CONTENT_CHARS) + "\n…（已截断）";
            }
            if (i < history.size() - RECENT_FULL_MESSAGES && isToolMessage(c)
                    && c.length() > OLD_TOOL_HEAD + OLD_TOOL_TAIL + 200) {
                c = c.substring(0, OLD_TOOL_HEAD)
                        + "\n…（较早的命令输出已压缩）…\n"
                        + c.substring(c.length() - OLD_TOOL_TAIL);
            }
            Map<String, String> map = new LinkedHashMap<>();
            map.put("role", role);
            map.put("content", c);
            all.add(map);
        }
        if (all.isEmpty() || !"user".equals(all.get(all.size() - 1).get("role"))) {
            throw new IllegalArgumentException("对话内容不完整");
        }

        // 当前任务的原始描述（最后一条非「工具结果」的用户消息），超预算时也要保留
        int taskIdx = -1;
        for (int i = all.size() - 1; i >= 0; i--) {
            if ("user".equals(all.get(i).get("role")) && !isToolMessage(all.get(i).get("content"))) {
                taskIdx = i;
                break;
            }
        }

        int start = Math.max(0, all.size() - MAX_HISTORY);
        int from = all.size();
        int total = 0;
        for (int i = all.size() - 1; i >= start; i--) {
            int len = all.get(i).get("content").length();
            if (total > 0 && total + len > MAX_TOTAL_CHARS) {
                break;
            }
            total += len;
            from = i;
        }
        // 避免从一条「命令执行结果」开始：把对应的 assistant 命令一起带上
        while (from > start && from < all.size() && isToolMessage(all.get(from).get("content"))) {
            from--;
        }

        List<Map<String, String>> out = new ArrayList<>(all.subList(from, all.size()));
        if (taskIdx >= 0 && taskIdx < from) {
            out.add(0, all.get(taskIdx));
        }
        if (out.isEmpty() || !"user".equals(out.get(out.size() - 1).get("role"))) {
            throw new IllegalArgumentException("对话内容不完整");
        }
        return out;
    }

    /** 前端生成的「工具结果」消息（命令输出 / 跳过说明 / 继续指令） */
    private static boolean isToolMessage(String content) {
        if (content == null) {
            return false;
        }
        return content.startsWith(TOOL_RESULT_PREFIX)
                || content.startsWith("（用户跳过了这条命令）")
                || content.startsWith("（继续）");
    }

    /** 清理终端控制序列（ANSI 转义、孤立回车），便于展示与回传给模型 */
    public static String cleanTerminalText(String s) {
        if (s == null || s.isEmpty()) {
            return "";
        }
        String t = s.replaceAll("\u001B\\][^\u0007\u001B]*(?:\u0007|\u001B\\\\)", "");
        t = t.replaceAll("\u001B\\[[0-9;?]*[ -/]*[@-~]", "");
        t = t.replaceAll("\u001B[a-zA-Z]", "");
        t = t.replace("\r\n", "\n").replace("\r", "");
        return t;
    }
}
