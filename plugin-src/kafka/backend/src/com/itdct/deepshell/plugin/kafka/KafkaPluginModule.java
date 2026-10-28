package com.itdct.deepshell.plugin.kafka;

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
 * DeepShell Kafka 桌面插件的后端模块。
 *
 * <p>连接配置保存在插件数据目录，密码使用宿主机密服务加密保存，接口不会回传密码。</p>
 */
public class KafkaPluginModule implements DesktopPluginModule {

    private static final String PROFILE_FILE = "connections.properties";
    private static final int MAX_PROFILES = 100;

    private final KafkaClientService kafka = new KafkaClientService();
    private final Map<String, Profile> profiles = new LinkedHashMap<String, Profile>();
    private PluginContext context;

    @Override
    public String id() {
        return "com.deepshell.kafka";
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
        // Kafka / Mongo 驱动会通过线程上下文类加载器反射加载序列化器等类，
        // 插件运行在独立 URLClassLoader 中，必须在本线程临时切换。
        ClassLoader previous = Thread.currentThread().getContextClassLoader();
        Thread.currentThread().setContextClassLoader(KafkaPluginModule.class.getClassLoader());
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
            kafka.disconnect(str(p, "connectionId"));
            return null;
        }
        if ("overview".equals(action)) {
            return kafka.overview(str(p, "connectionId"));
        }
        if ("topics/list".equals(action)) {
            return kafka.topics(str(p, "connectionId"));
        }
        if ("topic/describe".equals(action)) {
            return kafka.describeTopic(str(p, "connectionId"), str(p, "topic"));
        }
        if ("topic/create".equals(action)) {
            kafka.createTopic(str(p, "connectionId"), str(p, "topic"),
                    intVal(p, "partitions", 1), intVal(p, "replication", 1), stringMap(p.get("configs")));
            return null;
        }
        if ("topic/delete".equals(action)) {
            kafka.deleteTopic(str(p, "connectionId"), str(p, "topic"));
            return null;
        }
        if ("topic/partitions/add".equals(action)) {
            kafka.addPartitions(str(p, "connectionId"), str(p, "topic"), intVal(p, "total", 0));
            return null;
        }
        if ("messages/fetch".equals(action)) {
            return kafka.fetchMessages(str(p, "connectionId"), str(p, "topic"),
                    intVal(p, "partition", -1), str(p, "mode"), longVal(p, "offset", 0),
                    intVal(p, "limit", 50));
        }
        if ("message/produce".equals(action)) {
            return kafka.produce(str(p, "connectionId"), str(p, "topic"), str(p, "key"),
                    str(p, "value"), intVal(p, "partition", -1), headerList(p.get("headers")));
        }
        if ("groups/list".equals(action)) {
            return kafka.groups(str(p, "connectionId"));
        }
        if ("groups/detail".equals(action)) {
            return kafka.groupDetail(str(p, "connectionId"), str(p, "groupId"));
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
        throw new IllegalArgumentException("未知的 Kafka 插件操作: " + action);
    }

    @Override
    public void close() {
        kafka.shutdown();
    }

