package com.itdct.deepshell.plugin.mongodb;

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
 * DeepShell MongoDB 桌面插件的后端模块。
 *
 * <p>连接配置保存在插件数据目录，密码使用宿主机密服务加密保存，接口不会回传密码。</p>
 */
public class MongoPluginModule implements DesktopPluginModule {

    private static final String PROFILE_FILE = "connections.properties";
    private static final int MAX_PROFILES = 100;

    private final MongoClientService mongo = new MongoClientService();
    private final Map<String, Profile> profiles = new LinkedHashMap<String, Profile>();
    private PluginContext context;

    @Override
    public String id() {
        return "com.deepshell.mongodb";
    }

    @Override
    public void initialize(PluginContext context) {
        this.context = context;
        try {
            loadProfiles();
        } catch (Exception ignore) {
            // 配置读取失败时保留空列表，用户仍可手动连接并重新保存
        }
    }

    @Override
    public Object invoke(String action, Map<String, Object> payload) throws Exception {
        // 驱动会在执行期间按上下文类加载器加载可选组件，插件类只在独立 URLClassLoader 中可见。
        ClassLoader previous = Thread.currentThread().getContextClassLoader();
        Thread.currentThread().setContextClassLoader(MongoPluginModule.class.getClassLoader());
        try {
            return dispatch(action, payload);
        } finally {
            Thread.currentThread().setContextClassLoader(previous);
        }
    }

