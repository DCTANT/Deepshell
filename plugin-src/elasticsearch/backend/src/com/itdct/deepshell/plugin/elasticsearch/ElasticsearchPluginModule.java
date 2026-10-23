package com.itdct.deepshell.plugin.elasticsearch;

import com.itdct.deepshell.plugin.DesktopPluginModule;
import com.itdct.deepshell.plugin.PluginContext;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

/**
 * DeepShell Elasticsearch 桌面插件的后端模块。
 *
 * <p>连接与查询由本模块在 DeepShell 服务端完成；保存的连接密码 / API Key 使用宿主
 * 本机密钥加密，明文不会回传给浏览器。插件不依赖 Spring 或 Elasticsearch SDK。</p>
 */
public class ElasticsearchPluginModule implements DesktopPluginModule {

    private static final String PROFILE_FILE = "connections.properties";
    private static final int MAX_PROFILES = 100;

    private final ElasticsearchClientService es = new ElasticsearchClientService();
    private final Map<String, Profile> profiles = new LinkedHashMap<String, Profile>();
    private PluginContext context;

    @Override
    public String id() {
        return "com.deepshell.elasticsearch";
    }

    @Override
    public void initialize(PluginContext context) {
        this.context = context;
        try {
            loadProfiles();
        } catch (Exception ignore) {
            // 配置损坏时保留空列表，用户仍可手动连接
        }
    }

    @Override
    public Object invoke(String action, Map<String, Object> payload) throws Exception {
        Map<String, Object> p = payload == null ? Collections.<String, Object>emptyMap() : payload;
        if ("connect".equals(action)) {
            return connect(p);
        }
        if ("disconnect".equals(action)) {
            es.disconnect(str(p, "connectionId"));
            return null;
        }
        if ("profiles/list".equals(action)) {
            return listProfiles();
        }
        if ("profiles/save".equals(action)) {
            return saveProfile(p);
        }
        if ("profiles/delete".equals(action)) {
            return deleteProfile(p);
        }
        if ("overview".equals(action)) {
            return es.overview(str(p, "connectionId"));
        }
        if ("indices".equals(action)) {
            return es.indices(str(p, "connectionId"));
        }
        if ("index".equals(action)) {
            return es.indexDetail(str(p, "connectionId"), str(p, "index"));
        }
        if ("search".equals(action)) {
            return es.search(str(p, "connectionId"), str(p, "index"), str(p, "query"),
                    intVal(p, "from", 0), intVal(p, "size", 20));
        }
        if ("document".equals(action)) {
            return es.document(str(p, "connectionId"), str(p, "index"), str(p, "id"));
        }
        if ("document/save".equals(action)) {
            return es.saveDocument(str(p, "connectionId"), str(p, "index"), str(p, "id"),
                    str(p, "source"));
        }
        if ("document/delete".equals(action)) {
            return es.deleteDocument(str(p, "connectionId"), str(p, "index"), str(p, "id"));
        }
        if ("index/create".equals(action)) {
            return es.createIndex(str(p, "connectionId"), str(p, "index"), str(p, "body"));
        }
        if ("index/delete".equals(action)) {
            return es.deleteIndex(str(p, "connectionId"), str(p, "index"));
        }
        if ("index/refresh".equals(action)) {
            return es.refreshIndex(str(p, "connectionId"), str(p, "index"));
        }
        if ("console".equals(action)) {
            return es.console(str(p, "connectionId"), str(p, "method"), str(p, "path"), str(p, "body"));
        }
        throw new IllegalArgumentException("未知的 Elasticsearch 插件操作: " + action);
    }

    @Override
    public void close() {
        es.shutdown();
    }

    /* ---------------- 连接 ---------------- */

    private Map<String, Object> connect(Map<String, Object> p) throws Exception {
        String profileId = str(p, "profileId").trim();
        Profile profile = profileId.isEmpty() ? null : profiles.get(profileId);
        if (!profileId.isEmpty() && profile == null) {
            throw new IllegalArgumentException("保存的连接不存在，请重新选择");
        }
        String url = str(p, "url").trim();
        String username = str(p, "username").trim();
        String authType = str(p, "authType").trim();
        String secret = str(p, "secret");
        boolean skipTls = p.containsKey("skipTls") ? bool(p, "skipTls") : false;
        int timeoutMs = intVal(p, "timeoutMs", 15000);
        if (profile != null) {
            if (url.isEmpty()) {
                url = profile.url;
            }
            if (username.isEmpty()) {
                username = profile.username;
            }
            if (authType.isEmpty()) {
                authType = profile.authType;
            }
            if (secret.isEmpty() && !"none".equalsIgnoreCase(authType)) {
                secret = decrypt(profile.secretCipher);
            }
            if (!p.containsKey("skipTls")) {
                skipTls = profile.skipTls;
            }
            if (p.get("timeoutMs") == null) {
                timeoutMs = profile.timeoutMs;
            }
        }
        if (url.isEmpty()) {
            throw new IllegalArgumentException("请填写 Elasticsearch 地址");
        }
        Map<String, Object> result = es.connect(url, username, secret, authType, skipTls, timeoutMs);
        if (profile != null) {
            profile.lastUsedAt = System.currentTimeMillis();
            try {
                saveProfiles();
            } catch (IOException ignore) {
                // 已连接成功，最近使用时间写入失败不影响本次连接
            }
        }
        result.put("profileId", profile == null ? "" : profile.id);
        return result;
    }

