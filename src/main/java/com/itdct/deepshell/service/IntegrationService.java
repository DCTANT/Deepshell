package com.itdct.deepshell.service;

import com.itdct.deepshell.config.BrowserLauncher;
import com.itdct.deepshell.config.LocalServerInfo;
import com.itdct.deepshell.dto.ConnectionForm;
import com.itdct.deepshell.dto.IntegrationOpenReq;
import com.itdct.deepshell.entity.SshConnection;
import org.springframework.stereotype.Service;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.List;
import java.util.Locale;

/**
 * JumpServer / 运维门户 HTTP 接口：新增或更新连接，并通知在线的 DeepShell 页面打开连接标签。
 * 与 deepshell:// 协议不同，这里的调用方是可信后端，接口会按传入信息更新已保存连接的凭据。
 */
@Service
public class IntegrationService {

    private final ConnectionService connections;
    private final AuditService audit;
    private final WorkspaceEventService events;
    private final BrowserLauncher browserLauncher;
    private final LocalServerInfo serverInfo;

    public IntegrationService(ConnectionService connections, AuditService audit,
                              WorkspaceEventService events, BrowserLauncher browserLauncher,
                              LocalServerInfo serverInfo) {
        this.connections = connections;
        this.audit = audit;
        this.events = events;
        this.browserLauncher = browserLauncher;
        this.serverInfo = serverInfo;
    }

    public synchronized Result open(IntegrationOpenReq req, String clientIp) {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        String source = normalizeSource(req.getSource());
        String view = normalizeView(req.getView());
        try {
            Long requestedId = req.getConnectionId() != null ? req.getConnectionId() : req.getId();
            SshConnection target = null;
            boolean created = false;
            boolean updated = false;
            if (requestedId != null) {
                try {
                    target = connections.get(requestedId);
                } catch (IllegalArgumentException e) {
                    if (trimToNull(req.getHost()) == null || trimToNull(req.getUsername()) == null) {
                        throw new IllegalArgumentException("连接 #" + requestedId + " 不存在或已被删除");
                    }
                }
            }
            if (target == null) {
                target = findMatch(req);
            }
            if (target != null) {
                ConnectionForm form = formFromExisting(target, req);
                validateCredentials(form, target);
                target = connections.update(target.getId(), form);
                updated = true;
            } else {
                ConnectionForm form = formForNew(req, source);
                validateCredentials(form, null);
                target = connections.create(form);
                created = true;
            }
            connections.touch(target.getId());

            String path = workspacePath(target.getId(), view, source);
            boolean shouldOpen = req.getOpen() == null || req.getOpen();
            int clients = 0;
            boolean browser = false;
            if (shouldOpen) {
                clients = events.broadcastOpen(target.getId(), target.getName(), view, source, path);
                if (clients == 0 && Boolean.TRUE.equals(req.getOpenInBrowser())) {
                    browserLauncher.openUrl(serverInfo.baseUrl() + path);
                    browser = true;
                }
            } else {
                events.broadcastConnectionsChanged();
            }
            String detail = "来源：" + source + " | 客户端：" + clientIp
                    + " | " + (created ? "新建连接" : "更新连接")
                    + (view == null ? "" : " | 视图：" + view)
                    + " | 在线页面：" + clients
                    + (browser ? " | 已请求本机浏览器" : "");
            audit.record("INTEGRATION_OPEN", target.getName(), "OK", detail, "api", clientIp);
            return new Result(target.getId(), target.getName(), created, updated,
                    clients, path, browser, shouldOpen);
        } catch (Exception e) {
            String message = e.getMessage() == null ? "集成接口处理失败" : e.getMessage();
            audit.record("INTEGRATION_OPEN", "接口调用", "FAIL", message, "api", clientIp);
            throw e instanceof IllegalArgumentException
                    ? (IllegalArgumentException) e
                    : new IllegalArgumentException(message, e);
        }
    }

    private SshConnection findMatch(IntegrationOpenReq req) {
        String host = trimToNull(req.getHost());
        String username = trimToNull(req.getUsername());
        if (host == null || username == null) {
            return null;
        }
        int port = req.getPort() == null ? 22 : req.getPort();
        String name = trimToNull(req.getName());
        List<SshConnection> all = connections.list();
        SshConnection matched = null;
        SshConnection matchedByName = null;
        for (SshConnection c : all) {
            if (c.getHost() == null || c.getUsername() == null) {
                continue;
            }
            if (!host.equalsIgnoreCase(c.getHost().trim())) {
                continue;
            }
            int existingPort = c.getPort() == null ? 22 : c.getPort();
            if (existingPort != port || !username.equals(c.getUsername())) {
                continue;
            }
            matched = moreRecent(matched, c);
            if (name != null && name.equals(c.getName())) {
                matchedByName = moreRecent(matchedByName, c);
            }
        }
        return matchedByName != null ? matchedByName : matched;
    }

