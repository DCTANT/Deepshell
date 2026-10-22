package com.itdct.deepshell.plugin.redis;

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
 * DeepShell Redis 桌面插件的后端模块。JAR 随插件 ZIP 分发，由
 * PluginRuntimeService 在 DeepShell 启动时加载；不依赖 Spring / Maven 宿主依赖。
 *
 * <p>连接配置保存在插件数据目录，密码使用宿主机密服务加密，接口不会把密码回传给前端。</p>
 */
public class RedisPluginModule implements DesktopPluginModule {

    private static final String PROFILE_FILE = "connections.properties";
    private static final int MAX_PROFILES = 100;

    private final RedisClientService redis = new RedisClientService();
    private final Map<String, Profile> profiles = new LinkedHashMap<String, Profile>();
    private PluginContext context;

    @Override
    public String id() {
        return "com.deepshell.redis";
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
    public Object invoke(String action, Map<String, Object> payload) {
        Map<String, Object> p = payload == null ? Collections.<String, Object>emptyMap() : payload;
        if ("connect".equals(action)) {
            return connect(p);
        }
        if ("disconnect".equals(action)) {
            redis.disconnect(str(p, "connectionId"));
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
        if ("select".equals(action)) {
            return redis.select(str(p, "connectionId"), intVal(p, "db", 0));
        }
        if ("scan".equals(action)) {
            return redis.scan(str(p, "connectionId"), str(p, "cursor"), str(p, "match"),
                    intVal(p, "count", 100));
        }
        if ("key".equals(action)) {
            return redis.key(str(p, "connectionId"), str(p, "key"), intVal(p, "limit", 500));
        }
        if ("string/save".equals(action)) {
            return redis.setString(str(p, "connectionId"), str(p, "key"), str(p, "value"));
        }
        if ("ttl".equals(action)) {
            return redis.setTtl(str(p, "connectionId"), str(p, "key"), longVal(p, "ttl", -1));
        }
        if ("rename".equals(action)) {
            return redis.rename(str(p, "connectionId"), str(p, "key"), str(p, "newKey"));
        }
        if ("delete".equals(action)) {
            return redis.delete(str(p, "connectionId"), str(p, "key"));
        }
        if ("hash".equals(action)) {
            return redis.editHash(str(p, "connectionId"), str(p, "key"), str(p, "op"),
                    str(p, "field"), str(p, "value"));
        }
        if ("list".equals(action)) {
            return redis.editList(str(p, "connectionId"), str(p, "key"), str(p, "op"),
                    intVal(p, "index", -1), str(p, "value"));
        }
        if ("set".equals(action)) {
            return redis.editSet(str(p, "connectionId"), str(p, "key"), str(p, "op"),
                    str(p, "member"));
        }
        if ("zset".equals(action)) {
            return redis.editZset(str(p, "connectionId"), str(p, "key"), str(p, "op"),
                    str(p, "member"), doubleVal(p, "score", 0));
        }
        if ("command".equals(action)) {
            return redis.command(str(p, "connectionId"), str(p, "command"));
        }
        if ("info".equals(action)) {
            return redis.info(str(p, "connectionId"));
        }
        throw new IllegalArgumentException("未知的 Redis 插件操作: " + action);
    }

    @Override
    public void close() {
        redis.shutdown();
    }

    private Map<String, Object> connect(Map<String, Object> p) {
        String profileId = str(p, "profileId").trim();
        Profile profile = profileId.isEmpty() ? null : profiles.get(profileId);
        if (!profileId.isEmpty() && profile == null) {
            throw new IllegalArgumentException("保存的连接不存在，请重新选择");
        }
        String host = str(p, "host").trim();
        String username = str(p, "username").trim();
        String password = str(p, "password");
        int port = intVal(p, "port", 6379);
        int db = intVal(p, "db", 0);
        int timeoutMs = intVal(p, "timeoutMs", 5000);

        if (profile != null) {
            if (host.isEmpty()) {
                host = profile.host;
            }
            if (port <= 0) {
                port = profile.port;
            }
            if (username.isEmpty()) {
                username = profile.username;
            }
            if (password.isEmpty()) {
                password = decrypt(profile.passwordCipher);
            }
            if (p.get("db") == null) {
                db = profile.db;
            }
            if (p.get("timeoutMs") == null) {
                timeoutMs = profile.timeoutMs;
            }
        }
        if (host.isEmpty()) {
            throw new IllegalArgumentException("请填写 Redis 主机");
        }
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("Redis 端口需在 1-65535 之间");
        }
        if (db < 0 || db > 255) {
            throw new IllegalArgumentException("数据库编号需在 0-255 之间");
        }
        Map<String, Object> result = redis.connect(host, port, username, password, db,
                Math.max(1000, Math.min(60000, timeoutMs)));
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
        String host = str(p, "host").trim();
        if (host.isEmpty()) {
            throw new IllegalArgumentException("请填写 Redis 主机");
        }
        int port = intVal(p, "port", 6379);
        int db = intVal(p, "db", 0);
        int timeoutMs = intVal(p, "timeoutMs", 5000);
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("Redis 端口需在 1-65535 之间");
        }
        if (db < 0 || db > 255) {
            throw new IllegalArgumentException("数据库编号需在 0-255 之间");
        }
        String name = str(p, "name").trim();
        profile.name = name.isEmpty() ? host + ":" + port : name;
        profile.host = host;
        profile.port = port;
        profile.username = str(p, "username").trim();
        profile.db = db;
        profile.timeoutMs = Math.max(1000, Math.min(60000, timeoutMs));
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
        out.put("host", profile.host);
        out.put("port", profile.port);
        out.put("username", profile.username);
        out.put("db", profile.db);
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
            String host = props.getProperty("conn." + key + ".host", "").trim();
            if (host.isEmpty()) {
                continue;
            }
            Profile profile = new Profile();
            profile.id = key;
            profile.name = props.getProperty("conn." + key + ".name", host).trim();
            profile.host = host;
            profile.port = parseInt(props.getProperty("conn." + key + ".port"), 6379);
            profile.username = props.getProperty("conn." + key + ".username", "").trim();
            profile.db = parseInt(props.getProperty("conn." + key + ".db"), 0);
            profile.timeoutMs = parseInt(props.getProperty("conn." + key + ".timeout"), 5000);
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
            props.setProperty(prefix + "host", profile.host == null ? "" : profile.host);
            props.setProperty(prefix + "port", String.valueOf(profile.port));
            props.setProperty(prefix + "username", profile.username == null ? "" : profile.username);
            props.setProperty(prefix + "db", String.valueOf(profile.db));
            props.setProperty(prefix + "timeout", String.valueOf(profile.timeoutMs));
            props.setProperty(prefix + "password", profile.passwordCipher == null ? "" : profile.passwordCipher);
            props.setProperty(prefix + "lastUsed", String.valueOf(profile.lastUsedAt));
        }
        props.setProperty("order", order.toString());
        Path temp = file.resolveSibling(file.getFileName().toString() + ".tmp");
        try (Writer writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
            props.store(writer, "DeepShell Redis saved connections");
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

    private static double doubleVal(Map<String, Object> map, String key, double fallback) {
        Object v = map.get(key);
        if (v instanceof Number) {
            return ((Number) v).doubleValue();
        }
        if (v != null) {
            try {
                return Double.parseDouble(String.valueOf(v));
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
        String host = "";
        String username = "";
        int port = 6379;
        int db;
        int timeoutMs = 5000;
        String passwordCipher = "";
        long lastUsedAt;
    }
}
