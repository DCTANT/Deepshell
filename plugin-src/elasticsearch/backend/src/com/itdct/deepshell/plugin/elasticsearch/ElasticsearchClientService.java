package com.itdct.deepshell.plugin.elasticsearch;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Elasticsearch 官方桌面插件使用的轻量 REST 客户端。
 *
 * <p>不依赖 Elasticsearch SDK，只使用 JDK 的 HttpURLConnection。会话仅保存在内存中，
 * 最多 8 个、空闲 30 分钟释放；支持 HTTP Basic、API Key 和自签名 HTTPS。</p>
 *
 * <p>所有请求都在 DeepShell 服务端发出，浏览器 iframe 不会接触连接凭据。</p>
 */
public class ElasticsearchClientService {

    private static final int MAX_SESSIONS = 8;
    private static final long IDLE_TIMEOUT_MS = 30L * 60 * 1000;
    private static final int MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_CONSOLE_BODY_BYTES = 2 * 1024 * 1024;
    private static final int MAX_SEARCH_SIZE = 200;
    private static final ObjectMapper OM = new ObjectMapper();

    private final Map<String, Session> sessions = new ConcurrentHashMap<String, Session>();
    private final AtomicLong idSeq = new AtomicLong();

    /* ---------------- 连接会话 ---------------- */

    public Map<String, Object> connect(String rawUrl, String username, String secret,
                                       String authType, boolean skipTls, int timeoutMs) throws Exception {
        NormalizedUrl normalized = normalizeUrl(rawUrl);
        String type = normalizeAuthType(authType);
        String header = buildAuthHeader(type, username, secret);
        int timeout = Math.max(3000, Math.min(60000, timeoutMs <= 0 ? 15000 : timeoutMs));
        pruneSessions();

        Session session = new Session();
        session.id = "e" + idSeq.incrementAndGet() + "-"
                + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        session.origin = normalized.origin;
        session.baseUrl = normalized.baseUrl;
        session.prefix = normalized.prefix;
        session.url = normalized.baseUrl;
        session.authHeader = header;
        session.authType = type;
        session.username = username == null ? "" : username.trim();
        session.timeoutMs = timeout;
        session.skipTls = skipTls;
        session.lastUsedAt = System.currentTimeMillis();

        RawResponse probe = execute(session, "GET", "/", null, 8000, false);
        if (probe.status >= 400) {
            throw new IllegalArgumentException(probe.errorMessage());
        }
        if (probe.json == null) {
            throw new IllegalArgumentException("目标地址没有返回 Elasticsearch JSON，请确认地址是否正确");
        }
        JsonNode version = probe.json.path("version").path("number");
        if (version.isMissingNode() || version.asText("").isEmpty()) {
            throw new IllegalArgumentException("目标地址不是 Elasticsearch 节点（缺少 version.number）");
        }
        session.root = probe.json;
        sessions.put(session.id, session);

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("connectionId", session.id);
        out.put("url", session.baseUrl);
        out.put("authType", type);
        out.put("username", session.username);
        out.put("timeoutMs", timeout);
        out.put("skipTls", skipTls);
        out.put("version", probe.json.path("version").path("number").asText(""));
        out.put("clusterName", probe.json.path("cluster_name").asText(""));
        out.put("clusterUuid", probe.json.path("cluster_uuid").asText(""));
        out.put("nodeName", probe.json.path("name").asText(""));
        out.put("tagline", probe.json.path("tagline").asText(""));
        return out;
    }

    public void disconnect(String connectionId) {
        if (connectionId != null) {
            sessions.remove(connectionId);
        }
    }

    public void shutdown() {
        sessions.clear();
    }

    /* ---------------- 概览 / 索引 ---------------- */

    public Map<String, Object> overview(String connectionId) throws Exception {
        Session s = required(connectionId);
        JsonNode root = get(s, "/");
        s.root = root;
        JsonNode health = get(s, "/_cluster/health");
        JsonNode nodes = get(s, "/_cat/nodes?format=json&bytes=b&h=name,ip,node.role,master,"
                + "heap.percent,disk.used_percent,cpu,load_1m");
        JsonNode indices = get(s, "/_cat/indices?format=json&bytes=b&h=index,health,status,pri,rep,"
                + "docs.count,store.size&expand_wildcards=all");

        long docs = 0;
        long store = 0;
        int indexCount = 0;
        int openCount = 0;
        if (indices.isArray()) {
            for (JsonNode row : indices) {
                indexCount++;
                if ("open".equals(row.path("status").asText(""))) {
                    openCount++;
                }
                docs += longValue(row.path("docs.count"));
                store += longValue(row.path("store.size"));
            }
        }
        Map<String, Object> totals = new LinkedHashMap<String, Object>();
        totals.put("indices", indexCount);
        totals.put("openIndices", openCount);
        totals.put("docs", docs);
        totals.put("storeBytes", store);

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("root", root);
        out.put("health", health);
        out.put("nodes", nodes);
        out.put("totals", totals);
        out.put("version", root.path("version").path("number").asText(""));
        out.put("clusterName", root.path("cluster_name").asText(""));
        out.put("nodeName", root.path("name").asText(""));
        return out;
    }

