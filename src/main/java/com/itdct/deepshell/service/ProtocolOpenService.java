package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.ConnectionForm;
import com.itdct.deepshell.entity.SshConnection;
import com.itdct.deepshell.protocol.ProtocolRequest;
import org.springframework.stereotype.Service;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.List;

/**
 * 把外部调用链接落到一条可打开的连接：
 * - id 指向已保存连接时直接复用；
 * - host / port / username 与本机连接匹配时复用（不会用链接里的密码覆盖已保存凭据）；
 * - 匹配不到时，只有携带密码（或密钥认证的 keyPath）才新建连接，避免生成不可用条目。
 */
@Service
public class ProtocolOpenService {

    private final ConnectionService connections;
    private final AuditService audit;

    public ProtocolOpenService(ConnectionService connections, AuditService audit) {
        this.connections = connections;
        this.audit = audit;
    }

    public synchronized Result open(ProtocolRequest request, String client) {
        SshConnection connection = null;
        boolean created = false;
        Long requestedId = request.getConnectionId();
        if (requestedId != null) {
            try {
                connection = connections.get(requestedId);
            } catch (IllegalArgumentException e) {
                // id 在本机不存在时，允许继续按 host / username 匹配或新建
                if (request.getHost() == null) {
                    throw new IllegalArgumentException("连接 #" + requestedId + " 不存在或已被删除");
                }
            }
        }
        if (connection == null) {
            connection = findMatch(request);
        }
        if (connection == null) {
            connection = createFromRequest(request);
            created = true;
        }

        connections.touch(connection.getId());
        String path = workspacePath(connection.getId(), request);
        audit.record("PROTOCOL_OPEN", connection.getName(), "OK",
                "来源：" + (request.getSource() == null ? "外部调用" : request.getSource())
                        + " | 客户端：" + client
                        + " | " + (created ? "新建连接" : "复用连接")
                        + " | " + request.describeTarget());
        return new Result(connection.getId(), connection.getName(), created, path);
    }

    private SshConnection findMatch(ProtocolRequest request) {
        if (request.getHost() == null || request.getUsername() == null) {
            return null;
        }
        List<SshConnection> all = connections.list();
        SshConnection matched = null;
        SshConnection matchedByName = null;
        for (SshConnection c : all) {
            if (c.getHost() == null || c.getUsername() == null) {
                continue;
            }
            if (!request.getHost().equalsIgnoreCase(c.getHost().trim())) {
                continue;
            }
            int port = c.getPort() == null ? 22 : c.getPort();
            if (port != request.getPort()) {
                continue;
            }
            if (!request.getUsername().equals(c.getUsername())) {
                continue;
            }
            matched = moreRecent(matched, c);
            if (request.getName() != null && request.getName().equals(c.getName())) {
                matchedByName = moreRecent(matchedByName, c);
            }
        }
        return matchedByName != null ? matchedByName : matched;
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

    private SshConnection createFromRequest(ProtocolRequest request) {
        if ("KEY".equalsIgnoreCase(request.getAuthType())) {
            if (request.getKeyPath() == null) {
                throw new IllegalArgumentException("外部调用缺少 keyPath（私钥认证需要提供私钥路径）");
            }
        } else if (request.getPassword() == null) {
            throw new IllegalArgumentException(
                    "外部调用缺少密码：请先在 DeepShell 中保存该连接，或在链接中提供 password 参数");
        }
        ConnectionForm form = new ConnectionForm();
        form.setName(request.getName() != null ? request.getName()
                : request.getUsername() + "@" + request.getHost());
        form.setHost(request.getHost());
        form.setPort(request.getPort());
        form.setUsername(request.getUsername());
        form.setAuthType(request.getAuthType());
        form.setPassword(request.getPassword());
        form.setPassphrase(request.getPassphrase());
        form.setKeyPath(request.getKeyPath());
        form.setPersistSession(Boolean.TRUE);
        String remark = "由外部调用创建";
        if (request.getSource() != null) {
            remark += "（" + request.getSource() + "）";
        }
        form.setRemark(remark);
        SshConnection saved = connections.create(form);
        audit.record("CONNECTION_CREATE", saved.getName(), "OK",
                "外部调用 | " + request.describeTarget());
        return saved;
    }

    private static String workspacePath(Long connectionId, ProtocolRequest request) {
        StringBuilder path = new StringBuilder("/workspace?connId=").append(connectionId)
                .append("&external=1");
        if (request.getSource() != null) {
            path.append("&source=").append(encode(request.getSource()));
        }
        if (request.getView() != null) {
            path.append("&view=").append(request.getView());
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

    public static final class Result {
        private final Long connectionId;
        private final String connectionName;
        private final boolean created;
        private final String workspacePath;

        Result(Long connectionId, String connectionName, boolean created, String workspacePath) {
            this.connectionId = connectionId;
            this.connectionName = connectionName;
            this.created = created;
            this.workspacePath = workspacePath;
        }

        public Long getConnectionId() {
            return connectionId;
        }

        public String getConnectionName() {
            return connectionName;
        }

        public boolean isCreated() {
            return created;
        }

        public String getWorkspacePath() {
            return workspacePath;
        }
    }
}