    private ConnectionForm formFromExisting(SshConnection existing, IntegrationOpenReq req) {
        ConnectionForm form = new ConnectionForm();
        String authType = normalizeAuthType(req.getAuthType());
        if (authType == null) {
            if (blankToNull(req.getPassword()) != null) {
                authType = "PASSWORD";
            } else if (trimToNull(req.getKeyPath()) != null) {
                authType = "KEY";
            } else {
                authType = existing.getAuthType() == null ? "PASSWORD" : existing.getAuthType();
            }
        }
        form.setAuthType(authType);
        form.setName(firstNonNull(trimToNull(req.getName()), existing.getName()));
        form.setHost(firstNonNull(trimToNull(req.getHost()), existing.getHost()));
        form.setPort(req.getPort() != null ? req.getPort() : existing.getPort());
        form.setUsername(firstNonNull(trimToNull(req.getUsername()), existing.getUsername()));
        form.setPassword(blankToNull(req.getPassword()));
        form.setKeyPath(firstNonNull(trimToNull(req.getKeyPath()), existing.getKeyPath()));
        form.setPassphrase(blankToNull(req.getPassphrase()));
        form.setGroupName(req.getGroupName() != null ? trimOrNull(req.getGroupName()) : existing.getGroupName());
        form.setRemark(req.getRemark() != null ? trimOrNull(req.getRemark()) : existing.getRemark());
        // 保留调用方没有覆盖的连接属性；proxyPassword 留空表示沿用已加密的旧值
        form.setProxyType(existing.getProxyType());
        form.setProxyHost(existing.getProxyHost());
        form.setProxyPort(existing.getProxyPort());
        form.setProxyUsername(existing.getProxyUsername());
        form.setJumpConnectionId(existing.getJumpConnectionId());
        form.setPersistSession(existing.getPersistSession());
        form.setSortOrder(existing.getSortOrder());
        form.setFolderId(existing.getFolderId());
        form.setFavorite(existing.getFavorite());
        form.setPinned(existing.getPinned());
        validateBasics(form);
        return form;
    }

    private ConnectionForm formForNew(IntegrationOpenReq req, String source) {
        ConnectionForm form = new ConnectionForm();
        String authType = normalizeAuthType(req.getAuthType());
        if (authType == null) {
            authType = trimToNull(req.getKeyPath()) != null && blankToNull(req.getPassword()) == null
                    ? "KEY" : "PASSWORD";
        }
        form.setAuthType(authType);
        form.setHost(trimToNull(req.getHost()));
        form.setPort(req.getPort() == null ? 22 : req.getPort());
        form.setUsername(trimToNull(req.getUsername()));
        form.setName(trimToNull(req.getName()) != null
                ? trimToNull(req.getName())
                : (form.getUsername() == null ? null : form.getUsername() + "@" + form.getHost()));
        form.setPassword(blankToNull(req.getPassword()));
        form.setKeyPath(trimToNull(req.getKeyPath()));
        form.setPassphrase(blankToNull(req.getPassphrase()));
        form.setGroupName(trimOrNull(req.getGroupName()));
        String remark = trimToNull(req.getRemark());
        form.setRemark(remark != null ? remark : "由集成接口创建（" + source + "）");
        form.setPersistSession(Boolean.TRUE);
        validateBasics(form);
        return form;
    }

    private void validateBasics(ConnectionForm form) {
        if (trimToNull(form.getName()) == null) {
            throw new IllegalArgumentException("name 不能为空");
        }
        if (form.getName().length() > 100) {
            throw new IllegalArgumentException("name 不能超过 100 个字符");
        }
        if (trimToNull(form.getHost()) == null) {
            throw new IllegalArgumentException("host 不能为空");
        }
        if (form.getHost().length() > 255) {
            throw new IllegalArgumentException("host 不能超过 255 个字符");
        }
        if (trimToNull(form.getUsername()) == null) {
            throw new IllegalArgumentException("username 不能为空");
        }
        if (form.getUsername().length() > 100) {
            throw new IllegalArgumentException("username 不能超过 100 个字符");
        }
        if (form.getPort() == null || form.getPort() < 1 || form.getPort() > 65535) {
            throw new IllegalArgumentException("port 必须在 1 - 65535 之间");
        }
        if (form.getPassword() != null && form.getPassword().length() > 512) {
            throw new IllegalArgumentException("password 不能超过 512 个字符");
        }
        if (form.getPassphrase() != null && form.getPassphrase().length() > 512) {
            throw new IllegalArgumentException("passphrase 不能超过 512 个字符");
        }
        if (form.getKeyPath() != null && form.getKeyPath().length() > 500) {
            throw new IllegalArgumentException("keyPath 不能超过 500 个字符");
        }
        if (form.getGroupName() != null && form.getGroupName().length() > 100) {
            throw new IllegalArgumentException("groupName 不能超过 100 个字符");
        }
        if (form.getRemark() != null && form.getRemark().length() > 500) {
            throw new IllegalArgumentException("remark 不能超过 500 个字符");
        }
    }