    public List<Map<String, Object>> indices(String connectionId) throws Exception {
        Session s = required(connectionId);
        JsonNode arr = get(s, "/_cat/indices?format=json&bytes=b&h=index,health,status,pri,rep,"
                + "docs.count,store.size&expand_wildcards=all&s=index:asc");
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        if (!arr.isArray()) {
            return out;
        }
        for (JsonNode row : arr) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("index", row.path("index").asText(""));
            item.put("health", row.path("health").asText(""));
            item.put("status", row.path("status").asText(""));
            item.put("pri", intValue(row.path("pri")));
            item.put("rep", intValue(row.path("rep")));
            item.put("docsCount", longValue(row.path("docs.count")));
            item.put("storeBytes", longValue(row.path("store.size")));
            out.add(item);
        }
        return out;
    }

    public Map<String, Object> indexDetail(String connectionId, String index) throws Exception {
        Session s = required(connectionId);
        String idx = encodeSegment(index);
        JsonNode mapping = get(s, "/" + idx + "/_mapping");
        JsonNode settings = get(s, "/" + idx + "/_settings?include_defaults=false");
        JsonNode aliases = get(s, "/" + idx + "/_alias");
        long count = -1;
        try {
            count = get(s, "/" + idx + "/_count").path("count").asLong(-1);
        } catch (IllegalArgumentException ignore) {
            // 关闭的索引无法统计文档数，不影响映射与设置展示
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("index", index);
        out.put("mapping", mapping);
        out.put("settings", settings);
        out.put("aliases", aliases);
        out.put("count", count);
        return out;
    }

    public Map<String, Object> createIndex(String connectionId, String index, String body) throws Exception {
        validateIndexName(index);
        Session s = required(connectionId);
        JsonNode payload = parseOptionalObject(body, "索引配置");
        RawResponse r = execute(s, "PUT", "/" + encodeSegment(index), payload == null ? "{}" : payload.toString(),
                s.timeoutMs, true);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("acknowledged", r.json == null || r.json.path("acknowledged").asBoolean(true));
        out.put("index", index);
        return out;
    }

    public Map<String, Object> deleteIndex(String connectionId, String index) throws Exception {
        if (index == null || index.trim().isEmpty()) {
            throw new IllegalArgumentException("请选择要删除的索引");
        }
        Session s = required(connectionId);
        execute(s, "DELETE", "/" + encodeSegment(index), null, s.timeoutMs, true);
        return Collections.<String, Object>singletonMap("acknowledged", true);
    }

    public Map<String, Object> refreshIndex(String connectionId, String index) throws Exception {
        Session s = required(connectionId);
        execute(s, "POST", "/" + encodeSegment(index) + "/_refresh", null, s.timeoutMs, true);
        return Collections.<String, Object>singletonMap("ok", true);
    }

    /* ---------------- 文档 ---------------- */

    public Map<String, Object> search(String connectionId, String index, String query,
                                      int from, int size) throws Exception {
        Session s = required(connectionId);
        int start = Math.max(0, Math.min(10000, from));
        int pageSize = Math.max(1, Math.min(MAX_SEARCH_SIZE, size <= 0 ? 20 : size));
        String q = query == null ? "" : query.trim();
        if (q.length() > 4000) {
            throw new IllegalArgumentException("查询语句过长");
        }
        ObjectNode body = OM.createObjectNode();
        body.put("from", start);
        body.put("size", pageSize);
        body.put("track_total_hits", 10000);
        ObjectNode queryNode = body.putObject("query");
        if (q.isEmpty()) {
            queryNode.putObject("match_all");
            body.putArray("sort").add("_doc");
        } else {
            ObjectNode qs = queryNode.putObject("query_string");
            qs.put("query", q);
            qs.put("default_operator", "AND");
            qs.put("lenient", true);
        }
        String path = (index == null || index.trim().isEmpty() ? "" : "/" + encodeSegment(index))
                + "/_search";
        RawResponse r = execute(s, "POST", path, body.toString(), s.timeoutMs, true);
        JsonNode resp = r.json == null ? OM.createObjectNode() : r.json;
        JsonNode hitsNode = resp.path("hits");
        long total = 0;
        String relation = "eq";
        JsonNode totalNode = hitsNode.path("total");
        if (totalNode.isObject()) {
            total = totalNode.path("value").asLong(0);
            relation = totalNode.path("relation").asText("eq");
        } else if (totalNode.isNumber()) {
            total = totalNode.asLong(0);
        }
        List<Map<String, Object>> hits = new ArrayList<Map<String, Object>>();
        JsonNode hitArr = hitsNode.path("hits");
        if (hitArr.isArray()) {
            for (JsonNode hit : hitArr) {
                Map<String, Object> item = new LinkedHashMap<String, Object>();
                item.put("id", hit.path("_id").asText(""));
                item.put("index", hit.path("_index").asText(index));
                item.put("score", hit.path("_score").isNull() ? null : hit.path("_score").asDouble(0));
                item.put("source", hit.get("_source"));
                hits.add(item);
            }
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("total", total);
        out.put("relation", relation);
        out.put("hits", hits);
        out.put("took", resp.path("took").asLong(r.tookMs));
        out.put("timedOut", resp.path("timed_out").asBoolean(false));
        return out;
    }

    public Map<String, Object> document(String connectionId, String index, String id) throws Exception {
        Session s = required(connectionId);
        if (isBlank(index) || isBlank(id)) {
            throw new IllegalArgumentException("索引和文档 ID 不能为空");
        }
        RawResponse r = execute(s, "GET", "/" + encodeSegment(index) + "/_doc/" + encodeSegment(id),
                null, s.timeoutMs, false);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        if (r.status == 404) {
            out.put("found", false);
            return out;
        }
        if (r.status >= 400) {
            throw new IllegalArgumentException(r.errorMessage());
        }
        JsonNode node = r.json == null ? OM.createObjectNode() : r.json;
        out.put("found", node.path("found").asBoolean(false));
        out.put("id", node.path("_id").asText(id));
        out.put("index", node.path("_index").asText(index));
        out.put("version", node.path("_version").asLong(0));
        out.put("source", node.get("_source"));
        return out;
    }

    public Map<String, Object> saveDocument(String connectionId, String index, String id,
                                            String source) throws Exception {
        Session s = required(connectionId);
        validateIndexName(index);
        JsonNode payload = parseOptionalObject(source, "文档内容");
        if (payload == null) {
            payload = OM.createObjectNode();
        }
        String path = "/" + encodeSegment(index) + "/_doc"
                + (isBlank(id) ? "" : "/" + encodeSegment(id))
                + "?refresh=wait_for";
        RawResponse r = execute(s, isBlank(id) ? "POST" : "PUT",
                path, payload.toString(), s.timeoutMs, true);
        JsonNode node = r.json == null ? OM.createObjectNode() : r.json;
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("id", node.path("_id").asText(id));
        out.put("index", node.path("_index").asText(index));
        out.put("result", node.path("result").asText(""));
        out.put("version", node.path("_version").asLong(0));
        return out;
    }

    public Map<String, Object> deleteDocument(String connectionId, String index, String id) throws Exception {
        Session s = required(connectionId);
        if (isBlank(index) || isBlank(id)) {
            throw new IllegalArgumentException("索引和文档 ID 不能为空");
        }
        RawResponse r = execute(s, "DELETE", "/" + encodeSegment(index) + "/_doc/"
                + encodeSegment(id) + "?refresh=wait_for", null, s.timeoutMs, true);
        JsonNode node = r.json == null ? OM.createObjectNode() : r.json;
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("id", node.path("_id").asText(id));
        out.put("result", node.path("result").asText(""));
        return out;
    }

    /* ---------------- REST 控制台 ---------------- */

    public Map<String, Object> console(String connectionId, String method, String path, String body)
            throws Exception {
        Session s = required(connectionId);
        String m = method == null ? "GET" : method.trim().toUpperCase(Locale.ROOT);
        if (!m.matches("GET|POST|PUT|DELETE|HEAD")) {
            throw new IllegalArgumentException("控制台只允许 GET / POST / PUT / DELETE / HEAD");
        }
        String p = path == null ? "" : path.trim();
        if (!p.startsWith("/")) {
            throw new IllegalArgumentException("请求路径必须以 / 开头");
        }
        if (p.length() > 2048 || p.indexOf('\r') >= 0 || p.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("请求路径不合法");
        }
        String payload = body == null ? "" : body.trim();
        if (payload.length() > MAX_CONSOLE_BODY_BYTES) {
            throw new IllegalArgumentException("请求体不能超过 2MB");
        }
        RawResponse r = execute(s, m, p, payload.isEmpty() ? null : payload, s.timeoutMs, false);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("status", r.status);
        out.put("ok", r.status >= 200 && r.status < 300);
        out.put("tookMs", r.tookMs);
        out.put("truncated", r.truncated);
        if (r.json != null) {
            out.put("body", r.json);
        } else if (r.text != null && !r.text.isEmpty()) {
            out.put("body", r.text);
        } else {
            out.put("body", null);
        }
        if (!(r.status >= 200 && r.status < 300)) {
            out.put("error", r.errorMessage());
        }
        return out;
    }

    /* ---------------- HTTP 执行 ---------------- */

    private JsonNode get(Session s, String path) throws Exception {
        RawResponse r = execute(s, "GET", path, null, s.timeoutMs, true);
        if (r.json == null) {
            throw new IllegalArgumentException("Elasticsearch 返回了非 JSON 内容: " + preview(r.text));
        }
        return r.json;
    }

    private RawResponse execute(Session s, String method, String path, String body,
                                int timeoutMs, boolean throwOnError) throws Exception {
        s.lastUsedAt = System.currentTimeMillis();
        String target = urlFor(s, path);
        HttpURLConnection conn = null;
        long start = System.currentTimeMillis();
        try {
            URL url = new URL(target);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(Math.max(3000, timeoutMs));
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", "DeepShell-Elasticsearch-Plugin/1.0");
            if (s.authHeader != null && !s.authHeader.isEmpty()) {
                conn.setRequestProperty("Authorization", s.authHeader);
            }
            if (conn instanceof HttpsURLConnection && s.skipTls) {
                HttpsURLConnection https = (HttpsURLConnection) conn;
                https.setSSLSocketFactory(trustAllContext().getSocketFactory());
                https.setHostnameVerifier(new HostnameVerifier() {
                    @Override
                    public boolean verify(String hostname, SSLSession session) {
                        return true;
                    }
                });
            }
            byte[] bytes = body == null ? null : body.getBytes(StandardCharsets.UTF_8);
            if (bytes != null) {
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(bytes.length);
                OutputStream os = conn.getOutputStream();
                try {
                    os.write(bytes);
                } finally {
                    os.close();
                }
            }
            int status = conn.getResponseCode();
            String text = readLimited(status >= 400 ? conn.getErrorStream() : conn.getInputStream());
            JsonNode json = null;
            if (text != null && !text.trim().isEmpty()) {
                try {
                    json = OM.readTree(text);
                } catch (Exception ignore) {
                    // 控制台可能返回纯文本
                }
            }
            RawResponse r = new RawResponse();
            r.status = status;
            r.text = text;
            r.json = json;
            r.tookMs = System.currentTimeMillis() - start;
            if (throwOnError && status >= 400) {
                throw new IllegalArgumentException(r.errorMessage());
            }
            return r;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (MalformedURLException e) {
            throw new IllegalArgumentException("请求地址不合法: " + target);
        } catch (IOException e) {
            throw new IllegalArgumentException("无法连接 Elasticsearch: " + friendlyNetworkError(e));
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private String urlFor(Session s, String path) {
        String p = path == null || path.isEmpty() ? "/" : path;
        if (!p.startsWith("/")) {
            p = "/" + p;
        }
        if (!s.prefix.isEmpty() && (p.equals(s.prefix) || p.startsWith(s.prefix + "/"))) {
            return s.origin + p;
        }
        return s.baseUrl + p;
    }

    private static String readLimited(InputStream in) throws IOException {
        if (in == null) {
            return "";
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        try {
            int n;
            while ((n = in.read(buf)) > 0) {
                if (total + n > MAX_RESPONSE_BYTES) {
                    out.write(buf, 0, Math.max(0, MAX_RESPONSE_BYTES - total));
                    break;
                }
                out.write(buf, 0, n);
                total += n;
            }
        } finally {
            in.close();
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String friendlyNetworkError(IOException e) {
        String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        String lower = msg.toLowerCase(Locale.ROOT);
        if (lower.contains("connection refused")) {
            return "连接被拒绝，请确认 Elasticsearch 已启动且端口正确";
        }
        if (lower.contains("timed out") || lower.contains("timeout")) {
            return "连接超时，请检查地址、端口与网络";
        }
        if (lower.contains("unknownhost") || lower.contains("unknown host")) {
            return "无法解析主机名";
        }
        if (lower.contains("pkix") || lower.contains("certificate") || lower.contains("ssl")) {
            return "HTTPS 证书校验失败；自签名证书请勾选「忽略 TLS 证书校验」";
        }
        return msg;
    }

    /* ---------------- 会话与参数工具 ---------------- */

    private Session required(String connectionId) {
        if (isBlank(connectionId)) {
            throw new IllegalArgumentException("连接已断开，请重新连接");
        }
        Session s = sessions.get(connectionId);
        if (s == null) {
            throw new IllegalArgumentException("连接已断开，请重新连接");
        }
        if (System.currentTimeMillis() - s.lastUsedAt > IDLE_TIMEOUT_MS) {
            sessions.remove(connectionId, s);
            throw new IllegalArgumentException("连接空闲超过 30 分钟，请重新连接");
        }
        return s;
    }

    private void pruneSessions() {
        long now = System.currentTimeMillis();
        sessions.entrySet().removeIf(e -> now - e.getValue().lastUsedAt > IDLE_TIMEOUT_MS);
        if (sessions.size() < MAX_SESSIONS) {
            return;
        }
        List<Map.Entry<String, Session>> list = new ArrayList<Map.Entry<String, Session>>(sessions.entrySet());
        list.sort(Comparator.comparingLong(e -> e.getValue().lastUsedAt));
        for (int i = 0; i < list.size() - MAX_SESSIONS + 1; i++) {
            sessions.remove(list.get(i).getKey());
        }
    }

    private static NormalizedUrl normalizeUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            throw new IllegalArgumentException("请填写 Elasticsearch 地址");
        }
        if (value.length() > 2048) {
            throw new IllegalArgumentException("地址过长");
        }
        if (!value.toLowerCase(Locale.ROOT).startsWith("http://")
                && !value.toLowerCase(Locale.ROOT).startsWith("https://")) {
            value = "http://" + value;
        }
        URI uri;
        try {
            uri = new URI(value);
        } catch (Exception e) {
            throw new IllegalArgumentException("地址格式不正确，例如 http://127.0.0.1:9200");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            throw new IllegalArgumentException("只支持 http:// 或 https:// 地址");
        }
        if (uri.getHost() == null || uri.getHost().trim().isEmpty()) {
            throw new IllegalArgumentException("地址缺少主机名，例如 http://127.0.0.1:9200");
        }
        if (uri.getUserInfo() != null) {
            throw new IllegalArgumentException("请不要把用户名密码写在地址中，使用下方认证设置");
        }
        if (uri.getQuery() != null || uri.getFragment() != null) {
            throw new IllegalArgumentException("Elasticsearch 地址不能包含查询参数或片段");
        }
        String host = uri.getHost();
        String hostForUrl = host.indexOf(':') >= 0 && !host.startsWith("[") ? "[" + host + "]" : host;
        int port = uri.getPort();
        if (port <= 0) {
            port = "https".equals(scheme) ? 443 : 9200;
        }
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("端口不合法");
        }
        String path = uri.getPath() == null ? "" : uri.getPath().trim();
        while (path.endsWith("/") && path.length() > 1) {
            path = path.substring(0, path.length() - 1);
        }
        if ("/".equals(path)) {
            path = "";
        }
        if (!path.isEmpty() && !path.startsWith("/")) {
            path = "/" + path;
        }
        if (path.contains("..")) {
            throw new IllegalArgumentException("地址路径不能包含 ..");
        }
        NormalizedUrl n = new NormalizedUrl();
        n.origin = scheme + "://" + hostForUrl + ":" + port;
        n.baseUrl = n.origin + path;
        n.prefix = path;
        return n;
    }

    private static String normalizeAuthType(String authType) {
        String t = authType == null ? "" : authType.trim().toLowerCase(Locale.ROOT);
        if ("basic".equals(t)) {
            return "basic";
        }
        if ("apikey".equals(t) || "api_key".equals(t) || "api-key".equals(t)) {
            return "apiKey";
        }
        return "none";
    }

    private static String buildAuthHeader(String type, String username, String secret) {
        if ("basic".equals(type)) {
            String user = username == null ? "" : username.trim();
            if (user.isEmpty()) {
                throw new IllegalArgumentException("基础认证需要填写用户名");
            }
            String raw = user + ":" + (secret == null ? "" : secret);
            return "Basic " + Base64.getEncoder().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
        }
        if ("apiKey".equals(type)) {
            String key = secret == null ? "" : secret.trim();
            if (key.isEmpty()) {
                throw new IllegalArgumentException("API Key 认证需要填写 API Key");
            }
            if (key.toLowerCase(Locale.ROOT).startsWith("apikey ")) {
                key = key.substring(7).trim();
            }
            return "ApiKey " + key;
        }
        return "";
    }

    private static JsonNode parseOptionalObject(String raw, String label) {
        if (raw == null || raw.trim().isEmpty()) {
            return null;
        }
        JsonNode node;
        try {
            node = OM.readTree(raw);
        } catch (Exception e) {
            throw new IllegalArgumentException(label + "不是合法 JSON: " + e.getMessage());
        }
        if (!node.isObject()) {
            throw new IllegalArgumentException(label + "必须是 JSON 对象");
        }
        return node;
    }

    private static void validateIndexName(String index) {
        if (isBlank(index)) {
            throw new IllegalArgumentException("请填写索引名称");
        }
        String name = index.trim();
        if (name.length() > 255) {
            throw new IllegalArgumentException("索引名称不能超过 255 个字符");
        }
        if (name.startsWith("_") || name.startsWith("-") || name.startsWith("+")) {
            throw new IllegalArgumentException("索引名称不能以 _、- 或 + 开头");
        }
        if (".".equals(name) || "..".equals(name)) {
            throw new IllegalArgumentException("索引名称不能是 . 或 ..");
        }
        if (!name.equals(name.toLowerCase(Locale.ROOT))) {
            throw new IllegalArgumentException("索引名称必须是小写");
        }
        if (name.matches(".*[\\\\/*?\"<>| ,#:].*")) {
            throw new IllegalArgumentException("索引名称包含不允许的字符");
        }
    }

    private static String encodeSegment(String value) {
        String v = value == null ? "" : value.trim();
        try {
            return URLEncoder.encode(v, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return v;
        }
    }

    private static long longValue(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return 0;
        }
        if (node.isNumber()) {
            return node.asLong(0);
        }
        try {
            String s = node.asText("").trim();
            return s.isEmpty() || "null".equals(s) ? 0 : Long.parseLong(s);
        } catch (Exception e) {
            return 0;
        }
    }

    private static int intValue(JsonNode node) {
        return (int) longValue(node);
    }

    private static String preview(String text) {
        if (text == null) {
            return "";
        }
        String s = text.replace('\r', ' ').replace('\n', ' ').trim();
        return s.length() > 200 ? s.substring(0, 200) + "..." : s;
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    private static SSLContext trustAllContext() throws Exception {
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[]{new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String authType) {
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String authType) {
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        }}, new SecureRandom());
        return context;
    }

    private static final class NormalizedUrl {
        String origin;
        String baseUrl;
        String prefix;
    }

    static final class Session {
        String id;
        String origin;
        String baseUrl;
        String prefix;
        String url;
        String authHeader;
        String authType;
        String username;
        int timeoutMs;
        boolean skipTls;
        long lastUsedAt;
        JsonNode root;
    }

    static final class RawResponse {
        int status;
        String text;
        JsonNode json;
        long tookMs;
        boolean truncated;

        String errorMessage() {
            if (json != null) {
                JsonNode error = json.path("error");
                if (error.isObject()) {
                    String reason = error.path("reason").asText("");
                    String type = error.path("type").asText("");
                    JsonNode cause = error.path("root_cause");
                    if (cause.isArray() && cause.size() > 0) {
                        String root = cause.get(0).path("reason").asText("");
                        if (!root.isEmpty()) {
                            reason = root;
                        }
                    }
                    if (!reason.isEmpty()) {
                        return (type.isEmpty() ? "" : type + ": ") + reason;
                    }
                } else if (error.isTextual()) {
                    return error.asText();
                }
            }
            if (status == 401) {
                return "认证失败，请检查用户名密码或 API Key";
            }
            if (status == 403) {
                return "当前账号没有执行该操作的权限";
            }
            String p = preview(text);
            return "Elasticsearch 返回 HTTP " + status + (p.isEmpty() ? "" : ": " + p);
        }
    }
}
