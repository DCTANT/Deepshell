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

    private static final int MAX_HISTORY = 30;
    private static final int MAX_CONTENT_CHARS = 16000;

    private final AiChatClient chatClient;
    private final SshSessionManager sessions;
    private final ConnectionService connections;
    private final ObjectMapper mapper = new ObjectMapper();

    public AiAgentService(AiChatClient chatClient, SshSessionManager sessions, ConnectionService connections) {
        this.chatClient = chatClient;
        this.sessions = sessions;
        this.connections = connections;
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
    }

    /** 一轮对话：调用模型并解析；auto=false 时命令不自动执行，auto=true 时高危命令仍需确认 */
    public AgentResult step(String sessionId, String cwd, boolean auto, List<AgentMessage> history) {
        SshSessionManager.SshSession s = sessions.get(sessionId);
        List<Map<String, String>> messages = sanitize(history);
        String content = chatClient.complete(systemPrompt(s, cwd), messages);
        Parsed parsed = parse(content);

        AgentResult r = new AgentResult();
        if (parsed.command != null && !parsed.command.isEmpty()) {
            r.kind = "cmd";
            r.command = parsed.command;
            r.note = parsed.note;
            String danger = dangerReason(parsed.command);
            if (danger != null) {
                r.needConfirm = true;
                r.danger = danger;
                return r;
            }
            if (!auto) {
                r.needConfirm = true;
                return r;
            }
            fillExec(r, s, parsed.command, cwd);
            return r;
        }
        r.kind = "reply";
        r.text = parsed.reply == null || parsed.reply.isEmpty() ? content : parsed.reply;
        return r;
    }

    /** 用户确认（或手动模式放行）后执行指定命令 */
    public AgentResult exec(String sessionId, String cwd, String command) {
        if (command == null || command.trim().isEmpty()) {
            throw new IllegalArgumentException("缺少要执行的命令");
        }
        SshSessionManager.SshSession s = sessions.get(sessionId);
        AgentResult r = new AgentResult();
        r.kind = "cmd";
        r.command = command.trim();
        fillExec(r, s, r.command, cwd);
        return r;
    }

    private void fillExec(AgentResult r, SshSessionManager.SshSession s, String command, String cwd) {
        try {
            SshSessionManager.ExecResult res =
                    sessions.execInShell(s, command, cwd, EXEC_TIMEOUT_MS, MAX_OUTPUT_BYTES);
            r.executed = true;
            r.output = cleanTerminalText(res.output);
            r.exitCode = res.exitCode;
            r.cwd = res.cwd;
            r.truncated = res.truncated;
            r.timedOut = res.timedOut;
        } catch (Exception e) {
            log.warn("AI 终端命令执行失败: {}", e.toString());
            r.executed = false;
            r.error = "命令执行失败：" + e.getMessage();
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
                .append("- 不要用 markdown 代码块包裹 JSON，直接输出 JSON 本身。\n\n")
                .append("环境说明：\n")
                .append("- 每次都是完整的 Linux 环境，命令以当前登录用户身份执行，非 root 时注意权限。\n")
                .append("- 每条命令在独立 shell 中执行：cd 切换的目录会被系统自动保留，但 export 的环境变量与别名不会保留；"
                        + "需要时把多条命令用 && 或 ; 连成一条。\n")
                .append("- 命令必须是非交互的，禁止执行需要人工输入的程序（如 vi、top、不带参数的 passwd）；"
                        + "sudo 通常没有免密，权限不足时如实向用户说明，不要反复重试。\n")
                .append("- 输出过长会被截断，请用 head/tail/grep 等控制输出量。\n")
                .append("- 危险操作（删除、覆盖、写配置、重启服务）前先用只读命令确认现状，并优先使用保守写法。\n")
                .append("- note 与 reply 用简洁中文，不要使用 emoji。");
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

    /** 解析模型输出：优先 JSON 的 cmd / reply；解析失败时整段作为回复展示 */
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
                // 非 JSON，走兜底
            }
        }
        p.reply = raw;
        return p;
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

    private List<Map<String, String>> sanitize(List<AgentMessage> history) {
        if (history == null || history.isEmpty()) {
            throw new IllegalArgumentException("缺少对话内容");
        }
        List<Map<String, String>> out = new ArrayList<>();
        int from = Math.max(0, history.size() - MAX_HISTORY);
        for (int i = from; i < history.size(); i++) {
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
            Map<String, String> map = new LinkedHashMap<>();
            map.put("role", role);
            map.put("content", c);
            out.add(map);
        }
        if (out.isEmpty() || !"user".equals(out.get(out.size() - 1).get("role"))) {
            throw new IllegalArgumentException("对话内容不完整");
        }
        return out;
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
