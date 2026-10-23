package com.itdct.deepshell.protocol;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 外部调用链接（deepshell://connect?...）的解析结果。
 * 只做格式与基本安全校验，不访问数据库；密码等敏感参数不会出现在日志里。
 *
 * 支持两种目标：
 * 1. id=已保存连接 ID：直接打开该连接（推荐，链接中不含密码）；
 * 2. host/port/username：本机存在相同连接时复用，否则在携带密码 / 私钥后新建连接。
 */
public final class ProtocolRequest {

    public static final String SCHEME = "deepshell";
    public static final String ACTION_CONNECT = "connect";

    private static final int MAX_URI = 8192;
    private static final int MAX_HOST = 255;
    private static final int MAX_USERNAME = 100;
    private static final int MAX_NAME = 100;
    private static final int MAX_PASSWORD = 512;
    private static final int MAX_KEY_PATH = 500;
    private static final int MAX_SOURCE = 100;

    private Long connectionId;
    private String host;
    private int port = 22;
    private String username;
    private String name;
    private String password;
    private String authType = "PASSWORD";
    private String keyPath;
    private String passphrase;
    /** desktop / workbench；为空时沿用当前用户「连接后进入桌面」的设置 */
    private String view;
    /** 调用方名称（门户 / 平台），仅用于提示与审计 */
    private String source;

    private ProtocolRequest() {
    }

    /** 当前用户公开的协议头（用于展示与复制调用链接） */
    public static String linkFor(Long connectionId) {
        return SCHEME + "://" + ACTION_CONNECT + "?id=" + connectionId;
    }

    public static ProtocolRequest parse(String uri) {
        if (uri == null || uri.trim().isEmpty()) {
            throw new IllegalArgumentException("外部调用链接为空");
        }
        String value = uri.trim();
        if (value.length() > MAX_URI) {
            throw new IllegalArgumentException("外部调用链接过长");
        }
        int colon = value.indexOf(':');
        if (colon <= 0 || !SCHEME.equalsIgnoreCase(value.substring(0, colon))) {
            throw new IllegalArgumentException("不是 DeepShell 调用链接（需要 " + SCHEME + "://）");
        }
        String rest = value.substring(colon + 1);
        while (rest.startsWith("/")) {
            rest = rest.substring(1);
        }
        String action = rest;
        String query = "";
        int question = rest.indexOf('?');
        if (question >= 0) {
            action = rest.substring(0, question);
            query = rest.substring(question + 1);
        }
        while (action.endsWith("/")) {
            action = action.substring(0, action.length() - 1);
        }
        if (!ACTION_CONNECT.equalsIgnoreCase(action)) {
            throw new IllegalArgumentException("不支持的调用类型：" + (action.isEmpty() ? "（空）" : action));
        }

        Map<String, String> params = parseQuery(query);
        ProtocolRequest request = new ProtocolRequest();

        String id = trimToNull(params.get("id"));
        if (id == null) {
            id = trimToNull(params.get("connId"));
        }
        if (id != null) {
            try {
                long parsed = Long.parseLong(id);
                if (parsed <= 0) {
                    throw new NumberFormatException();
                }
                request.connectionId = parsed;
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("id 参数必须是正整数");
            }
        }

        request.host = normalizeHost(params.get("host"));
        request.port = parsePort(params.get("port"));
        request.username = normalizeUsername(params.get("username"));
        request.name = normalizeName(params.get("name"));
        request.password = normalizeSecret(params.get("password"), MAX_PASSWORD, "password");
        request.authType = normalizeAuthType(params.get("authType"));
        request.keyPath = normalizePath(params.get("keyPath"));
        request.passphrase = normalizeSecret(params.get("passphrase"), MAX_PASSWORD, "passphrase");
        request.view = normalizeView(params.get("view"));
        String source = trimToNull(params.get("source"));
        if (source == null) {
            source = trimToNull(params.get("from"));
        }
        request.source = normalizeSource(source);

        if (request.connectionId == null) {
            if (request.host == null) {
                throw new IllegalArgumentException("缺少 id 或 host 参数");
            }
            if (request.username == null) {
                throw new IllegalArgumentException("缺少 username 参数");
            }
        }
        return request;
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> params = new LinkedHashMap<>();
        if (query == null || query.isEmpty()) {
            return params;
        }
        for (String pair : query.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int eq = pair.indexOf('=');
            String key = eq >= 0 ? pair.substring(0, eq) : pair;
            String value = eq >= 0 ? pair.substring(eq + 1) : "";
            try {
                params.put(decode(key), decode(value));
            } catch (UnsupportedEncodingException e) {
                throw new IllegalArgumentException("外部调用链接编码无效");
            }
        }
        return params;
    }