    /* ---------------- 已保存连接 ---------------- */

    private List<Map<String, Object>> listProfiles() {
        List<Profile> list = new ArrayList<Profile>(profiles.values());
        list.sort(new Comparator<Profile>() {
            @Override
            public int compare(Profile a, Profile b) {
                int byTime = Long.compare(b.lastUsedAt, a.lastUsedAt);
                return byTime != 0 ? byTime : a.name.compareToIgnoreCase(b.name);
            }
        });
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (Profile profile : list) {
            out.add(safe(profile));
        }
        return out;
    }

    private Map<String, Object> saveProfile(Map<String, Object> p) {
        String id = str(p, "id").trim();
        Profile profile = id.isEmpty() ? null : profiles.get(id);
        if (profile == null) {
            if (profiles.size() >= MAX_PROFILES) {
                throw new IllegalArgumentException("最多保存 " + MAX_PROFILES + " 个连接，请先删除不用的连接");
            }
            profile = new Profile();
            profile.id = UUID.randomUUID().toString().replace("-", "");
        }
        String url = str(p, "url").trim();
        if (url.isEmpty()) {
            throw new IllegalArgumentException("请填写 Elasticsearch 地址");
        }
        String authType = normalizeAuthType(str(p, "authType"));
        String name = str(p, "name").trim();
        profile.name = name.isEmpty() ? defaultName(url) : name;
        profile.url = url;
        profile.username = str(p, "username").trim();
        profile.authType = authType;
        profile.timeoutMs = Math.max(3000, Math.min(60000, intVal(p, "timeoutMs", 15000)));
        profile.skipTls = bool(p, "skipTls");
        profile.lastUsedAt = System.currentTimeMillis();
        if (bool(p, "clearSecret")) {
            profile.secretCipher = "";
        } else {
            String secret = str(p, "secret");
            if (!secret.isEmpty()) {
                String encrypted = encrypt(secret);
                if (encrypted == null || encrypted.isEmpty()) {
                    throw new IllegalArgumentException("凭据加密失败，无法保存连接");
                }
                profile.secretCipher = encrypted;
            }
        }
        profiles.put(profile.id, profile);
        try {
            saveProfiles();
        } catch (IOException e) {
            profiles.remove(profile.id);
            throw new IllegalArgumentException("保存连接失败: " + e.getMessage());
        }
        return safe(profile);
    }

    private Object deleteProfile(Map<String, Object> p) {
        String id = str(p, "id").trim();
        if (id.isEmpty()) {
            throw new IllegalArgumentException("缺少连接 ID");
        }
        if (profiles.remove(id) != null) {
            try {
                saveProfiles();
            } catch (IOException e) {
                throw new IllegalArgumentException("删除连接失败: " + e.getMessage());
            }
        }
        return null;
    }