    private Object dispatch(String action, Map<String, Object> payload) throws Exception {
        Map<String, Object> p = payload == null
                ? Collections.<String, Object>emptyMap() : payload;
        if ("connect".equals(action)) {
            return connect(p);
        }
        if ("disconnect".equals(action)) {
            mongo.disconnect(str(p, "connectionId"));
            return null;
        }
        if ("overview".equals(action)) {
            return mongo.overview(str(p, "connectionId"));
        }
        if ("databases/list".equals(action)) {
            return mongo.databases(str(p, "connectionId"));
        }
        if ("database/describe".equals(action)) {
            return mongo.describeDatabase(str(p, "connectionId"), str(p, "database"));
        }
        if ("database/drop".equals(action)) {
            mongo.dropDatabase(str(p, "connectionId"), str(p, "database"), bool(p, "confirm"));
            return null;
        }
        if ("collections/list".equals(action)) {
            return mongo.collections(str(p, "connectionId"), str(p, "database"));
        }
        if ("collection/create".equals(action)) {
            mongo.createCollection(str(p, "connectionId"), str(p, "database"), str(p, "collection"));
            return null;
        }
        if ("collection/drop".equals(action)) {
            mongo.dropCollection(str(p, "connectionId"), str(p, "database"), str(p, "collection"),
                    bool(p, "confirm"));
            return null;
        }
        if ("collection/stats".equals(action)) {
            return mongo.collectionStats(str(p, "connectionId"), str(p, "database"),
                    str(p, "collection"));
        }
        if ("docs/find".equals(action)) {
            return mongo.find(str(p, "connectionId"), str(p, "database"), str(p, "collection"),
                    str(p, "filter"), str(p, "sort"), str(p, "projection"),
                    intVal(p, "skip", 0), intVal(p, "limit", 20));
        }
        if ("docs/count".equals(action)) {
            return mongo.count(str(p, "connectionId"), str(p, "database"), str(p, "collection"),
                    str(p, "filter"), bool(p, "estimated"));
        }
        if ("docs/insert".equals(action)) {
            return mongo.insert(str(p, "connectionId"), str(p, "database"), str(p, "collection"),
                    str(p, "document"));
        }
        if ("docs/replace".equals(action)) {
            return mongo.replace(str(p, "connectionId"), str(p, "database"), str(p, "collection"),
                    str(p, "filter"), str(p, "document"), bool(p, "confirm"));
        }
        if ("docs/update".equals(action)) {
            return mongo.update(str(p, "connectionId"), str(p, "database"), str(p, "collection"),
                    str(p, "filter"), str(p, "update"), bool(p, "multi"), bool(p, "upsert"),
                    bool(p, "confirm"));
        }
        if ("docs/delete".equals(action)) {
            return mongo.delete(str(p, "connectionId"), str(p, "database"), str(p, "collection"),
                    str(p, "filter"), bool(p, "multi"), bool(p, "confirm"));
        }
        if ("indexes/list".equals(action)) {
            return mongo.indexes(str(p, "connectionId"), str(p, "database"), str(p, "collection"));
        }
        if ("indexes/create".equals(action)) {
            mongo.createIndex(str(p, "connectionId"), str(p, "database"), str(p, "collection"),
                    str(p, "keys"), str(p, "name"), bool(p, "unique"), bool(p, "sparse"),
                    longVal(p, "ttl", -1));
            return null;
        }
        if ("indexes/drop".equals(action)) {
            mongo.dropIndex(str(p, "connectionId"), str(p, "database"), str(p, "collection"),
                    str(p, "name"));
            return null;
        }
        if ("command".equals(action)) {
            return mongo.runCommand(str(p, "connectionId"), str(p, "database"), str(p, "command"));
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
        throw new IllegalArgumentException("未知的 MongoDB 插件操作: " + action);
    }

    @Override
    public void close() {
        mongo.shutdown();
    }

    private Map<String, Object> connect(Map<String, Object> p) {
        String profileId = str(p, "profileId").trim();
        Profile profile = profileId.isEmpty() ? null : profiles.get(profileId);
        if (!profileId.isEmpty() && profile == null) {
            throw new IllegalArgumentException("保存的连接不存在，请重新选择");
        }
        String hosts = str(p, "hosts").trim();
        String username = str(p, "username").trim();
        String password = str(p, "password");
        String authSource = str(p, "authSource").trim();
        String mechanism = str(p, "mechanism").trim();
        boolean tls = bool(p, "tls");
        int timeoutMs = intVal(p, "timeoutMs", 8000);

        if (profile != null) {
            if (hosts.isEmpty()) {
                hosts = profile.hosts;
            }
            if (username.isEmpty()) {
                username = profile.username;
            }
            if (password.isEmpty()) {
                password = decrypt(profile.passwordCipher);
            }
            if (authSource.isEmpty()) {
                authSource = profile.authSource;
            }
            if (mechanism.isEmpty()) {
                mechanism = profile.mechanism;
            }
            if (p.get("tls") == null) {
                tls = profile.tls;
            }
            if (p.get("timeoutMs") == null) {
                timeoutMs = profile.timeoutMs;
            }
        }
        if (hosts.isEmpty()) {
            throw new IllegalArgumentException("请填写 MongoDB 地址（如 127.0.0.1:27017）");
        }
        if (timeoutMs < 2000 || timeoutMs > 60000) {
            throw new IllegalArgumentException("超时时间需在 2000-60000 毫秒之间");
        }
        Map<String, Object> result = mongo.connect(hosts, username, password, authSource,
                mechanism, tls, timeoutMs);
        if (profile != null) {
            profile.lastUsedAt = System.currentTimeMillis();
            try {
                saveProfiles();
            } catch (IOException ignore) {
                // 连接已成功，最近使用时间写入失败不影响本次连接
            }
        }
        return result;
    }

    private List<Map<String, Object>> listProfiles() {
        List<Profile> list = new ArrayList<Profile>(profiles.values());
        Collections.sort(list, new Comparator<Profile>() {
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
        String hosts = str(p, "hosts").trim();
        if (hosts.isEmpty()) {
            throw new IllegalArgumentException("请填写 MongoDB 地址");
        }
        int timeoutMs = intVal(p, "timeoutMs", 8000);
        if (timeoutMs < 2000 || timeoutMs > 60000) {
            throw new IllegalArgumentException("超时时间需在 2000-60000 毫秒之间");
        }
        String name = str(p, "name").trim();
        profile.name = name.isEmpty() ? hosts : name;
        profile.hosts = hosts;
        profile.username = str(p, "username").trim();
        String authSource = str(p, "authSource").trim();
        profile.authSource = authSource.isEmpty() ? "admin" : authSource;
        String mechanism = str(p, "mechanism").trim().toUpperCase();
        profile.mechanism = mechanism.isEmpty() ? "SCRAM-SHA-256" : mechanism;
        profile.tls = bool(p, "tls");
        profile.timeoutMs = timeoutMs;
        profile.lastUsedAt = System.currentTimeMillis();
        if (bool(p, "clearPassword")) {
            profile.passwordCipher = "";
        } else {
            String password = str(p, "password");
            if (!password.isEmpty()) {
                String encrypted = encrypt(password);
                if (encrypted == null || encrypted.isEmpty()) {
                    throw new IllegalArgumentException("密码加密失败，无法保存连接");
                }
                profile.passwordCipher = encrypted;
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
        out.put("hosts", profile.hosts);
        out.put("username", profile.username);
        out.put("authSource", profile.authSource);
        out.put("mechanism", profile.mechanism);
        out.put("tls", profile.tls);
        out.put("timeoutMs", profile.timeoutMs);
        out.put("lastUsedAt", profile.lastUsedAt);
        out.put("hasPassword", profile.passwordCipher != null && !profile.passwordCipher.isEmpty());
        return out;
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
            throw new IllegalArgumentException("保存的密码无法解密，请重新输入密码");
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
            String hosts = props.getProperty("conn." + key + ".hosts", "").trim();
            if (hosts.isEmpty()) {
                continue;
            }
            Profile profile = new Profile();
            profile.id = key;
            profile.name = props.getProperty("conn." + key + ".name", hosts).trim();
            profile.hosts = hosts;
            profile.username = props.getProperty("conn." + key + ".username", "").trim();
            profile.authSource = props.getProperty("conn." + key + ".authSource", "admin").trim();
            profile.mechanism = props.getProperty("conn." + key + ".mechanism", "SCRAM-SHA-256").trim();
            profile.tls = "true".equalsIgnoreCase(props.getProperty("conn." + key + ".tls", "false"));
            profile.timeoutMs = parseInt(props.getProperty("conn." + key + ".timeout"), 8000);
            profile.passwordCipher = props.getProperty("conn." + key + ".password", "");
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
            props.setProperty(prefix + "hosts", profile.hosts == null ? "" : profile.hosts);
            props.setProperty(prefix + "username", profile.username == null ? "" : profile.username);
            props.setProperty(prefix + "authSource", profile.authSource == null ? "" : profile.authSource);
            props.setProperty(prefix + "mechanism", profile.mechanism == null ? "" : profile.mechanism);
            props.setProperty(prefix + "tls", String.valueOf(profile.tls));
            props.setProperty(prefix + "timeout", String.valueOf(profile.timeoutMs));
            props.setProperty(prefix + "password", profile.passwordCipher == null ? "" : profile.passwordCipher);
            props.setProperty(prefix + "lastUsed", String.valueOf(profile.lastUsedAt));
        }
        props.setProperty("order", order.toString());
        Path temp = file.resolveSibling(file.getFileName().toString() + ".tmp");
        try (Writer writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
            props.store(writer, "DeepShell MongoDB saved connections");
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

    private static long longVal(Map<String, Object> map, String key, long fallback) {
        Object v = map.get(key);
        if (v instanceof Number) {
            return ((Number) v).longValue();
        }
        if (v != null) {
            try {
                return Long.parseLong(String.valueOf(v));
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
        String hosts = "";
        String username = "";
        String authSource = "admin";
        String mechanism = "SCRAM-SHA-256";
        boolean tls;
        int timeoutMs = 8000;
        String passwordCipher = "";
        long lastUsedAt;
    }
}