    private static String decode(String text) throws UnsupportedEncodingException {
        return URLDecoder.decode(text, "UTF-8");
    }

    private static String normalizeHost(String value) {
        String host = trimToNull(value);
        if (host == null) {
            return null;
        }
        if (host.length() > MAX_HOST) {
            throw new IllegalArgumentException("host 参数过长");
        }
        for (int i = 0; i < host.length(); i++) {
            char c = host.charAt(i);
            if (Character.isISOControl(c) || Character.isWhitespace(c)) {
                throw new IllegalArgumentException("host 参数包含空白或控制字符");
            }
            if (c == '/' || c == '\\' || c == '@' || c == '?' || c == '#') {
                throw new IllegalArgumentException("host 参数包含不支持的字符");
            }
        }
        return host;
    }

    private static int parsePort(String value) {
        String text = trimToNull(value);
        if (text == null) {
            return 22;
        }
        try {
            int port = Integer.parseInt(text);
            if (port < 1 || port > 65535) {
                throw new NumberFormatException();
            }
            return port;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("port 参数必须在 1 - 65535 之间");
        }
    }

    private static String normalizeUsername(String value) {
        String username = trimToNull(value);
        if (username == null) {
            return null;
        }
        if (username.length() > MAX_USERNAME) {
            throw new IllegalArgumentException("username 参数过长");
        }
        for (int i = 0; i < username.length(); i++) {
            char c = username.charAt(i);
            if (Character.isISOControl(c) || Character.isWhitespace(c) || c == '/' || c == '\\') {
                throw new IllegalArgumentException("username 参数包含空白或不支持的字符");
            }
        }
        return username;
    }

    private static String normalizeName(String value) {
        String name = trimToNull(value);
        if (name == null) {
            return null;
        }
        if (name.length() > MAX_NAME) {
            throw new IllegalArgumentException("name 参数过长");
        }
        StringBuilder sb = new StringBuilder(name.length());
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            sb.append(Character.isISOControl(c) ? ' ' : c);
        }
        String normalized = sb.toString().trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private static String normalizeSecret(String value, int max, String field) {
        if (value == null || value.isEmpty()) {
            return null;
        }
        if (value.length() > max) {
            throw new IllegalArgumentException(field + " 参数过长");
        }
        if (value.indexOf('\0') >= 0) {
            throw new IllegalArgumentException(field + " 参数包含非法字符");
        }
        return value;
    }

    private static String normalizePath(String value) {
        String path = trimToNull(value);
        if (path == null) {
            return null;
        }
        if (path.length() > MAX_KEY_PATH) {
            throw new IllegalArgumentException("keyPath 参数过长");
        }
        for (int i = 0; i < path.length(); i++) {
            if (Character.isISOControl(path.charAt(i))) {
                throw new IllegalArgumentException("keyPath 参数包含控制字符");
            }
        }
        return path;
    }

    private static String normalizeAuthType(String value) {
        String type = trimToNull(value);
        if (type == null) {
            return "PASSWORD";
        }
        type = type.toUpperCase(Locale.ROOT);
        if (!"PASSWORD".equals(type) && !"KEY".equals(type)) {
            throw new IllegalArgumentException("authType 仅支持 PASSWORD / KEY");
        }
        return type;
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
            return null;
        }
        if (source.length() > MAX_SOURCE) {
            throw new IllegalArgumentException("source 参数过长");
        }
        StringBuilder sb = new StringBuilder(source.length());
        for (int i = 0; i < source.length(); i++) {
            char c = source.charAt(i);
            sb.append(Character.isISOControl(c) ? ' ' : c);
        }
        String normalized = sb.toString().trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public Long getConnectionId() {
        return connectionId;
    }

    public String getHost() {
        return host;
    }

    public int getPort() {
        return port;
    }

    public String getUsername() {
        return username;
    }

    public String getName() {
        return name;
    }

    public String getPassword() {
        return password;
    }

    public String getAuthType() {
        return authType;
    }

    public String getKeyPath() {
        return keyPath;
    }

    public String getPassphrase() {
        return passphrase;
    }

    public String getView() {
        return view;
    }

    public String getSource() {
        return source;
    }

    /** 用于日志 / 审计的目标描述，绝不包含密码或口令。 */
    public String describeTarget() {
        if (connectionId != null) {
            return "连接 #" + connectionId;
        }
        return (username == null ? "" : username + "@") + host + ":" + port;
    }
}
