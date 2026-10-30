package com.itdct.deepshell.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.dto.ProcessEntry;
import com.itdct.deepshell.dto.SftpEntry;
import com.itdct.deepshell.dto.StatsSnapshot;
import com.itdct.deepshell.entity.SshConnection;
import com.itdct.deepshell.service.AiAgentService;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.ConnectionService;
import com.itdct.deepshell.service.ProcessService;
import com.itdct.deepshell.service.SftpService;
import com.itdct.deepshell.service.SshSessionManager;
import com.itdct.deepshell.service.StatsSampler;
import com.itdct.deepshell.service.SystemInfoService;
import com.itdct.deepshell.service.WorkspaceEventService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * MCP 工具实现：把 DeepShell 已有的连接、SSH 会话、SFTP、监控与桌面能力包装成 AI 可调用的工具。
 * 所有命令 / 文件操作都会写入审计日志；MCP 不复制 SSH 凭据，也不会把密码返回给调用方。
 */
@Slf4j
@Service
public class McpToolService implements McpTools {

    private static final int MAX_OUTPUT_BYTES = 256 * 1024;
    private static final int DEFAULT_READ_BYTES = 128 * 1024;
    private static final int MAX_READ_BYTES = 1024 * 1024;
    private static final int MAX_WRITE_BYTES = 8 * 1024 * 1024;
    private static final int DEFAULT_TIMEOUT_SECONDS = 120;
    private static final int MAX_TIMEOUT_SECONDS = 120;
    private static final int DEFAULT_FILE_LIST_LIMIT = 500;
    private static final int MAX_FILE_LIST_LIMIT = 5000;

    private final ConnectionService connections;
    private final SshSessionManager sessions;
    private final SftpService sftp;
    private final ProcessService processes;
    private final SystemInfoService systemInfo;
    private final WorkspaceEventService events;
    private final AuditService audit;
    private final ObjectMapper om = new ObjectMapper();

    /** 连接 ID -> MCP 自己建立的会话 ID（退出前可被 close_session 清理） */
    private final Map<Long, String> mcpSessions = new ConcurrentHashMap<>();
    /** 会话 ID -> 最近一次命令执行后的目录 */
    private final Map<String, String> lastCwd = new ConcurrentHashMap<>();
    /** 连接 ID -> 监控采样差分状态 */
    private final Map<Long, StatsSampler.Prev> statsPrev = new ConcurrentHashMap<>();

    private final List<McpTool> tools;

    public McpToolService(ConnectionService connections, SshSessionManager sessions,
                          SftpService sftp, ProcessService processes,
                          SystemInfoService systemInfo, WorkspaceEventService events,
                          AuditService audit) {
        this.connections = connections;
        this.sessions = sessions;
        this.sftp = sftp;
        this.processes = processes;
        this.systemInfo = systemInfo;
        this.events = events;
        this.audit = audit;
        this.tools = Collections.unmodifiableList(buildTools());
    }

    @Override
    public List<McpTool> list() {
        return tools;
    }

    @Override
    public McpToolResult call(String name, JsonNode args) throws Exception {
        JsonNode a = args == null || args.isNull() ? om.createObjectNode() : args;
        if (name == null) {
            return McpToolResult.error("缺少工具名称");
        }
        switch (name) {
            case "list_connections":
                return listConnections(a);
            case "list_sessions":
                return listSessions();
            case "open_session":
                return openSession(a);
            case "close_session":
                return closeSession(a);
            case "run_command":
                return runCommand(a);
            case "list_files":
                return listFiles(a);
            case "read_file":
                return readFile(a);
            case "write_file":
                return writeFile(a);
            case "upload_file":
                return uploadFile(a);
            case "download_file":
                return downloadFile(a);
            case "get_system_info":
                return getSystemInfo(a);
            case "get_stats":
                return getStats(a);
            case "list_processes":
                return listProcesses(a);
            case "open_connection_tab":
                return openConnectionTab(a);
            default:
                return McpToolResult.error("未知工具：" + name);
        }
    }

    /* ---------- 连接 / 会话 ---------- */

