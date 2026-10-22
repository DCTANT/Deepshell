package com.itdct.deepshell.plugin.redis;


import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * AI 桌面 Redis 插件使用的轻量 RESP2 客户端。
 *
 * <p>不依赖额外的 Redis SDK，直接通过 TCP 与 Redis 通信。每个浏览器连接对应一个
 * 服务端会话，会话保存在内存中；最多保留 8 个，空闲 30 分钟后自动释放。</p>
 *
 * <p>这里只提供单机 Redis 的核心能力：AUTH / SELECT / SCAN / 类型化读写 /
 * TTL / 重命名 / 删除 / 命令控制台 / INFO。</p>
 */
public class RedisClientService {

    private static final int MAX_SESSIONS = 8;
    private static final long IDLE_TIMEOUT_MS = 30L * 60 * 1000;
    private static final int MAX_BULK_BYTES = 32 * 1024 * 1024;
    private static final int MAX_ARRAY_ITEMS = 1000000;
    private static final int DEFAULT_LIMIT = 500;
    private static final int MAX_LIMIT = 2000;

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final AtomicLong idSeq = new AtomicLong();

    /* ---------------- public API ---------------- */

    public Map<String, Object> connect(String host, int port, String username, String password,
                                       int db, int timeoutMs) {
        String h = trim(host);
        if (h.isEmpty()) {
            throw new IllegalArgumentException("Redis 主机不能为空");
        }
        if (h.length() > 255) {
            throw new IllegalArgumentException("Redis 主机名过长");
        }
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("Redis 端口不合法");
        }
        if (db < 0 || db > 255) {
            throw new IllegalArgumentException("Redis 数据库编号需在 0-255 之间");
        }
        int timeout = timeoutMs <= 0 ? 5000 : Math.max(1000, Math.min(30000, timeoutMs));
        pruneSessions();

        RedisConnection conn = new RedisConnection(h, port, timeout);
        try {
            conn.open(trim(username), password == null ? "" : password, db);
        } catch (RuntimeException e) {
            conn.close();
            throw e;
        }