    private Map<String, Object> connect(Map<String, Object> p) throws Exception {
        String profileId = str(p, "profileId").trim();
        Profile profile = profileId.isEmpty() ? null : profiles.get(profileId);
        if (!profileId.isEmpty() && profile == null) {
            throw new IllegalArgumentException("保存的连接不存在，请重新选择");
        }
        String servers = str(p, "servers").trim();
        String protocol = str(p, "securityProtocol").trim();
        String mechanism = str(p, "saslMechanism").trim();
        String username = str(p, "username").trim();
        String password = str(p, "password");
        String clientId = str(p, "clientId").trim();
        int timeoutMs = intVal(p, "timeoutMs", 10000);

        if (profile != null) {
            if (servers.isEmpty()) {
                servers = profile.servers;
            }
            if (protocol.isEmpty()) {
                protocol = profile.securityProtocol;
            }
            if (mechanism.isEmpty()) {
                mechanism = profile.saslMechanism;
            }
            if (username.isEmpty()) {
                username = profile.username;
            }
            if (password.isEmpty()) {
                password = decrypt(profile.passwordCipher);
            }
            if (clientId.isEmpty()) {
                clientId = profile.clientId;
            }
            if (p.get("timeoutMs") == null) {
                timeoutMs = profile.timeoutMs;
            }
        }
        if (servers.isEmpty()) {
            throw new IllegalArgumentException("请填写 Kafka 地址（如 127.0.0.1:9092）");
        }
        if (timeoutMs < 2000 || timeoutMs > 60000) {
            throw new IllegalArgumentException("超时时间需在 2000-60000 毫秒之间");
        }
        if (protocol.toUpperCase().startsWith("SASL") && username.isEmpty()) {
            throw new IllegalArgumentException("SASL 认证需要填写用户名");
        }
        Map<String, Object> result = kafka.connect(servers, protocol, mechanism, username, password,
                clientId, timeoutMs);
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
        String servers = str(p, "servers").trim();
        if (servers.isEmpty()) {
            throw new IllegalArgumentException("请填写 Kafka 地址");
        }
        String protocol = str(p, "securityProtocol").trim().toUpperCase();
        if (protocol.isEmpty()) {
            protocol = "PLAINTEXT";
        }
        String mechanism = str(p, "saslMechanism").trim().toUpperCase();
        if (mechanism.isEmpty()) {
            mechanism = "PLAIN";
        }
        int timeoutMs = intVal(p, "timeoutMs", 10000);
        if (timeoutMs < 2000 || timeoutMs > 60000) {
            throw new IllegalArgumentException("超时时间需在 2000-60000 毫秒之间");
        }
        String name = str(p, "name").trim();
        profile.name = name.isEmpty() ? servers : name;
        profile.servers = servers;
        profile.securityProtocol = protocol;
        profile.saslMechanism = mechanism;
        profile.username = str(p, "username").trim();
        profile.clientId = str(p, "clientId").trim();
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
        out.put("servers", profile.servers);
        out.put("securityProtocol", profile.securityProtocol);
        out.put("saslMechanism", profile.saslMechanism);
        out.put("username", profile.username);
        out.put("clientId", profile.clientId);
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
            String servers = props.getProperty("conn." + key + ".servers", "").trim();
            if (servers.isEmpty()) {
                continue;
            }
            Profile profile = new Profile();
            profile.id = key;
            profile.name = props.getProperty("conn." + key + ".name", servers).trim();
            profile.servers = servers;
            profile.securityProtocol = props.getProperty("conn." + key + ".security", "PLAINTEXT");
            profile.saslMechanism = props.getProperty("conn." + key + ".mechanism", "PLAIN");
            profile.username = props.getProperty("conn." + key + ".username", "").trim();
            profile.clientId = props.getProperty("conn." + key + ".clientId", "").trim();
            profile.timeoutMs = parseInt(props.getProperty("conn." + key + ".timeout"), 10000);
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
            props.setProperty(prefix + "servers", profile.servers == null ? "" : profile.servers);
            props.setProperty(prefix + "security", profile.securityProtocol == null ? "" : profile.securityProtocol);
            props.setProperty(prefix + "mechanism", profile.saslMechanism == null ? "" : profile.saslMechanism);
            props.setProperty(prefix + "username", profile.username == null ? "" : profile.username);
            props.setProperty(prefix + "clientId", profile.clientId == null ? "" : profile.clientId);
            props.setProperty(prefix + "timeout", String.valueOf(profile.timeoutMs));
            props.setProperty(prefix + "password", profile.passwordCipher == null ? "" : profile.passwordCipher);
            props.setProperty(prefix + "lastUsed", String.valueOf(profile.lastUsedAt));
        }
        props.setProperty("order", order.toString());
        Path temp = file.resolveSibling(file.getFileName().toString() + ".tmp");
        try (Writer writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
            props.store(writer, "DeepShell Kafka saved connections");
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

    @SuppressWarnings("unchecked")
    private static Map<String, String> stringMap(Object value) {
        Map<String, String> out = new LinkedHashMap<String, String>();
        if (value instanceof Map) {
            for (Map.Entry<Object, Object> entry : ((Map<Object, Object>) value).entrySet()) {
                if (entry.getKey() == null) {
                    continue;
                }
                String key = String.valueOf(entry.getKey()).trim();
                if (key.isEmpty()) {
                    continue;
                }
                out.put(key, entry.getValue() == null ? "" : String.valueOf(entry.getValue()));
            }
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, String>> headerList(Object value) {
        List<Map<String, String>> out = new ArrayList<Map<String, String>>();
        if (!(value instanceof List)) {
            return out;
        }
        for (Object item : (List<Object>) value) {
            if (!(item instanceof Map)) {
                continue;
            }
            Map<String, String> header = new LinkedHashMap<String, String>();
            for (Map.Entry<Object, Object> entry : ((Map<Object, Object>) item).entrySet()) {
                if (entry.getKey() == null) {
                    continue;
                }
                header.put(String.valueOf(entry.getKey()),
                        entry.getValue() == null ? "" : String.valueOf(entry.getValue()));
            }
            out.add(header);
        }
        return out;
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
        String servers = "";
        String securityProtocol = "PLAINTEXT";
        String saslMechanism = "PLAIN";
        String username = "";
        String clientId = "";
        int timeoutMs = 10000;
        String passwordCipher = "";
        long lastUsedAt;
    }
}