    private McpToolResult listConnections(JsonNode args) throws Exception {
        String keyword = trimToNull(text(args, "keyword"));
        String kw = keyword == null ? null : keyword.toLowerCase(Locale.ROOT);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (SshConnection c : connections.list()) {
            if (kw != null) {
                String hay = (nullToEmpty(c.getName()) + " " + nullToEmpty(c.getHost()) + " "
                        + nullToEmpty(c.getUsername()) + " " + nullToEmpty(c.getGroupName()) + " "
                        + nullToEmpty(c.getRemark())).toLowerCase(Locale.ROOT);
                if (!hay.contains(kw)) {
                    continue;
                }
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("connectionId", c.getId());
            row.put("name", c.getName());
            row.put("group", c.getGroupName());
            row.put("host", c.getHost());
            row.put("port", c.getPort());
            row.put("username", c.getUsername());
            row.put("authType", c.getAuthType());
            row.put("hasKey", trimToNull(c.getKeyPath()) != null);
            row.put("hasPassword", trimToNull(c.getPasswordEnc()) != null);
            row.put("jumpConnectionId", c.getJumpConnectionId());
            row.put("proxyType", c.getProxyType());
            row.put("remark", c.getRemark());
            row.put("favorite", Boolean.TRUE.equals(c.getFavorite()));
            row.put("pinned", Boolean.TRUE.equals(c.getPinned()));
            row.put("lastUsedAt", c.getLastUsedAt());
            rows.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("count", rows.size());
        out.put("connections", rows);
        return McpToolResult.ok(json(out));
    }

    private McpToolResult listSessions() throws Exception {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (SshSessionManager.SshSession s : sessions.liveSessions()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("sessionId", s.getId());
            row.put("connectionId", s.getConnectionId());
            row.put("name", s.getName());
            row.put("tmux", s.isTmux());
            row.put("attached", s.isAttached());
            row.put("lastActiveAt", s.getLastActive().get());
            row.put("mcpManaged", isMcpSession(s.getId()));
            String cwd = lastCwd.get(s.getId());
            if (cwd != null) {
                row.put("lastCwd", cwd);
            }
            rows.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("count", rows.size());
        out.put("sessions", rows);
        return McpToolResult.ok(json(out));
    }

    private McpToolResult openSession(JsonNode args) throws Exception {
        SshConnection c = resolveConnection(args);
        SshSessionManager.SshSession s = ensureSession(c.getId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sessionId", s.getId());
        out.put("connectionId", c.getId());
        out.put("name", c.getName());
        out.put("host", c.getHost());
        out.put("tmux", s.isTmux());
        if (s.getNotice() != null) {
            out.put("notice", s.getNotice());
        }
        return McpToolResult.ok(json(out));
    }

    private McpToolResult closeSession(JsonNode args) throws Exception {
        String sessionId = trimToNull(text(args, "sessionId"));
        if (sessionId == null) {
            return McpToolResult.error("缺少 sessionId");
        }
        if (!isMcpSession(sessionId)) {
            return McpToolResult.error("只能关闭 MCP 自己建立的会话；界面里的会话请在 DeepShell 中关闭");
        }
        sessions.close(sessionId);
        mcpSessions.entrySet().removeIf(e -> sessionId.equals(e.getValue()));
        lastCwd.remove(sessionId);
        audit.record("MCP_SESSION_CLOSE", sessionId, "OK", null);
        return McpToolResult.ok(json(Collections.singletonMap("closed", sessionId)));
    }

    /* ---------- 命令 ---------- */

    private McpToolResult runCommand(JsonNode args) throws Exception {
        String command = trimToNull(text(args, "command"));
        if (command == null) {
            return McpToolResult.error("缺少 command");
        }
        int timeoutSeconds = clamp(intArg(args, "timeoutSeconds", DEFAULT_TIMEOUT_SECONDS),
                1, MAX_TIMEOUT_SECONDS);
        SshSessionManager.SshSession s = resolveSession(args);
        String cwd = trimToNull(text(args, "cwd"));
        if (cwd == null) {
            cwd = lastCwd.get(s.getId());
        }
        long startedAt = System.nanoTime();
        try {
            SshSessionManager.ExecResult res = sessions.execInShell(s, "exec 2>&1\n" + command, cwd,
                    timeoutSeconds * 1000L, MAX_OUTPUT_BYTES);
            if (trimToNull(res.cwd) != null) {
                lastCwd.put(s.getId(), res.cwd.trim());
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", res.exitCode == null || res.exitCode == 0);
            out.put("exitCode", res.exitCode);
            out.put("cwd", res.cwd);
            out.put("timedOut", res.timedOut);
            out.put("truncated", res.truncated);
            out.put("durationMs", Math.max(0, (System.nanoTime() - startedAt) / 1_000_000));
            out.put("output", AiAgentService.cleanTerminalText(res.output));
            if (res.timedOut) {
                out.put("hint", "命令超过 " + timeoutSeconds + " 秒被中止；如需长时间运行请用 nohup / tmux 后台启动");
            }
            audit.record("MCP_COMMAND", command,
                    res.exitCode != null && res.exitCode != 0 ? "FAIL" : "OK",
                    "session=" + s.getId() + " exit=" + res.exitCode
                            + (res.timedOut ? " timeout" : "")
                            + (res.truncated ? " truncated" : ""));
            return McpToolResult.ok(json(out));
        } catch (Exception e) {
            invalidateSession(s.getId());
            audit.record("MCP_COMMAND", command, "FAIL", e.getMessage());
            throw e;
        }
    }

    /* ---------- 文件 ---------- */

    private McpToolResult listFiles(JsonNode args) throws Exception {
        SshSessionManager.SshSession s = resolveSession(args);
        String path = resolveRemotePath(s, text(args, "path"), true);
        int limit = clamp(intArg(args, "limit", DEFAULT_FILE_LIST_LIMIT), 1, MAX_FILE_LIST_LIMIT);
        List<SftpEntry> entries = sftp.list(s.getId(), path);
        boolean truncated = entries.size() > limit;
        List<Map<String, Object>> rows = new ArrayList<>();
        int count = 0;
        for (SftpEntry e : entries) {
            if (count++ >= limit) {
                break;
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("name", e.getName());
            row.put("dir", e.isDir());
            row.put("link", e.isLink());
            row.put("size", e.getSize());
            row.put("mtime", e.getMtime());
            row.put("perms", e.getPerms());
            rows.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("path", path);
        out.put("count", entries.size());
        out.put("truncated", truncated);
        out.put("entries", rows);
        return McpToolResult.ok(json(out));
    }

    private McpToolResult readFile(JsonNode args) throws Exception {
        String pathArg = trimToNull(text(args, "path"));
        if (pathArg == null) {
            return McpToolResult.error("缺少 path");
        }
        SshSessionManager.SshSession s = resolveSession(args);
        String path = resolveRemotePath(s, pathArg, false);
        int maxBytes = clamp(intArg(args, "maxBytes", DEFAULT_READ_BYTES), 1, MAX_READ_BYTES);
        long size = sftp.fileSize(s.getId(), path);
        if (size > maxBytes) {
            return McpToolResult.error("文件大小 " + size + " 字节，超过本次上限 " + maxBytes
                    + " 字节；可提高 maxBytes（最大 " + MAX_READ_BYTES + "）或先用 run_command 的 head/tail 查看");
        }
        byte[] data = sftp.readBytes(s.getId(), path, maxBytes);
        boolean binary = isBinary(data);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("path", path);
        out.put("size", data.length);
        out.put("encoding", binary ? "base64" : "utf-8");
        if (binary) {
            out.put("content", java.util.Base64.getEncoder().encodeToString(data));
        } else {
            out.put("content", new String(data, StandardCharsets.UTF_8));
        }
        return McpToolResult.ok(json(out));
    }

    private McpToolResult writeFile(JsonNode args) throws Exception {
        String pathArg = trimToNull(text(args, "path"));
        if (pathArg == null) {
            return McpToolResult.error("缺少 path");
        }
        JsonNode contentNode = args.get("content");
        if (contentNode == null || contentNode.isNull()) {
            return McpToolResult.error("缺少 content");
        }
        String content = contentNode.isTextual() ? contentNode.asText() : contentNode.toString();
        byte[] data = content.getBytes(StandardCharsets.UTF_8);
        if (data.length > MAX_WRITE_BYTES) {
            return McpToolResult.error("内容超过 " + (MAX_WRITE_BYTES / 1024 / 1024) + "MB，拒绝写入");
        }
        SshSessionManager.SshSession s = resolveSession(args);
        String path = resolveRemotePath(s, pathArg, false);
        boolean createDirs = boolArg(args, "createDirs", true);
        if (createDirs) {
            String parent = parentOf(path);
            if (!"/".equals(parent) && !parent.isEmpty()) {
                sftp.mkdirs(s.getId(), parent);
            }
        }
        sftp.putBytes(s.getId(), path, data);
        audit.record("MCP_FILE_WRITE", path, "OK", data.length + " bytes");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("path", path);
        out.put("bytes", data.length);
        out.put("ok", true);
        return McpToolResult.ok(json(out));
    }

    private McpToolResult uploadFile(JsonNode args) throws Exception {
        String localArg = trimToNull(text(args, "localPath"));
        String remoteArg = trimToNull(text(args, "remotePath"));
        if (localArg == null || remoteArg == null) {
            return McpToolResult.error("缺少 localPath 或 remotePath");
        }
        Path local = localPath(localArg);
        if (!Files.isRegularFile(local)) {
            return McpToolResult.error("本机文件不存在或不是普通文件：" + local);
        }
        SshSessionManager.SshSession s = resolveSession(args);
        String remote = resolveRemotePath(s, remoteArg, false);
        String dir;
        String name;
        if (remote.endsWith("/")) {
            dir = remote;
            name = local.getFileName().toString();
        } else {
            dir = parentOf(remote);
            name = remote.substring(remote.lastIndexOf('/') + 1);
        }
        sftp.putLocalFile(s.getId(), dir, name, local);
        long size = Files.size(local);
        audit.record("MCP_FILE_UPLOAD", remote, "OK", local + " (" + size + " bytes)");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("localPath", local.toString());
        out.put("remotePath", remote.endsWith("/") ? remote + name : remote);
        out.put("bytes", size);
        out.put("ok", true);
        return McpToolResult.ok(json(out));
    }

    private McpToolResult downloadFile(JsonNode args) throws Exception {
        String remoteArg = trimToNull(text(args, "remotePath"));
        String localArg = trimToNull(text(args, "localPath"));
        if (remoteArg == null || localArg == null) {
            return McpToolResult.error("缺少 remotePath 或 localPath");
        }
        SshSessionManager.SshSession s = resolveSession(args);
        String remote = resolveRemotePath(s, remoteArg, false);
        Path local = localPath(localArg);
        if (Files.isDirectory(local)) {
            String name = remote.substring(remote.lastIndexOf('/') + 1);
            local = local.resolve(name);
        }
        boolean overwrite = boolArg(args, "overwrite", false);
        if (Files.exists(local) && !overwrite) {
            return McpToolResult.error("本机文件已存在：" + local + "；如确认覆盖请传 overwrite=true");
        }
        sftp.downloadToLocal(s.getId(), remote, local);
        long size = Files.size(local);
        audit.record("MCP_FILE_DOWNLOAD", remote, "OK", local + " (" + size + " bytes)");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("remotePath", remote);
        out.put("localPath", local.toAbsolutePath().toString());
        out.put("bytes", size);
        out.put("ok", true);
        return McpToolResult.ok(json(out));
    }

    /* ---------- 监控 / 进程 ---------- */

    private McpToolResult getSystemInfo(JsonNode args) throws Exception {
        SshSessionManager.SshSession s = resolveSession(args);
        Map<String, Object> data = systemInfo.collect(s.getId());
        return McpToolResult.ok(json(data));
    }

    private McpToolResult getStats(JsonNode args) throws Exception {
        SshConnection c = resolveConnectionForSessionArgs(args);
        SshSessionManager.SshSession s = resolveSession(args);
        StatsSampler.Prev prev = statsPrev.computeIfAbsent(c.getId(), k -> new StatsSampler.Prev());
        String raw = sessions.execCapture(s, StatsSampler.SAMPLE_SCRIPT, 8000);
        StatsSnapshot snapshot = StatsSampler.compute(prev, raw, System.currentTimeMillis());
        try {
            Thread.sleep(1000L);
            String raw2 = sessions.execCapture(s, StatsSampler.SAMPLE_SCRIPT, 8000);
            snapshot = StatsSampler.compute(prev, raw2, System.currentTimeMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.debug("MCP 监控二次采样失败，返回首轮快照: {}", e.getMessage());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("connectionId", c.getId());
        out.put("host", snapshot.getHost());
        out.put("cpuPercent", snapshot.getCpu());
        out.put("memPercent", snapshot.getMemPct());
        out.put("memUsedMb", snapshot.getMemUsedMb());
        out.put("memTotalMb", snapshot.getMemTotalMb());
        out.put("swapPercent", snapshot.getSwapPct());
        out.put("swapUsedMb", snapshot.getSwapUsedMb());
        out.put("swapTotalMb", snapshot.getSwapTotalMb());
        out.put("rxBytesPerSec", snapshot.getRxRate());
        out.put("txBytesPerSec", snapshot.getTxRate());
        out.put("load1", snapshot.getLoad1());
        out.put("uptimeSecs", snapshot.getUptimeSecs());
        if (snapshot.getError() != null) {
            out.put("error", snapshot.getError());
        }
        return McpToolResult.ok(json(out));
    }

    private McpToolResult listProcesses(JsonNode args) throws Exception {
        SshSessionManager.SshSession s = resolveSession(args);
        String keyword = trimToNull(text(args, "keyword"));
        String kw = keyword == null ? null : keyword.toLowerCase(Locale.ROOT);
        String sortBy = trimToNull(text(args, "sortBy"));
        int limit = clamp(intArg(args, "limit", 30), 1, 500);
        List<ProcessEntry> all = processes.list(s.getId());
        List<ProcessEntry> filtered = new ArrayList<>();
        for (ProcessEntry p : all) {
            if (kw != null) {
                String hay = (nullToEmpty(p.getUser()) + " " + nullToEmpty(p.getComm()) + " "
                        + nullToEmpty(p.getArgs())).toLowerCase(Locale.ROOT);
                if (!hay.contains(kw)) {
                    continue;
                }
            }
            filtered.add(p);
        }
        Comparator<ProcessEntry> cmp;
        if ("mem".equalsIgnoreCase(sortBy)) {
            cmp = Comparator.comparing(ProcessEntry::getMemPct,
                    Comparator.<Double>nullsLast(Comparator.<Double>reverseOrder()));
        } else if ("pid".equalsIgnoreCase(sortBy)) {
            cmp = Comparator.comparingLong(ProcessEntry::getPid);
        } else {
            cmp = Comparator.comparing(ProcessEntry::getCpu,
                    Comparator.<Double>nullsLast(Comparator.<Double>reverseOrder()));
        }
        filtered.sort(cmp);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (int i = 0; i < filtered.size() && i < limit; i++) {
            ProcessEntry p = filtered.get(i);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("pid", p.getPid());
            row.put("ppid", p.getPpid());
            row.put("user", p.getUser());
            row.put("cpuPercent", p.getCpu());
            row.put("cpuAvgPercent", p.getCpuAvg());
            row.put("memPercent", p.getMemPct());
            row.put("rssMb", p.getRssMb());
            row.put("state", p.getState());
            row.put("elapsedSecs", p.getElapsedSecs());
            row.put("comm", p.getComm());
            row.put("args", p.getArgs());
            rows.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("total", filtered.size());
        out.put("returned", rows.size());
        out.put("sortBy", sortBy == null ? "cpu" : sortBy);
        out.put("processes", rows);
        return McpToolResult.ok(json(out));
    }

    /* ---------- 桌面 ---------- */

    private McpToolResult openConnectionTab(JsonNode args) throws Exception {
        SshConnection c = resolveConnection(args);
        String view = trimToNull(text(args, "view"));
        if (view != null && !"desktop".equalsIgnoreCase(view) && !"workbench".equalsIgnoreCase(view)) {
            return McpToolResult.error("view 仅支持 desktop / workbench");
        }
        String path = "/workspace?connId=" + c.getId() + "&external=1&source="
                + encode("DeepShell MCP");
        if (view != null) {
            path += "&view=" + view.toLowerCase(Locale.ROOT);
        }
        int clients = events.broadcastOpen(c.getId(), c.getName(),
                view == null ? null : view.toLowerCase(Locale.ROOT), "DeepShell MCP", path);
        connections.touch(c.getId());
        audit.record("MCP_OPEN_TAB", c.getName(), "OK", "online=" + clients);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("connectionId", c.getId());
        out.put("name", c.getName());
        out.put("openedClients", clients);
        out.put("message", clients > 0
                ? "已在 DeepShell 页面打开连接标签"
                : "当前没有打开的 DeepShell 页面；连接已记录，可从界面打开");
        return McpToolResult.ok(json(out));
    }

    /* ---------- 解析参数 / 会话 ---------- */

    private SshConnection resolveConnection(JsonNode args) throws Exception {
        Long id = longArg(args, "connectionId");
        if (id != null) {
            try {
                return connections.get(id);
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("连接 #" + id + " 不存在。可先调用 list_connections 查看可用连接");
            }
        }
        String key = trimToNull(text(args, "connection"));
        if (key == null) {
            throw new IllegalArgumentException("请提供 connectionId（可先调用 list_connections）或 connection 连接名");
        }
        List<SshConnection> all = connections.list();
        SshConnection best = null;
        int bestScore = 0;
        long bestUsed = Long.MIN_VALUE;
        for (SshConnection c : all) {
            String name = trimToNull(c.getName());
            String userHost = nullToEmpty(c.getUsername()) + "@" + nullToEmpty(c.getHost());
            String hostPort = nullToEmpty(c.getHost()) + ":" + (c.getPort() == null ? 22 : c.getPort());
            int score = 0;
            if (name != null && name.equalsIgnoreCase(key)) {
                score = 4;
            } else if (userHost.equalsIgnoreCase(key)) {
                score = 3;
            } else if (hostPort.equalsIgnoreCase(key)) {
                score = 2;
            } else if (nullToEmpty(c.getHost()).equalsIgnoreCase(key)) {
                score = 1;
            }
            if (score == 0) {
                continue;
            }
            long used = c.getLastUsedAt() == null ? 0L : c.getLastUsedAt();
            if (score > bestScore || (score == bestScore && used > bestUsed)) {
                best = c;
                bestScore = score;
                bestUsed = used;
            }
        }
        if (best == null) {
            StringBuilder names = new StringBuilder();
            for (int i = 0; i < all.size() && i < 12; i++) {
                if (names.length() > 0) {
                    names.append("、");
                }
                names.append(all.get(i).getName());
            }
            throw new IllegalArgumentException("找不到连接「" + key + "」。可用连接："
                    + (names.length() == 0 ? "（无）" : names.toString()));
        }
        return best;
    }

    private SshConnection resolveConnectionForSessionArgs(JsonNode args) throws Exception {
        String sessionId = trimToNull(text(args, "sessionId"));
        if (sessionId != null) {
            SshSessionManager.SshSession s = sessions.get(sessionId);
            try {
                return connections.get(s.getConnectionId());
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("会话对应的连接 #" + s.getConnectionId() + " 已被删除");
            }
        }
        return resolveConnection(args);
    }

    private SshSessionManager.SshSession resolveSession(JsonNode args) throws Exception {
        String sessionId = trimToNull(text(args, "sessionId"));
        if (sessionId != null) {
            return sessions.get(sessionId);
        }
        SshConnection c = resolveConnection(args);
        return ensureSession(c.getId());
    }

    private synchronized SshSessionManager.SshSession ensureSession(Long connectionId) throws Exception {
        String cached = mcpSessions.get(connectionId);
        if (cached != null) {
            if (sessions.exists(cached)) {
                return sessions.get(cached);
            }
            mcpSessions.remove(connectionId, cached);
        }
        SshSessionManager.SshSession s = sessions.openOrAttach(connectionId, 160, 48,
                "mcp-" + connectionId, null).session;
        mcpSessions.put(connectionId, s.getId());
        return s;
    }

    private void invalidateSession(String sessionId) {
        if (sessionId == null) {
            return;
        }
        mcpSessions.entrySet().removeIf(e -> sessionId.equals(e.getValue()));
        lastCwd.remove(sessionId);
    }

    private boolean isMcpSession(String sessionId) {
        return sessionId != null && mcpSessions.containsValue(sessionId);
    }

    /* ---------- 路径 / 小工具 ---------- */

    private String resolveRemotePath(SshSessionManager.SshSession s, String path, boolean homeIfBlank)
            throws Exception {
        String p = path == null ? "" : path.trim();
        String home = null;
        if (p.isEmpty()) {
            if (!homeIfBlank) {
                throw new IllegalArgumentException("缺少 path");
            }
            return sftp.home(s.getId());
        }
        if ("~".equals(p) || p.startsWith("~/")) {
            home = sftp.home(s.getId());
            if ("~".equals(p)) {
                return home;
            }
            p = home + p.substring(1);
        }
        if (!p.startsWith("/")) {
            home = home == null ? sftp.home(s.getId()) : home;
            p = (home.endsWith("/") ? home : home + "/") + p;
        }
        return p;
    }

    private Path localPath(String value) {
        Path p = Paths.get(value);
        if (!p.isAbsolute()) {
            p = Paths.get(System.getProperty("user.dir", ".")).resolve(p);
        }
        return p.toAbsolutePath().normalize();
    }

    private static String parentOf(String path) {
        int idx = path.lastIndexOf('/');
        return idx <= 0 ? "/" : path.substring(0, idx);
    }

    private static boolean isBinary(byte[] data) {
        int limit = Math.min(data.length, 8192);
        for (int i = 0; i < limit; i++) {
            if (data[i] == 0) {
                return true;
            }
        }
        return false;
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            return "";
        }
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private String text(JsonNode args, String key) {
        JsonNode n = args == null ? null : args.get(key);
        if (n == null || n.isNull()) {
            return null;
        }
        return n.isTextual() ? n.asText() : n.toString();
    }

    private Long longArg(JsonNode args, String key) {
        JsonNode n = args == null ? null : args.get(key);
        if (n == null || n.isNull()) {
            return null;
        }
        if (n.isNumber()) {
            return n.asLong();
        }
        String t = n.asText("").trim();
        if (t.isEmpty()) {
            return null;
        }
        try {
            return Long.parseLong(t);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(key + " 必须是整数");
        }
    }

    private int intArg(JsonNode args, String key, int fallback) {
        JsonNode n = args == null ? null : args.get(key);
        if (n == null || n.isNull()) {
            return fallback;
        }
        if (n.isNumber()) {
            return n.asInt();
        }
        String t = n.asText("").trim();
        if (t.isEmpty()) {
            return fallback;
        }
        try {
            return Integer.parseInt(t);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(key + " 必须是整数");
        }
    }

    private boolean boolArg(JsonNode args, String key, boolean fallback) {
        JsonNode n = args == null ? null : args.get(key);
        if (n == null || n.isNull()) {
            return fallback;
        }
        if (n.isBoolean()) {
            return n.asBoolean();
        }
        String t = n.asText("").trim();
        if (t.isEmpty()) {
            return fallback;
        }
        return Boolean.parseBoolean(t);
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    private String json(Object value) {
        try {
            return om.writerWithDefaultPrettyPrinter().writeValueAsString(value);
        } catch (Exception e) {
            return String.valueOf(value);
        }
    }

    /* ---------- 工具目录 ---------- */

    private List<McpTool> buildTools() {
        List<McpTool> list = new ArrayList<>();

        list.add(new McpTool("list_connections", "列出 SSH 连接",
                "列出 DeepShell 中保存的 SSH 连接（不返回密码）。开始运维前先调用它获取 connectionId，"
                        + "后续工具可以直接传 connectionId，也可以传连接名。",
                McpTool.schema(McpTool.props(
                        "keyword", McpTool.stringProp("可选：按名称 / 主机 / 用户名 / 分组 / 备注过滤")))));

        list.add(new McpTool("list_sessions", "列出活动会话",
                "列出 DeepShell 当前存活的 SSH 会话，包括界面打开的会话和 MCP 自己建立的会话。",
                McpTool.schema(McpTool.props())));

        list.add(new McpTool("open_session", "打开 SSH 会话",
                "为连接建立并缓存一个 SSH 会话，返回 sessionId。大多数工具会自动建会话，通常无需单独调用；"
                        + "已有会话会直接复用。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID（来自 list_connections）", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机；与 connectionId 二选一")))));

        list.add(new McpTool("close_session", "关闭 MCP 会话",
                "关闭由 MCP 建立的 SSH 会话（同时清理对应 tmux）。界面里打开的会话不能通过此工具关闭。",
                McpTool.schema(McpTool.props(
                        "sessionId", McpTool.stringProp("要关闭的 MCP 会话 ID")), "sessionId")));

        list.add(new McpTool("run_command", "执行 SSH 命令",
                "在远程服务器执行一条非交互式 shell 命令并返回 stdout/stderr、退出码和当前目录。"
                        + "会自动复用/建立连接会话并记住 cwd。命令输出超过 256KB 会截断；超时上限 120 秒。"
                        + "禁止运行需要人工输入的程序（vi、top、无参数 passwd 等）。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID（来自 list_connections）", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机；与 connectionId 二选一"),
                        "sessionId", McpTool.stringProp("可选：指定活动会话 ID（来自 list_sessions）；优先级高于连接"),
                        "command", McpTool.stringProp("要执行的 shell 命令（非交互）"),
                        "cwd", McpTool.stringProp("可选：执行前切换到的目录；默认沿用该会话上一次命令后的目录"),
                        "timeoutSeconds", McpTool.intProp("超时秒数，默认 120，最大 120", 1, MAX_TIMEOUT_SECONDS)),
                        "command")));

        list.add(new McpTool("list_files", "列出远程目录",
                "通过 SFTP 列出远程目录内容。path 支持绝对路径、~/ 开头或相对家目录；省略时列家目录。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机"),
                        "sessionId", McpTool.stringProp("可选：活动会话 ID"),
                        "path", McpTool.stringProp("远程目录；默认为家目录"),
                        "limit", McpTool.intProp("最多返回条数，默认 500", 1, MAX_FILE_LIST_LIMIT)))));

        list.add(new McpTool("read_file", "读取远程文件",
                "读取远程文件内容。文本按 UTF-8 返回；二进制返回 base64。默认最多 128KB，可提高到 1MB。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机"),
                        "sessionId", McpTool.stringProp("可选：活动会话 ID"),
                        "path", McpTool.stringProp("远程文件路径"),
                        "maxBytes", McpTool.intProp("最大读取字节数，默认 131072，上限 1048576", 1, MAX_READ_BYTES)),
                        "path")));

        list.add(new McpTool("write_file", "写入远程文件",
                "用 UTF-8 文本整体覆盖远程文件（不存在则创建）。默认自动创建父目录；内容上限 8MB。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机"),
                        "sessionId", McpTool.stringProp("可选：活动会话 ID"),
                        "path", McpTool.stringProp("远程文件路径"),
                        "content", McpTool.stringProp("要写入的完整文本内容"),
                        "createDirs", McpTool.boolProp("父目录不存在时自动创建，默认 true")),
                        "path", "content")));

        list.add(new McpTool("upload_file", "上传本机文件",
                "把 DeepShell 所在电脑上的文件通过 SFTP 上传到远程。remotePath 以 / 结尾时视为目录并保留原文件名。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机"),
                        "sessionId", McpTool.stringProp("可选：活动会话 ID"),
                        "localPath", McpTool.stringProp("本机文件路径（绝对路径或相对当前工作目录）"),
                        "remotePath", McpTool.stringProp("远程文件路径；以 / 结尾表示目标目录")),
                        "localPath", "remotePath")));

