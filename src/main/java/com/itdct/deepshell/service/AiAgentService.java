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
        /** true 表示未执行、等前端让用户确认（高危命令或手动模式） */
        public boolean needConfirm;
        /** 高危原因，如「递归删除（rm -r / -rf）」 */
        public String danger;
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
        final StringBuilder acc = new StringBuilder();
        final String[] shown = {""};
        AiChatClient.ChatResult result = chatClient.streamDetailed(systemPrompt(s, cwd), messages, delta -> {
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
        if (token.isCancelled()) {
            throw new AiCancellationToken.CancelledException();
        }
        AgentResult r = handleContent(s, cwd, auto, result.text, token);
        if (!"cmd".equals(r.kind) && !r.needConfirm) {
            String reasoning = result.reasoning == null ? "" : result.reasoning.trim();
            // 部分模型会把 DSML 工具调用只写在 reasoning_content 里：正文没有命令时从思考过程补解析
            if (!reasoning.isEmpty() && dsmlParameter(reasoning, "cmd") != null) {
                AgentResult fromReasoning = handleContent(s, cwd, auto, reasoning, token);
                if ("cmd".equals(fromReasoning.kind) || fromReasoning.needConfirm) {
                    r = fromReasoning;
                }
            }
            if ("reply".equals(r.kind) && (r.text == null || r.text.trim().isEmpty())
                    && !reasoning.isEmpty()) {
                r.text = "模型只返回了思考过程，没有可执行命令。请点击重试。";
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
        if (parsed.command != null && !parsed.command.isEmpty()) {
            r.kind = "cmd";
            r.command = parsed.command;
            r.note = parsed.note;
            if (token.isCancelled()) {
                r.kind = "reply";
                r.text = "已停止";
                return r;
            }
            String danger = dangerReason(parsed.command);
            if (danger != null) {
                r.needConfirm = true;
                r.danger = danger;
                audit.record("AI_COMMAND", parsed.command, "CONFIRM", "待确认：" + danger);
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
        r.text = parsed.reply == null || parsed.reply.isEmpty() ? content : parsed.reply;
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
                .append("- 任务完成、需要说明结果或需要向用户确认/提问时，输出：{\"reply\":\"展示给用户的内容\"}\n")
                .append("- 不要用 markdown 代码块包裹 JSON，直接输出 JSON 本身。\n")
                .append("- 只输出上面约定的 JSON，不要输出 tool_calls、function_call 或任何 XML / 协议包装；"
                        + "即使你的训练数据习惯使用其他工具调用格式，也必须改写成上面的 JSON。\n\n")
                .append("工作方式：\n")
                .append("- 每次只提交一条命令，等执行结果返回后再决定下一步；不要臆测命令输出。\n")
                .append("- 先观察再行动：修改、删除或重启前，先用只读命令确认当前状态，优先使用保守写法。\n")
                .append("- 达到目标后及时收尾，用 reply 简要总结做了什么、结果如何、还需要用户注意什么。\n")
                .append("- 缺少关键信息时，用 reply 向用户提问并暂停执行，不要盲目尝试。\n\n")
                .append("环境说明：\n")
                .append("- 每次都是完整的 Linux 环境，命令以当前登录用户身份执行，非 root 时注意权限。\n")
                .append("- 每条命令在独立 shell 中执行：cd 切换的目录会被系统自动保留，但 export 的环境变量与别名不会保留；"
                        + "需要时把多条命令用 && 或 ; 连成一条。\n")
                .append("- 命令必须是非交互的，禁止执行需要人工输入的程序（如 vi、top、不带参数的 passwd）；"
                        + "sudo 通常没有免密，权限不足时如实向用户说明，不要反复重试。\n")
                .append("- 输出过长会被截断，请用 head/tail/grep 等控制输出量；命令结果已展示给用户，不要在 reply 里重复大段输出。\n")
                .append("- note 与 reply 用简洁中文，不要使用 emoji；reply 可以用简短 Markdown（列表、加粗、行内代码、代码块），"
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
        String dsmlCmd = dsmlParameter(t, "cmd");
        if (dsmlCmd != null && !dsmlCmd.trim().isEmpty()) {
            p.command = dsmlCmd.trim();
            String dsmlNote = dsmlParameter(t, "note");
            p.note = dsmlNote == null ? "" : dsmlNote.trim();
            return p;
        }
        if (containsDsml(t)) {
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

    private static final Pattern DSML_PARAMETER = Pattern.compile(
            "<\\s*(?:" + DSML_MARK_BODY + ")?parameter\\b([^>]*)>(.*?)"
                    + "</\\s*(?:" + DSML_MARK_BODY + ")?parameter\\s*>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private static final Pattern DSML_NAME_CMD = Pattern.compile(
            "name\\s*=\\s*[\"']cmd[\"']", Pattern.CASE_INSENSITIVE);

    private static final Pattern DSML_NAME_NOTE = Pattern.compile(
            "name\\s*=\\s*[\"']note[\"']", Pattern.CASE_INSENSITIVE);

    private static final Pattern DSML_MARKER = Pattern.compile(
            "<\\s*" + DSML_MARK_BODY, Pattern.CASE_INSENSITIVE);

    static boolean containsDsml(String content) {
        return content != null && !content.isEmpty() && DSML_MARKER.matcher(content).find();
    }

    /** 从 DSML 参数块中提取 cmd / note；未闭合或不是 DSML 时返回 null */
    static String dsmlParameter(String content, String name) {
        if (content == null || content.isEmpty() || !containsDsml(content)) {
            return null;
        }
        Pattern namePattern = "cmd".equals(name) ? DSML_NAME_CMD : DSML_NAME_NOTE;
        Matcher matcher = DSML_PARAMETER.matcher(content);
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

    /* ---------- 高危命令识别（自动模式下的二次确认） ---------- */

    private static final Pattern[] DANGER_PATTERNS = {
            Pattern.compile("\\brm(\\s+-[a-z]+)*\\s+-[a-z]*r[a-z]*", Pattern.CASE_INSENSITIVE),
            Pattern.compile("\\brm\\b[^\\n|;&]*\\s--recursive\\b", Pattern.CASE_INSENSITIVE),
            Pattern.compile("\\bfind\\b[^\\n|;&]*\\s-delete\\b", Pattern.CASE_INSENSITIVE),
            Pattern.compile("\\bshred\\b", Pattern.CASE_INSENSITIVE),
            Pattern.compile("\\bmkfs(\\.[a-z0-9]+)?\\b", Pattern.CASE_INSENSITIVE),
            Pattern.compile("\\bdd\\b[^\\n|;&]*\\bof=/dev/", Pattern.CASE_INSENSITIVE),
            Pattern.compile("\\b(fdisk|parted|wipefs|mkswap)\\b", Pattern.CASE_INSENSITIVE),
            Pattern.compile(">\\s*/dev/(sd|vd|nvme|hd)"),
            Pattern.compile("\\b(shutdown|reboot|halt|poweroff)\\b"),
            Pattern.compile("\\binit\\s+[06]\\b"),
            Pattern.compile("\\bsystemctl\\s+(reboot|poweroff|halt)\\b"),
            Pattern.compile("\\bsystemctl\\s+(stop|disable|mask)\\s+(sshd|network|networking|firewalld|systemd-networkd)\\b"),
            Pattern.compile(":\\s*\\(\\s*\\)\\s*\\{"),
            Pattern.compile("\\bchmod\\s+-[a-z]*R[a-z]*\\s+777\\s+/(\\s|$)"),
            Pattern.compile("\\b(userdel|groupdel)\\b"),
            Pattern.compile("\\bufw\\s+disable\\b|\\biptables\\s+-F\\b|\\bnft\\s+flush\\s+ruleset\\b"),
            Pattern.compile("\\bkill\\s+-9\\s+1\\b|\\bkillall5\\b"),
    };

    private static final String[] DANGER_REASONS = {
            "递归删除文件（rm -r / -rf）",
            "递归删除文件（rm --recursive）",
            "find -delete 批量删除",
            "不可恢复地擦除文件（shred）",
            "格式化文件系统（mkfs）",
            "向块设备写入数据（dd）",
            "修改磁盘分区 / 交换分区",
            "向磁盘设备重定向写入",
            "关机 / 重启服务器",
            "切换运行级别（关机 / 重启）",
            "关机 / 重启服务器",
            "停用关键系统服务（SSH / 网络 / 防火墙）",
            "疑似 fork 炸弹",
            "递归放开根目录权限",
            "删除系统用户 / 用户组",
            "关闭防火墙规则",
            "强杀 init 进程",
    };

    static String dangerReason(String command) {
        if (command == null || command.isEmpty()) {
            return null;
        }
        for (int i = 0; i < DANGER_PATTERNS.length; i++) {
            if (DANGER_PATTERNS[i].matcher(command).find()) {
                return DANGER_REASONS[i];
            }
        }
        return null;
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
    static String cleanTerminalText(String s) {
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
