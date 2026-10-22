package com.itdct.deepshell.plugin.redis;

import com.itdct.deepshell.plugin.DesktopPluginModule;
import com.itdct.deepshell.plugin.PluginContext;

import java.util.Map;

/**
 * DeepShell Redis 桌面插件的后端模块。JAR 随插件 ZIP 分发，由
 * PluginRuntimeService 在 DeepShell 启动时加载；不依赖 Spring / Maven 宿主依赖。
 */
public class RedisPluginModule implements DesktopPluginModule {

    private final RedisClientService redis = new RedisClientService();

    @Override
    public String id() {
        return "com.deepshell.redis";
    }

    @Override
    public void initialize(PluginContext context) {
        // Redis 连接会话只保存在内存中，不需要额外初始化
    }

    @Override
    public Object invoke(String action, Map<String, Object> payload) {
        Map<String, Object> p = payload == null ? java.util.Collections.<String, Object>emptyMap() : payload;
        if ("connect".equals(action)) {
            return redis.connect(str(p, "host"), intVal(p, "port", 6379), str(p, "username"),
                    str(p, "password"), intVal(p, "db", 0), intVal(p, "timeoutMs", 5000));
        }
        if ("disconnect".equals(action)) {
            redis.disconnect(str(p, "connectionId"));
            return null;
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

    private static String str(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v == null ? "" : String.valueOf(v);
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
}