        list.add(new McpTool("download_file", "下载远程文件",
                "把远程文件通过 SFTP 下载到 DeepShell 所在电脑。localPath 是已存在目录时按远程文件名保存；"
                        + "默认不覆盖已存在文件。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机"),
                        "sessionId", McpTool.stringProp("可选：活动会话 ID"),
                        "remotePath", McpTool.stringProp("远程文件路径"),
                        "localPath", McpTool.stringProp("本机目标路径"),
                        "overwrite", McpTool.boolProp("覆盖已存在的本机文件，默认 false")),
                        "remotePath", "localPath")));

        list.add(new McpTool("get_system_info", "系统信息",
                "采集远程 Linux 的发行版、内核、CPU、内存、网卡、磁盘分区等系统信息。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机"),
                        "sessionId", McpTool.stringProp("可选：活动会话 ID")))));

        list.add(new McpTool("get_stats", "实时资源监控",
                "采集远程 Linux 的 CPU / 内存 / 交换 / 网络速率 / 负载 / 运行时长。会采样两次约耗时 1 秒。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机"),
                        "sessionId", McpTool.stringProp("可选：活动会话 ID")))));

        list.add(new McpTool("list_processes", "进程列表",
                "列出远程 Linux 进程，可按 CPU / 内存 / PID 排序并过滤。首次调用瞬时 CPU 可能为空，"
                        + "同时提供 ps 的进程生命周期平均 CPU。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机"),
                        "sessionId", McpTool.stringProp("可选：活动会话 ID"),
                        "keyword", McpTool.stringProp("可选：按用户 / 进程名 / 命令行过滤"),
                        "sortBy", McpTool.enumProp("排序字段，默认 cpu", "cpu", "mem", "pid"),
                        "limit", McpTool.intProp("返回条数，默认 30，最大 500", 1, 500)))));

        list.add(new McpTool("open_connection_tab", "在桌面打开连接",
                "通知已打开的 DeepShell 页面打开这条连接的标签（桌面或工作台）。AI 无法直接弹出浏览器，"
                        + "只影响已在运行的页面。",
                McpTool.schema(McpTool.props(
                        "connectionId", McpTool.intProp("连接 ID", 1, null),
                        "connection", McpTool.stringProp("连接名称 / 用户名@主机 / 主机"),
                        "view", McpTool.enumProp("打开视图：desktop 或 workbench；省略则沿用页面设置",
                                "desktop", "workbench")))));

        return list;
    }
}