    private Map<String, Object> safe(Profile profile) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("id", profile.id);
        out.put("name", profile.name);
        out.put("url", profile.url);
        out.put("username", profile.username);
        out.put("authType", profile.authType);
        out.put("timeoutMs", profile.timeoutMs);
        out.put("skipTls", profile.skipTls);
        out.put("lastUsedAt", profile.lastUsedAt);
        out.put("hasSecret", profile.secretCipher != null && !profile.secretCipher.isEmpty());
        return out;
    }

    private static String normalizeAuthType(String value) {
        String v = value == null ? "" : value.trim().toLowerCase();
        if ("basic".equals(v)) {
            return "basic";
        }
        if ("apikey".equals(v) || "api_key".equals(v) || "api-key".equals(v)) {
            return "apiKey";
        }
        return "none";
    }

    private static String defaultName(String url) {
        try {
            java.net.URI uri = new java.net.URI(url.startsWith("http") ? url : "http://" + url);
            String host = uri.getHost() == null ? url : uri.getHost();
            int port = uri.getPort() > 0 ? uri.getPort() : ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 9200);
            return host + ":" + port;
        } catch (Exception ignore) {
            return url;
        }
    }

    private String encrypt(String plain) {
        if (context == null) {
            throw new IllegalStateException("插件环境尚未初始化");
        }
        return context.encryptSecret(plain);
    }

    private String decrypt(String cipher) {
        if (cipher == null || cipher.isEmpty() || context == null) {
            return "";
        }
        String plain = context.decryptSecret(cipher);
        if (plain == null) {
            throw new IllegalArgumentException("保存的凭据无法解密，请重新填写密码或 API Key");
        }
        return plain;
    }

    private Path profileFile() throws IOException {
        if (context == null || context.getDataDir() == null) {
            throw new IOException("插件数据目录不可用");
        }
        Files.createDirectories(context.getDataDir());
        return context.getDataDir().resolve(PROFILE_FILE);
    }

    private void loadProfiles() throws IOException {
        Path file = profileFile();
        if (!Files.isRegularFile(file)) {
            return;
        }
        Properties props = new Properties();
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            props.load(reader);
        }
        String order = props.getProperty("order", "");
        profiles.clear();
        if (order.trim().isEmpty()) {
            return;
        }
        for (String id : order.split(",")) {
            String key = id.trim();
            if (key.isEmpty() || profiles.containsKey(key)) {
                continue;
            }
            String url = props.getProperty("conn." + key + ".url", "").trim();
            if (url.isEmpty()) {
                continue;
            }
            Profile profile = new Profile();
            profile.id = key;
            profile.name = props.getProperty("conn." + key + ".name", defaultName(url)).trim();
            profile.url = url;
            profile.username = props.getProperty("conn." + key + ".username", "").trim();
            profile.authType = normalizeAuthType(props.getProperty("conn." + key + ".authType", "none"));
            profile.timeoutMs = parseInt(props.getProperty("conn." + key + ".timeout"), 15000);
            profile.skipTls = Boolean.parseBoolean(props.getProperty("conn." + key + ".skipTls", "false"));
            profile.secretCipher = props.getProperty("conn." + key + ".secret", "");
            profile.lastUsedAt = parseLong(props.getProperty("conn." + key + ".lastUsed"), 0L);
            profiles.put(profile.id, profile);
        }
    }

    private void saveProfiles() throws IOException {
        Path file = profileFile();
        Properties props = new Properties();
        StringBuilder order = new StringBuilder();
        for (Profile profile : profiles.values()) {
            if (order.length() > 0) {
                order.append(',');
            }
            order.append(profile.id);
            String prefix = "conn." + profile.id + ".";
            props.setProperty(prefix + "name", profile.name == null ? "" : profile.name);
            props.setProperty(prefix + "url", profile.url == null ? "" : profile.url);
            props.setProperty(prefix + "username", profile.username == null ? "" : profile.username);
            props.setProperty(prefix + "authType", profile.authType == null ? "none" : profile.authType);
            props.setProperty(prefix + "timeout", String.valueOf(profile.timeoutMs));
            props.setProperty(prefix + "skipTls", String.valueOf(profile.skipTls));
            props.setProperty(prefix + "secret", profile.secretCipher == null ? "" : profile.secretCipher);
            props.setProperty(prefix + "lastUsed", String.valueOf(profile.lastUsedAt));
        }
        props.setProperty("order", order.toString());
        Path temp = file.resolveSibling(file.getFileName().toString() + ".tmp");
        try (Writer writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
            props.store(writer, "DeepShell Elasticsearch saved connections");
        }
        try {
            Files.move(temp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                    java.nio.file.StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception atomicFailed) {
            Files.move(temp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        try {
            Files.setPosixFilePermissions(file,
                    java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (Exception ignore) {
            // Windows 等不支持 POSIX 权限的文件系统直接忽略
        }
    }

    private static String str(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v == null ? "" : String.valueOf(v);
    }

    private static boolean bool(Map<String, Object> map, String key) {
        Object v = map.get(key);
        if (v instanceof Boolean) {
            return (Boolean) v;
        }
        return v != null && "true".equalsIgnoreCase(String.valueOf(v));
    }

    private static int intVal(Map<String, Object> map, String key, int fallback) {
        Object v = map.get(key);
        if (v instanceof Number) {
            return ((Number) v).intValue();
        }
        if (v != null) {
            try {
                return Integer.parseInt(String.valueOf(v));
            } catch (NumberFormatException ignore) {
                // ignore
            }
        }
        return fallback;
    }

    private static int parseInt(String value, int fallback) {
        try {
            return Integer.parseInt(value == null ? "" : value.trim());
        } catch (NumberFormatException ignore) {
            return fallback;
        }
    }

    private static long parseLong(String value, long fallback) {
        try {
            return Long.parseLong(value == null ? "" : value.trim());
        } catch (NumberFormatException ignore) {
            return fallback;
        }
    }

    private static final class Profile {
        String id = "";
        String name = "";
        String url = "";
        String username = "";
        String authType = "none";
        int timeoutMs = 15000;
        boolean skipTls;
        String secretCipher = "";
        long lastUsedAt;
    }
}