    private void validateCredentials(ConnectionForm form, SshConnection existing) {
        boolean keyAuth = "KEY".equalsIgnoreCase(form.getAuthType());
        if (keyAuth) {
            if (trimToNull(form.getKeyPath()) == null) {
                throw new IllegalArgumentException("KEY 认证需要提供 keyPath（本机私钥绝对路径）");
            }
            return;
        }
        boolean hasPassword = blankToNull(form.getPassword()) != null
                || (existing != null && trimToNull(existing.getPasswordEnc()) != null);
        if (!hasPassword) {
            throw new IllegalArgumentException("PASSWORD 认证需要提供 password");
        }
    }

    private static String normalizeAuthType(String value) {
        String authType = trimToNull(value);
        if (authType == null) {
            return null;
        }
        authType = authType.toUpperCase(Locale.ROOT);
        if (!"PASSWORD".equals(authType) && !"KEY".equals(authType)) {
            throw new IllegalArgumentException("authType 仅支持 PASSWORD / KEY");
        }
        return authType;
    }

    private static String normalizeView(String value) {
        String view = trimToNull(value);
        if (view == null) {
            return null;
        }
        view = view.toLowerCase(Locale.ROOT);
        if (!"desktop".equals(view) && !"workbench".equals(view)) {
            throw new IllegalArgumentException("view 仅支持 desktop / workbench");
        }
        return view;
    }

    private static String normalizeSource(String value) {
        String source = trimToNull(value);
        if (source == null) {
            return "external-api";
        }
        StringBuilder sb = new StringBuilder(Math.min(source.length(), 100));
        for (int i = 0; i < source.length() && sb.length() < 100; i++) {
            char c = source.charAt(i);
            if (!Character.isISOControl(c)) {
                sb.append(c);
            }
        }
        String result = sb.toString().trim();
        return result.isEmpty() ? "external-api" : result;
    }

    private static String workspacePath(Long connectionId, String view, String source) {
        StringBuilder path = new StringBuilder("/workspace?connId=").append(connectionId)
                .append("&external=1&source=").append(encode(source));
        if (view != null) {
            path.append("&view=").append(view);
        }
        return path.toString();
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            return "";
        }
    }

    private static String firstNonNull(String first, String second) {
        return first != null ? first : second;
    }

    private static SshConnection moreRecent(SshConnection a, SshConnection b) {
        if (a == null) {
            return b;
        }
        long ta = a.getLastUsedAt() == null ? 0L : a.getLastUsedAt();
        long tb = b.getLastUsedAt() == null ? 0L : b.getLastUsedAt();
        if (tb != ta) {
            return tb > ta ? b : a;
        }
        long ia = a.getId() == null ? 0L : a.getId();
        long ib = b.getId() == null ? 0L : b.getId();
        return ib > ia ? b : a;
    }

    private static String blankToNull(String value) {
        return value == null || value.trim().isEmpty() ? null : value;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String trimOrNull(String value) {
        return trimToNull(value);
    }

    public static final class Result {
        private final Long connectionId;
        private final String name;
        private final boolean created;
        private final boolean updated;
        private final int openedClients;
        private final String workspaceUrl;
        private final boolean openedInBrowser;
        private final boolean openRequested;

        Result(Long connectionId, String name, boolean created, boolean updated,
               int openedClients, String workspaceUrl, boolean openedInBrowser,
               boolean openRequested) {
            this.connectionId = connectionId;
            this.name = name;
            this.created = created;
            this.updated = updated;
            this.openedClients = openedClients;
            this.workspaceUrl = workspaceUrl;
            this.openedInBrowser = openedInBrowser;
            this.openRequested = openRequested;
        }

        public Long getConnectionId() {
            return connectionId;
        }

        public String getName() {
            return name;
        }

        public boolean isCreated() {
            return created;
        }

        public boolean isUpdated() {
            return updated;
        }

        public int getOpenedClients() {
            return openedClients;
        }

        public String getWorkspaceUrl() {
            return workspaceUrl;
        }

        public boolean isOpenedInBrowser() {
            return openedInBrowser;
        }

        public boolean isOpenRequested() {
            return openRequested;
        }
    }
}