        String id = "r" + idSeq.incrementAndGet() + "-" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        Session session = new Session(id, conn, db);
        sessions.put(id, session);
        trimSessions();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("connectionId", id);
        out.put("host", h);
        out.put("port", port);
        out.put("db", db);
        // INFO / CONFIG 可能被服务器禁用，单项不可用时不影响连接本身
        try {
            Map<String, String> info = readInfo(session);
            int databases = readDatabaseCount(session);
            long dbsize = readDbSize(session);
            out.put("version", infoValue(info, "redis_version"));
            out.put("mode", infoValue(info, "redis_mode").isEmpty() ? "standalone" : infoValue(info, "redis_mode"));
            out.put("role", infoValue(info, "role"));
            out.put("databases", databaseList(info, databases, db, dbsize));
            out.put("dbSize", dbsize);
            out.put("info", serverInfo(info, dbsize));
        } catch (RedisConnectionException e) {
            sessions.remove(id, session);
            conn.close();
            throw new IllegalArgumentException("Redis 连接异常：" + e.getMessage());
        }
        return out;
    }

    public void disconnect(String connectionId) {
        Session session = sessions.remove(required(connectionId));
        if (session != null) {
            session.conn.close();
        }
    }

    public Map<String, Object> select(String connectionId, int db) {
        if (db < 0 || db > 255) {
            throw new IllegalArgumentException("Redis 数据库编号需在 0-255 之间");
        }
        return withSession(connectionId, session -> {
            session.conn.execute("SELECT", String.valueOf(db));
            session.db = db;
            Map<String, String> info = readInfo(session);
            int count = readDatabaseCount(session);
            long dbsize = readDbSize(session);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("db", db);
            out.put("dbSize", dbsize);
            out.put("databases", databaseList(info, count, db, dbsize));
            out.put("info", serverInfo(info, dbsize));
            return out;
        });
    }

    public Map<String, Object> scan(String connectionId, String cursor, String match, int count) {
        final String cur = cursor == null || trim(cursor).isEmpty() ? "0" : trim(cursor);
        if (!cur.matches("\\d{1,20}")) {
            throw new IllegalArgumentException("SCAN 游标不合法");
        }
        String pattern = match == null || trim(match).isEmpty() ? "*" : trim(match);
        if (pattern.length() > 512) {
            throw new IllegalArgumentException("匹配模式过长");
        }
        int pageSize = Math.max(10, Math.min(500, count <= 0 ? 100 : count));
        return withSession(connectionId, session -> {
            Object reply = session.conn.execute("SCAN", cur, "MATCH", pattern, "COUNT",
                    String.valueOf(pageSize));
            if (!(reply instanceof List) || ((List<?>) reply).size() < 2) {
                throw new IllegalArgumentException("Redis SCAN 返回格式异常");
            }
            List<?> arr = (List<?>) reply;
            String next = String.valueOf(arr.get(0));
            List<String> keys = new ArrayList<>();
            Object keyPart = arr.get(1);
            if (keyPart instanceof List) {
                for (Object o : (List<?>) keyPart) {
                    if (o != null) {
                        keys.add(String.valueOf(o));
                    }
                }
            }
            List<String[]> commands = new ArrayList<>();
            for (String key : keys) {
                commands.add(new String[]{"TYPE", key});
                commands.add(new String[]{"TTL", key});
            }
            List<Object> meta = commands.isEmpty()
                    ? Collections.<Object>emptyList() : session.conn.pipeline(commands);
            List<Map<String, Object>> items = new ArrayList<>();
            for (int i = 0; i < keys.size(); i++) {
                String type = "unknown";
                long ttl = -2;
                int base = i * 2;
                if (base + 1 < meta.size()) {
                    Object t = meta.get(base);
                    Object ttlReply = meta.get(base + 1);
                    if (!(t instanceof RedisError)) {
                        type = String.valueOf(t);
                    }
                    if (ttlReply instanceof Long) {
                        ttl = (Long) ttlReply;
                    }
                }
                if ("none".equals(type)) {
                    continue;
                }
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("key", keys.get(i));
                item.put("type", type);
                item.put("ttl", ttl);
                items.add(item);
            }
            items.sort(Comparator.comparing(o -> String.valueOf(o.get("key"))));
            long dbsize = readDbSize(session);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("cursor", next);
            out.put("keys", items);
            out.put("scanned", keys.size());
            out.put("dbSize", dbsize);
            return out;
        });
    }

    public Map<String, Object> key(String connectionId, String key, int limit) {
        final String k = requireKey(key);
        final int max = Math.max(1, Math.min(MAX_LIMIT, limit <= 0 ? DEFAULT_LIMIT : limit));
        return withSession(connectionId, session -> {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("key", k);
            String type = String.valueOf(session.conn.execute("TYPE", k));
            long ttl = toLong(session.conn.execute("TTL", k), -2);
            out.put("type", type);
            out.put("ttl", ttl);
            if ("none".equals(type)) {
                return out;
            }
            out.put("value", readValue(session, k, type, max));
            return out;
        });
    }

    public Map<String, Object> setString(String connectionId, String key, String value) {
        final String k = requireKey(key);
        final String v = value == null ? "" : value;
        if (v.length() > 10 * 1024 * 1024) {
            throw new IllegalArgumentException("字符串值不能超过 10MB");
        }
        return withSession(connectionId, session -> {
            // SET 会清除 TTL；编辑现有字符串时保留原有过期时间
            long ttl = toLong(session.conn.execute("TTL", k), -1);
            if (ttl > 0) {
                session.conn.execute("SET", k, v, "EX", String.valueOf(ttl));
            } else {
                session.conn.execute("SET", k, v);
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("size", (long) v.getBytes(StandardCharsets.UTF_8).length);
            out.put("ttl", ttl);
            return out;
        });
    }

    public Map<String, Object> setTtl(String connectionId, String key, long ttl) {
        final String k = requireKey(key);
        return withSession(connectionId, session -> {
            if (ttl > 0) {
                if (ttl > 10L * 365 * 24 * 3600) {
                    throw new IllegalArgumentException("TTL 过大");
                }
                session.conn.execute("EXPIRE", k, String.valueOf(ttl));
            } else {
                session.conn.execute("PERSIST", k);
            }
            long current = toLong(session.conn.execute("TTL", k), -2);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ttl", current);
            return out;
        });
    }

    public Map<String, Object> rename(String connectionId, String key, String newKey) {
        final String k = requireKey(key);
        final String nk = requireKey(newKey);
        if (k.equals(nk)) {
            throw new IllegalArgumentException("新键名不能与原键名相同");
        }
        return withSession(connectionId, session -> {
            session.conn.execute("RENAME", k, nk);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("key", nk);
            out.put("ttl", toLong(session.conn.execute("TTL", nk), -1));
            return out;
        });
    }

    public Map<String, Object> delete(String connectionId, String key) {
        final String k = requireKey(key);
        return withSession(connectionId, session -> {
            long removed = toLong(session.conn.execute("DEL", k), 0);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("removed", removed);
            return out;
        });
    }

    public Map<String, Object> editHash(String connectionId, String key, String op,
                                        String field, String value) {
        final String k = requireKey(key);
        final String f = field == null ? "" : field;
        if (f.length() > 1024) {
            throw new IllegalArgumentException("Hash 字段名过长");
        }
        return withSession(connectionId, session -> {
            if ("del".equalsIgnoreCase(op)) {
                session.conn.execute("HDEL", k, f);
            } else if ("set".equalsIgnoreCase(op)) {
                session.conn.execute("HSET", k, f, value == null ? "" : value);
            } else {
                throw new IllegalArgumentException("不支持的 Hash 操作");
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("size", toLong(session.conn.execute("HLEN", k), 0));
            return out;
        });
    }

    public Map<String, Object> editList(String connectionId, String key, String op,
                                        int index, String value) {
        final String k = requireKey(key);
        return withSession(connectionId, session -> {
            if ("pushHead".equalsIgnoreCase(op)) {
                session.conn.execute("LPUSH", k, value == null ? "" : value);
            } else if ("pushTail".equalsIgnoreCase(op)) {
                session.conn.execute("RPUSH", k, value == null ? "" : value);
            } else if ("set".equalsIgnoreCase(op)) {
                if (index < 0) {
                    throw new IllegalArgumentException("列表索引不合法");
                }
                session.conn.execute("LSET", k, String.valueOf(index), value == null ? "" : value);
            } else if ("remove".equalsIgnoreCase(op)) {
                session.conn.execute("LREM", k, "1", value == null ? "" : value);
            } else {
                throw new IllegalArgumentException("不支持的 List 操作");
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("size", toLong(session.conn.execute("LLEN", k), 0));
            return out;
        });
    }

    public Map<String, Object> editSet(String connectionId, String key, String op, String member) {
        final String k = requireKey(key);
        final String m = member == null ? "" : member;
        return withSession(connectionId, session -> {
            if ("add".equalsIgnoreCase(op)) {
                session.conn.execute("SADD", k, m);
            } else if ("remove".equalsIgnoreCase(op)) {
                session.conn.execute("SREM", k, m);
            } else {
                throw new IllegalArgumentException("不支持的 Set 操作");
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("size", toLong(session.conn.execute("SCARD", k), 0));
            return out;
        });
    }

    public Map<String, Object> editZset(String connectionId, String key, String op,
                                        String member, double score) {
        final String k = requireKey(key);
        final String m = member == null ? "" : member;
        if (Double.isNaN(score) || Double.isInfinite(score)) {
            throw new IllegalArgumentException("ZSet score 不合法");
        }
        return withSession(connectionId, session -> {
            if ("add".equalsIgnoreCase(op)) {
                session.conn.execute("ZADD", k, formatScore(score), m);
            } else if ("remove".equalsIgnoreCase(op)) {
                session.conn.execute("ZREM", k, m);
            } else {
                throw new IllegalArgumentException("不支持的 ZSet 操作");
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("size", toLong(session.conn.execute("ZCARD", k), 0));
            return out;
        });
    }

    public Map<String, Object> command(String connectionId, String commandLine) {
        final List<String> args = parseCommandLine(commandLine);
        if (args.isEmpty()) {
            throw new IllegalArgumentException("请输入 Redis 命令");
        }
        if (args.size() > 512) {
            throw new IllegalArgumentException("命令参数过多");
        }
        String head = args.get(0).toUpperCase(Locale.ROOT);
        if ("MONITOR".equals(head) || "SYNC".equals(head) || "PSYNC".equals(head)
                || "SUBSCRIBE".equals(head) || "PSUBSCRIBE".equals(head)
                || "SSUBSCRIBE".equals(head)) {
            throw new IllegalArgumentException("该命令会占用长连接，暂不支持在控制台执行");
        }
        return withSession(connectionId, session -> {
            Object reply = session.conn.execute(args.toArray(new String[0]));
            if ("SELECT".equals(head) && args.size() > 1) {
                try {
                    int db = Integer.parseInt(args.get(1));
                    if (db >= 0 && db <= 255) {
                        session.db = db;
                    }
                } catch (NumberFormatException ignore) {
                    // Redis 自己会报错；这里只处理成功后的状态同步
                }
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("command", commandLine.trim());
            out.put("type", replyType(reply));
            out.put("text", formatReply(reply, 0));
            return out;
        });
    }

    public Map<String, Object> info(String connectionId) {
        return withSession(connectionId, session -> {
            Map<String, String> info = readInfo(session);
            int count = readDatabaseCount(session);
            long dbsize = readDbSize(session);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("db", session.db);
            out.put("dbSize", dbsize);
            out.put("databases", databaseList(info, count, session.db, dbsize));
            out.put("info", serverInfo(info, dbsize));
            out.put("version", infoValue(info, "redis_version"));
            out.put("mode", infoValue(info, "redis_mode").isEmpty() ? "standalone" : infoValue(info, "redis_mode"));
            return out;
        });
    }

    public void shutdown() {
        for (Session session : sessions.values()) {
            session.conn.close();
        }
        sessions.clear();
    }

    /* ---------------- value readers ---------------- */

    private Map<String, Object> readValue(Session session, String key, String type, int limit) {
        Map<String, Object> value = new LinkedHashMap<>();
        if ("string".equals(type)) {
            Object raw = session.conn.execute("GET", key);
            String text = raw == null ? "" : String.valueOf(raw);
            value.put("text", text);
            value.put("size", toLong(session.conn.execute("STRLEN", key), text.length()));
            value.put("truncated", false);
        } else if ("hash".equals(type)) {
            long total = toLong(session.conn.execute("HLEN", key), 0);
            Object reply = session.conn.execute("HSCAN", key, "0", "COUNT", String.valueOf(limit));
            List<Map<String, Object>> entries = new ArrayList<>();
            String cursor = "0";
            if (reply instanceof List && ((List<?>) reply).size() >= 2) {
                List<?> arr = (List<?>) reply;
                cursor = String.valueOf(arr.get(0));
                Object pairs = arr.get(1);
                if (pairs instanceof List) {
                    List<?> list = (List<?>) pairs;
                    for (int i = 0; i + 1 < list.size(); i += 2) {
                        Map<String, Object> e = new LinkedHashMap<>();
                        e.put("field", list.get(i) == null ? "" : String.valueOf(list.get(i)));
                        e.put("value", list.get(i + 1) == null ? "" : String.valueOf(list.get(i + 1)));
                        entries.add(e);
                    }
                }
            }
            value.put("entries", entries);
            value.put("size", total);
            value.put("cursor", cursor);
            value.put("truncated", !"0".equals(cursor) || total > entries.size());
        } else if ("list".equals(type)) {
            long total = toLong(session.conn.execute("LLEN", key), 0);
            Object reply = session.conn.execute("LRANGE", key, "0", String.valueOf(limit - 1));
            List<String> items = new ArrayList<>();
            if (reply instanceof List) {
                for (Object o : (List<?>) reply) {
                    items.add(o == null ? "" : String.valueOf(o));
                }
            }
            value.put("items", items);
            value.put("size", total);
            value.put("truncated", total > items.size());
        } else if ("set".equals(type)) {
            long total = toLong(session.conn.execute("SCARD", key), 0);
            Object reply = session.conn.execute("SSCAN", key, "0", "COUNT", String.valueOf(limit));
            List<String> items = new ArrayList<>();
            String cursor = "0";
            if (reply instanceof List && ((List<?>) reply).size() >= 2) {
                List<?> arr = (List<?>) reply;
                cursor = String.valueOf(arr.get(0));
                Object members = arr.get(1);
                if (members instanceof List) {
                    for (Object o : (List<?>) members) {
                        items.add(o == null ? "" : String.valueOf(o));
                    }
                }
            }
            value.put("items", items);
            value.put("size", total);
            value.put("cursor", cursor);
            value.put("truncated", !"0".equals(cursor) || total > items.size());
        } else if ("zset".equals(type)) {
            long total = toLong(session.conn.execute("ZCARD", key), 0);
            Object reply = session.conn.execute("ZRANGE", key, "0", String.valueOf(limit - 1), "WITHSCORES");
            List<Map<String, Object>> items = new ArrayList<>();
            if (reply instanceof List) {
                List<?> list = (List<?>) reply;
                for (int i = 0; i + 1 < list.size(); i += 2) {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("member", list.get(i) == null ? "" : String.valueOf(list.get(i)));
                    item.put("score", list.get(i + 1) == null ? "" : String.valueOf(list.get(i + 1)));
                    items.add(item);
                }
            }
            value.put("items", items);
            value.put("size", total);
            value.put("truncated", total > items.size());
        } else if ("stream".equals(type)) {
            long total = toLong(session.conn.execute("XLEN", key), 0);
            Object reply = session.conn.execute("XRANGE", key, "-", "+", "COUNT", String.valueOf(limit));
            List<Map<String, Object>> entries = new ArrayList<>();
            if (reply instanceof List) {
                for (Object o : (List<?>) reply) {
                    if (!(o instanceof List) || ((List<?>) o).size() < 2) {
                        continue;
                    }
                    List<?> entry = (List<?>) o;
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", entry.get(0) == null ? "" : String.valueOf(entry.get(0)));
                    List<Map<String, Object>> fields = new ArrayList<>();
                    Object fieldList = entry.get(1);
                    if (fieldList instanceof List) {
                        List<?> fl = (List<?>) fieldList;
                        for (int i = 0; i + 1 < fl.size(); i += 2) {
                            Map<String, Object> f = new LinkedHashMap<>();
                            f.put("field", fl.get(i) == null ? "" : String.valueOf(fl.get(i)));
                            f.put("value", fl.get(i + 1) == null ? "" : String.valueOf(fl.get(i + 1)));
                            fields.add(f);
                        }
                    }
                    item.put("fields", fields);
                    entries.add(item);
                }
            }
            value.put("entries", entries);
            value.put("size", total);
            value.put("truncated", total > entries.size());
        } else {
            value.put("text", "(暂不支持预览该类型)");
            value.put("truncated", false);
        }
        return value;
    }

    /* ---------------- session / info helpers ---------------- */

    private Map<String, Object> withSession(String connectionId, RedisOperation operation) {
        pruneSessions();
        String id = required(connectionId);
        Session session = sessions.get(id);
        if (session == null) {
            throw new IllegalArgumentException("Redis 连接已失效，请重新连接");
        }
        session.lastUsed = System.currentTimeMillis();
        try {
            return operation.run(session);
        } catch (RedisCommandException | IllegalArgumentException e) {
            throw e;
        } catch (RedisConnectionException e) {
            sessions.remove(id);
            session.conn.close();
            throw new IllegalArgumentException("Redis 连接已断开：" + e.getMessage());
        }
    }

    private Map<String, String> readInfo(Session session) {
        try {
            Object reply = session.conn.execute("INFO");
            return parseInfo(reply == null ? "" : String.valueOf(reply));
        } catch (RedisCommandException e) {
            return new LinkedHashMap<>();
        }
    }

    private long readDbSize(Session session) {
        try {
            return toLong(session.conn.execute("DBSIZE"), 0);
        } catch (RedisCommandException e) {
            return 0;
        }
    }

    private int readDatabaseCount(Session session) {
        int fallback = 16;
        try {
            Object reply = session.conn.execute("CONFIG", "GET", "databases");
            if (reply instanceof List && ((List<?>) reply).size() >= 2) {
                int n = Integer.parseInt(String.valueOf(((List<?>) reply).get(1)));
                if (n >= 1 && n <= 256) {
                    return n;
                }
            }
        } catch (RedisCommandException | NumberFormatException ignore) {
            // CONFIG 可能被禁用，采用默认 16 个库
        }
        return fallback;
    }

    private static Map<String, String> parseInfo(String text) {
        Map<String, String> map = new LinkedHashMap<>();
        if (text == null) {
            return map;
        }
        String[] lines = text.split("\\r?\\n");
        for (String line : lines) {
            if (line == null) {
                continue;
            }
            String s = line.trim();
            if (s.isEmpty() || s.startsWith("#")) {
                continue;
            }
            int idx = s.indexOf(':');
            if (idx > 0) {
                map.put(s.substring(0, idx), s.substring(idx + 1).trim());
            }
        }
        return map;
    }

    private static String infoValue(Map<String, String> info, String key) {
        String v = info.get(key);
        return v == null ? "" : v;
    }

    private static Map<String, Object> serverInfo(Map<String, String> info, long dbsize) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", infoValue(info, "redis_version"));
        out.put("mode", infoValue(info, "redis_mode").isEmpty() ? "standalone" : infoValue(info, "redis_mode"));
        out.put("role", infoValue(info, "role"));
        out.put("os", infoValue(info, "os"));
        out.put("archBits", infoValue(info, "arch_bits"));
        out.put("uptimeSeconds", infoValue(info, "uptime_in_seconds"));
        out.put("connectedClients", infoValue(info, "connected_clients"));
        out.put("usedMemoryHuman", infoValue(info, "used_memory_human"));
        out.put("usedMemory", infoValue(info, "used_memory"));
        out.put("totalCommandsProcessed", infoValue(info, "total_commands_processed"));
        out.put("instantaneousOpsPerSec", infoValue(info, "instantaneous_ops_per_sec"));
        out.put("keyspaceHits", infoValue(info, "keyspace_hits"));
        out.put("keyspaceMisses", infoValue(info, "keyspace_misses"));
        out.put("maxmemoryHuman", infoValue(info, "maxmemory_human"));
        out.put("dbSize", dbsize);
        return out;
    }

    private static List<Map<String, Object>> databaseList(Map<String, String> info, int count,
                                                          int current, long dbsize) {
        Map<Integer, Long> keyCounts = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : info.entrySet()) {
            if (!e.getKey().startsWith("db")) {
                continue;
            }
            String rest = e.getValue();
            try {
                int keysIdx = rest.indexOf("keys=");
                if (keysIdx >= 0) {
                    String n = rest.substring(keysIdx + 5);
                    int comma = n.indexOf(',');
                    if (comma >= 0) {
                        n = n.substring(0, comma);
                    }
                    keyCounts.put(Integer.parseInt(e.getKey().substring(2)), Long.parseLong(n.trim()));
                }
            } catch (Exception ignore) {
                // ignore malformed keyspace line
            }
        }
        int total = Math.max(1, Math.min(256, Math.max(count, current + 1)));
        List<Map<String, Object>> list = new ArrayList<>();
        for (int i = 0; i < total; i++) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("index", i);
            Long keys = keyCounts.get(i);
            item.put("keys", keys == null ? (i == current ? dbsize : 0L) : keys);
            item.put("current", i == current);
            list.add(item);
        }
        return list;
    }

    private void pruneSessions() {
        long cutoff = System.currentTimeMillis() - IDLE_TIMEOUT_MS;
        for (Map.Entry<String, Session> e : sessions.entrySet()) {
            Session s = e.getValue();
            if (s.lastUsed < cutoff) {
                if (sessions.remove(e.getKey(), s)) {
                    s.conn.close();
                }
            }
        }
    }

    private void trimSessions() {
        while (sessions.size() > MAX_SESSIONS) {
            Session oldest = null;
            for (Session s : sessions.values()) {
                if (oldest == null || s.lastUsed < oldest.lastUsed) {
                    oldest = s;
                }
            }
            if (oldest == null || !sessions.remove(oldest.id, oldest)) {
                break;
            }
            oldest.conn.close();
        }
    }

    private static String required(String connectionId) {
        String id = trim(connectionId);
        if (id.isEmpty()) {
            throw new IllegalArgumentException("缺少 Redis 连接 ID");
        }
        return id;
    }

    private static String requireKey(String key) {
        String k = key == null ? "" : key;
        if (k.isEmpty()) {
            throw new IllegalArgumentException("Redis 键名不能为空");
        }
        if (k.length() > 1024) {
            throw new IllegalArgumentException("Redis 键名过长");
        }
        return k;
    }

    private static long toLong(Object value, long fallback) {
        if (value instanceof Long) {
            return (Long) value;
        }
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        if (value != null) {
            try {
                return Long.parseLong(String.valueOf(value));
            } catch (NumberFormatException ignore) {
                // ignore
            }
        }
        return fallback;
    }

    private static String formatScore(double score) {
        if (score == Math.rint(score) && !Double.isInfinite(score) && Math.abs(score) < 1e15) {
            return String.valueOf((long) score);
        }
        return String.valueOf(score);
    }

    private static String trim(String s) {
        return s == null ? "" : s.trim();
    }

    private interface RedisOperation {
        Map<String, Object> run(Session session);
    }

    private static final class Session {
        private final String id;
        private final RedisConnection conn;
        private volatile int db;
        private volatile long lastUsed = System.currentTimeMillis();

        private Session(String id, RedisConnection conn, int db) {
            this.id = id;
            this.conn = conn;
            this.db = db;
        }
    }

    /* ---------------- RESP2 client ---------------- */

    private static final class RedisConnection {
        private final String host;
        private final int port;
        private final int timeoutMs;
        private Socket socket;
        private InputStream in;
        private OutputStream out;

        private RedisConnection(String host, int port, int timeoutMs) {
            this.host = host;
            this.port = port;
            this.timeoutMs = timeoutMs;
        }

        private void open(String username, String password, int db) {
            try {
                Socket s = new Socket();
                s.connect(new InetSocketAddress(host, port), timeoutMs);
                // 连接超时由用户配置；读取留出更大余量，避免大 key / 慢命令被误判超时
                s.setSoTimeout(Math.max(20000, timeoutMs));
                s.setTcpNoDelay(true);
                socket = s;
                in = new BufferedInputStream(s.getInputStream());
                out = new BufferedOutputStream(s.getOutputStream());
                if (password != null && !password.isEmpty()) {
                    if (username != null && !username.isEmpty()) {
                        execute("AUTH", username, password);
                    } else {
                        execute("AUTH", password);
                    }
                }
                execute("SELECT", String.valueOf(db));
                execute("PING");
            } catch (RedisCommandException | RedisConnectionException e) {
                close();
                throw e;
            } catch (IOException e) {
                close();
                throw new RedisConnectionException(friendlyIo(e));
            }
        }

        private synchronized Object execute(String... args) {
            try {
                writeCommand(args);
                Object reply = readReply();
                if (reply instanceof RedisError) {
                    throw new RedisCommandException(((RedisError) reply).message);
                }
                return reply;
            } catch (IOException e) {
                throw new RedisConnectionException(friendlyIo(e));
            }
        }

        private synchronized List<Object> pipeline(List<String[]> commands) {
            try {
                for (String[] command : commands) {
                    writeCommand(command);
                }
                List<Object> replies = new ArrayList<>(commands.size());
                for (int i = 0; i < commands.size(); i++) {
                    replies.add(readReply());
                }
                return replies;
            } catch (IOException e) {
                throw new RedisConnectionException(friendlyIo(e));
            }
        }

        private void writeCommand(String[] args) throws IOException {
            if (out == null) {
                throw new IOException("连接尚未建立");
            }
            out.write('*');
            out.write(String.valueOf(args.length).getBytes(StandardCharsets.US_ASCII));
            out.write('\r');
            out.write('\n');
            for (String arg : args) {
                byte[] bytes = (arg == null ? "" : arg).getBytes(StandardCharsets.UTF_8);
                out.write('$');
                out.write(String.valueOf(bytes.length).getBytes(StandardCharsets.US_ASCII));
                out.write('\r');
                out.write('\n');
                out.write(bytes);
                out.write('\r');
                out.write('\n');
            }
            out.flush();
        }

        private Object readReply() throws IOException {
            int type = in.read();
            if (type < 0) {
                throw new IOException("Redis 已关闭连接");
            }
            switch (type) {
                case '+':
                    return readLine();
                case '-':
                    return new RedisError(readLine());
                case ':':
                    return parseLong(readLine());
                case '$':
                    return readBulk();
                case '*':
                    return readArray();
                default:
                    throw new IOException("无法识别的 Redis 响应类型: " + (char) type);
            }
        }

        private Object readBulk() throws IOException {
            int len = parseInt(readLine());
            if (len < 0) {
                return null;
            }
            if (len > MAX_BULK_BYTES) {
                throw new IOException("Redis 返回的数据超过 32MB");
            }
            byte[] data = new byte[len];
            int offset = 0;
            while (offset < len) {
                int n = in.read(data, offset, len - offset);
                if (n < 0) {
                    throw new IOException("Redis 响应不完整");
                }
                offset += n;
            }
            readCrlf();
            return new String(data, StandardCharsets.UTF_8);
        }

        private Object readArray() throws IOException {
            int len = parseInt(readLine());
            if (len < 0) {
                return null;
            }
            if (len > MAX_ARRAY_ITEMS) {
                throw new IOException("Redis 数组元素过多");
            }
            List<Object> list = new ArrayList<>(Math.min(len, 4096));
            for (int i = 0; i < len; i++) {
                list.add(readReply());
            }
            return list;
        }

        private String readLine() throws IOException {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            int b;
            while ((b = in.read()) >= 0) {
                if (b == '\r') {
                    int n = in.read();
                    if (n == '\n') {
                        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
                    }
                    buf.write(b);
                    if (n >= 0) {
                        buf.write(n);
                    }
                    continue;
                }
                buf.write(b);
                if (buf.size() > 1024 * 1024) {
                    throw new IOException("Redis 响应行过长");
                }
            }
            throw new IOException("Redis 响应不完整");
        }

        private void readCrlf() throws IOException {
            int a = in.read();
            int b = in.read();
            if (a != '\r' || b != '\n') {
                throw new IOException("Redis 响应格式错误");
            }
        }

        private static int parseInt(String s) throws IOException {
            try {
                return Integer.parseInt(s.trim());
            } catch (Exception e) {
                throw new IOException("Redis 响应数字格式错误");
            }
        }

        private static long parseLong(String s) throws IOException {
            try {
                return Long.parseLong(s.trim());
            } catch (Exception e) {
                throw new IOException("Redis 响应数字格式错误");
            }
        }

        private void close() {
            try {
                if (socket != null) {
                    socket.close();
                }
            } catch (Exception ignore) {
                // ignore
            }
            socket = null;
            in = null;
            out = null;
        }

        private static String friendlyIo(IOException e) {
            if (e instanceof ConnectException) {
                return "无法连接到 Redis 服务";
            }
            if (e instanceof SocketTimeoutException) {
                return "连接或读取超时";
            }
            if (e instanceof UnknownHostException) {
                return "无法解析主机名";
            }
            String msg = e.getMessage();
            return msg == null || msg.trim().isEmpty() ? "网络错误" : msg;
        }
    }

    private static final class RedisError {
        private final String message;

        private RedisError(String message) {
            this.message = message;
        }
    }

    private static final class RedisCommandException extends RuntimeException {
        private RedisCommandException(String message) {
            super(message);
        }
    }

    private static final class RedisConnectionException extends RuntimeException {
        private RedisConnectionException(String message) {
            super(message);
        }
    }

    /* ---------------- reply formatting / command parsing ---------------- */

    private static String replyType(Object reply) {
        if (reply == null) {
            return "nil";
        }
        if (reply instanceof String) {
            return "string";
        }
        if (reply instanceof Long) {
            return "integer";
        }
        if (reply instanceof List) {
            return "array";
        }
        return "unknown";
    }

    private static String formatReply(Object reply, int depth) {
        if (reply == null) {
            return "(nil)";
        }
        if (reply instanceof RedisError) {
            return "(error) " + ((RedisError) reply).message;
        }
        if (reply instanceof String) {
            return (String) reply;
        }
        if (reply instanceof Long) {
            return "(integer) " + reply;
        }
        if (reply instanceof List) {
            List<?> list = (List<?>) reply;
            if (list.isEmpty()) {
                return "(empty list or set)";
            }
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < list.size(); i++) {
                if (sb.length() > 0) {
                    sb.append('\n');
                }
                for (int d = 0; d <= depth; d++) {
                    sb.append("  ");
                }
                sb.append(i + 1).append(") ");
                Object item = list.get(i);
                if (item instanceof List) {
                    sb.append(formatReply(item, depth + 1));
                } else if (item instanceof RedisError) {
                    sb.append("(error) ").append(((RedisError) item).message);
                } else {
                    sb.append(item == null ? "(nil)" : String.valueOf(item));
                }
            }
            return sb.toString();
        }
        return String.valueOf(reply);
    }

    private static List<String> parseCommandLine(String line) {
        if (line == null) {
            return new ArrayList<>();
        }
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inSingle = false;
        boolean inDouble = false;
        boolean hasToken = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (inSingle) {
                if (c == '\\' && i + 1 < line.length()) {
                    cur.append(line.charAt(++i));
                } else if (c == '\'') {
                    inSingle = false;
                } else {
                    cur.append(c);
                }
                hasToken = true;
            } else if (inDouble) {
                if (c == '\\' && i + 1 < line.length()) {
                    char n = line.charAt(++i);
                    if (n == 'n') {
                        cur.append('\n');
                    } else if (n == 'r') {
                        cur.append('\r');
                    } else if (n == 't') {
                        cur.append('\t');
                    } else {
                        cur.append(n);
                    }
                } else if (c == '"') {
                    inDouble = false;
                } else {
                    cur.append(c);
                }
                hasToken = true;
            } else if (c == '\'' || c == '"') {
                inSingle = c == '\'';
                inDouble = c == '"';
                hasToken = true;
            } else if (Character.isWhitespace(c)) {
                if (hasToken) {
                    out.add(cur.toString());
                    cur.setLength(0);
                    hasToken = false;
                }
            } else {
                if (c == '\\' && i + 1 < line.length()) {
                    char n = line.charAt(++i);
                    if (n == 'n') {
                        cur.append('\n');
                    } else if (n == 'r') {
                        cur.append('\r');
                    } else if (n == 't') {
                        cur.append('\t');
                    } else {
                        cur.append(n);
                    }
                } else {
                    cur.append(c);
                }
                hasToken = true;
            }
        }
        if (inSingle || inDouble) {
            throw new IllegalArgumentException("命令引号未闭合");
        }
        if (hasToken) {
            out.add(cur.toString());
        }
        return out;
    }
}
