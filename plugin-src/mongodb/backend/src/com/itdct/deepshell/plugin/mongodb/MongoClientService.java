package com.itdct.deepshell.plugin.mongodb;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.MongoCredential;
import com.mongodb.ServerAddress;
import com.mongodb.client.FindIterable;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.model.IndexOptions;
import com.mongodb.client.model.Indexes;
import com.mongodb.client.model.InsertOneOptions;
import com.mongodb.client.model.UpdateOptions;
import com.mongodb.client.result.DeleteResult;
import com.mongodb.client.result.InsertOneResult;
import com.mongodb.client.result.UpdateResult;
import org.bson.BsonValue;
import org.bson.Document;
import org.bson.json.JsonMode;
import org.bson.json.JsonWriterSettings;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * MongoDB 连接与会话管理。
 *
 * <p>使用官方同步驱动，所有查询在调用线程内完成；不缓存用户数据到磁盘。</p>
 */
final class MongoClientService {

    private static final int MAX_DOCS = 500;
    private static final int MAX_SESSIONS = 8;
    private static final long IDLE_TIMEOUT_MS = 30L * 60 * 1000;
    private static final JsonWriterSettings JSON = JsonWriterSettings.builder()
            .outputMode(JsonMode.RELAXED)
            .indent(false)
            .build();

    private final Map<String, Session> sessions = new ConcurrentHashMap<String, Session>();

    Map<String, Object> connect(String hosts, String username, String password, String authSource,
                                String mechanism, boolean tls, int timeoutMs) {
        List<ServerAddress> addresses = parseHosts(hosts);
        if (addresses.isEmpty()) {
            throw new IllegalArgumentException("请填写 MongoDB 地址（如 127.0.0.1:27017）");
        }
        MongoClientSettings.Builder builder = MongoClientSettings.builder()
                .applyToClusterSettings(new com.mongodb.Block<com.mongodb.connection.ClusterSettings.Builder>() {
                    @Override
                    public void apply(com.mongodb.connection.ClusterSettings.Builder b) {
                        b.hosts(addresses);
                    }
                })
                .applicationName("DeepShell");
        builder.applyToClusterSettings(new com.mongodb.Block<com.mongodb.connection.ClusterSettings.Builder>() {
            @Override
            public void apply(com.mongodb.connection.ClusterSettings.Builder b) {
                b.serverSelectionTimeout(timeoutMs, TimeUnit.MILLISECONDS);
            }
        });
        final int socketTimeout = Math.max(timeoutMs, 10000);
        builder.applyToSocketSettings(new com.mongodb.Block<com.mongodb.connection.SocketSettings.Builder>() {
            @Override
            public void apply(com.mongodb.connection.SocketSettings.Builder b) {
                b.connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                        .readTimeout(socketTimeout, TimeUnit.MILLISECONDS);
            }
        });
        builder.applyToConnectionPoolSettings(new com.mongodb.Block<com.mongodb.connection.ConnectionPoolSettings.Builder>() {
            @Override
            public void apply(com.mongodb.connection.ConnectionPoolSettings.Builder b) {
                b.maxSize(5).minSize(0);
            }
        });
        if (tls) {
            builder.applyToSslSettings(new com.mongodb.Block<com.mongodb.connection.SslSettings.Builder>() {
                @Override
                public void apply(com.mongodb.connection.SslSettings.Builder b) {
                    b.enabled(true);
                }
            });
        }
        if (username != null && !username.trim().isEmpty()) {
            String source = authSource == null || authSource.trim().isEmpty()
                    ? "admin" : authSource.trim();
            String mode = mechanism == null || mechanism.trim().isEmpty()
                    ? "SCRAM-SHA-256" : mechanism.trim().toUpperCase();
            char[] secret = password == null ? new char[0] : password.toCharArray();
            MongoCredential credential;
            if ("SCRAM-SHA-1".equals(mode)) {
                credential = MongoCredential.createScramSha1Credential(username.trim(), source, secret);
            } else if ("PLAIN".equals(mode)) {
                credential = MongoCredential.createPlainCredential(username.trim(), source, secret);
            } else {
                credential = MongoCredential.createScramSha256Credential(username.trim(), source, secret);
            }
            builder.credential(credential);
        }
        MongoClient client = null;
        try {
            client = MongoClients.create(builder.build());
            Document ping = client.getDatabase("admin").runCommand(new Document("ping", 1));
            if (ping == null) {
                throw new IllegalStateException("服务器未返回 ping 结果");
            }
            Session session = new Session(client, timeoutMs);
            String connectionId = UUID.randomUUID().toString().replace("-", "");
            sessions.put(connectionId, session);
            trimSessions();
            Document buildInfo = command(client.getDatabase("admin"), new Document("buildInfo", 1));
            Map<String, Object> out = new LinkedHashMap<String, Object>();
            out.put("connectionId", connectionId);
            out.put("servers", addresses.size() == 0 ? "" : hosts);
            out.put("version", buildInfo == null ? "" : string(buildInfo, "version"));
            out.put("authSource", username != null && !username.trim().isEmpty()
                    ? (authSource == null || authSource.trim().isEmpty() ? "admin" : authSource.trim())
                    : "");
            return out;
        } catch (Exception e) {
            if (client != null) {
                try {
                    client.close();
                } catch (Exception ignore) {
                    // ignore
                }
            }
            throw new IllegalArgumentException(friendly(e));
        }
    }

    void disconnect(String connectionId) {
        Session session = sessions.remove(connectionId);
        if (session != null) {
            session.close();
        }
    }

    void shutdown() {
        for (Session session : sessions.values()) {
            session.close();
        }
        sessions.clear();
    }

    Map<String, Object> overview(String connectionId) {
        Session s = session(connectionId);
        MongoDatabase admin = s.client.getDatabase("admin");
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        Document buildInfo = command(admin, new Document("buildInfo", 1));
        out.put("version", buildInfo == null ? "" : string(buildInfo, "version"));
        out.put("bits", buildInfo == null ? 0 : number(buildInfo, "bits"));
        out.put("storageEngines", buildInfo == null ? new ArrayList<String>()
                : buildInfo.getList("storageEngines", String.class, new ArrayList<String>()));
        Document status = command(admin, new Document("serverStatus", 1));
        if (status != null) {
            out.put("uptime", number(status, "uptime"));
            out.put("host", string(status, "host"));
            Document connections = doc(status, "connections");
            out.put("connectionsCurrent", connections == null ? 0 : number(connections, "current"));
            out.put("connectionsAvailable", connections == null ? 0 : number(connections, "available"));
            Document opcounters = doc(status, "opcounters");
            if (opcounters != null) {
                Map<String, Object> ops = new LinkedHashMap<String, Object>();
                ops.put("insert", number(opcounters, "insert"));
                ops.put("query", number(opcounters, "query"));
                ops.put("update", number(opcounters, "update"));
                ops.put("delete", number(opcounters, "delete"));
                ops.put("command", number(opcounters, "command"));
                out.put("opcounters", ops);
            }
            Document mem = doc(status, "mem");
            out.put("memResident", mem == null ? 0 : number(mem, "resident"));
            Document network = doc(status, "network");
            if (network != null) {
                Map<String, Object> net = new LinkedHashMap<String, Object>();
                net.put("bytesIn", number(network, "bytesIn"));
                net.put("bytesOut", number(network, "bytesOut"));
                net.put("numRequests", number(network, "numRequests"));
                out.put("network", net);
            }
        }
        List<Map<String, Object>> databases = databases(s);
        out.put("databases", databases);
        out.put("databaseCount", databases.size());
        return out;
    }

    List<Map<String, Object>> databases(String connectionId) {
        return databases(session(connectionId));
    }

    private List<Map<String, Object>> databases(Session s) {
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        try {
            Document result = command(s.client.getDatabase("admin"),
                    new Document("listDatabases", 1).append("nameOnly", false));
            List<Document> items = result == null ? null : result.getList("databases", Document.class);
            if (items != null) {
                for (Document item : items) {
                    Map<String, Object> db = new LinkedHashMap<String, Object>();
                    db.put("name", string(item, "name"));
                    db.put("sizeOnDisk", item.get("sizeOnDisk") instanceof Number
                            ? ((Number) item.get("sizeOnDisk")).longValue() : 0L);
                    db.put("empty", Boolean.TRUE.equals(item.getBoolean("empty")));
                    out.add(db);
                }
            }
        } catch (Exception e) {
            // 无 listDatabases 权限时退化为仅列名称
            for (String name : s.client.listDatabaseNames()) {
                Map<String, Object> db = new LinkedHashMap<String, Object>();
                db.put("name", name);
                db.put("sizeOnDisk", 0L);
                db.put("empty", false);
                out.add(db);
            }
        }
        Collections.sort(out, new java.util.Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                String an = String.valueOf(a.get("name"));
                String bn = String.valueOf(b.get("name"));
                boolean as = "admin".equals(an) || "local".equals(an) || "config".equals(an);
                boolean bs = "admin".equals(bn) || "local".equals(bn) || "config".equals(bn);
                if (as != bs) {
                    return as ? -1 : 1;
                }
                return an.compareToIgnoreCase(bn);
            }
        });
        return out;
    }

    Map<String, Object> describeDatabase(String connectionId, String database) {
        Session s = session(connectionId);
        MongoDatabase db = s.client.getDatabase(database);
        List<String> names = new ArrayList<String>();
        for (String name : db.listCollectionNames()) {
            names.add(name);
        }
        Collections.sort(names, String.CASE_INSENSITIVE_ORDER);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("name", database);
        out.put("collections", names);
        Document stats = command(db, new Document("dbStats", 1));
        if (stats != null) {
            out.put("collectionsCount", number(stats, "collections"));
            out.put("objects", number(stats, "objects"));
            out.put("dataSize", number(stats, "dataSize"));
            out.put("storageSize", number(stats, "storageSize"));
            out.put("indexes", number(stats, "indexes"));
            out.put("indexSize", number(stats, "indexSize"));
            out.put("avgObjSize", number(stats, "avgObjSize"));
        }
        return out;
    }

    Map<String, Object> collectionStats(String connectionId, String database, String collection) {
        Session s = session(connectionId);
        Document stats = command(s.client.getDatabase(database),
                new Document("collStats", collection));
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("ns", stats == null ? "" : string(stats, "ns"));
        out.put("count", stats == null ? 0 : number(stats, "count"));
        out.put("size", stats == null ? 0 : number(stats, "size"));
        out.put("storageSize", stats == null ? 0 : number(stats, "storageSize"));
        out.put("avgObjSize", stats == null ? 0 : number(stats, "avgObjSize"));
        out.put("nindexes", stats == null ? 0 : number(stats, "nindexes"));
        out.put("totalIndexSize", stats == null ? 0 : number(stats, "totalIndexSize"));
        out.put("capped", stats != null && Boolean.TRUE.equals(stats.getBoolean("capped")));
        out.put("json", stats == null ? "{}" : stats.toJson(JSON));
        return out;
    }

    List<Map<String, Object>> collections(String connectionId, String database) {
        Session s = session(connectionId);
        MongoDatabase db = s.client.getDatabase(database);
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (Document item : db.listCollections()) {
            Map<String, Object> c = new LinkedHashMap<String, Object>();
            c.put("name", string(item, "name"));
            c.put("type", string(item, "type"));
            Object options = item.get("options");
            c.put("options", options == null ? "{}" : item.toJson(JSON));
            out.add(c);
        }
        out.sort(new java.util.Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                return String.valueOf(a.get("name")).compareToIgnoreCase(String.valueOf(b.get("name")));
            }
        });
        return out;
    }

    void createCollection(String connectionId, String database, String collection) {
        Session s = session(connectionId);
        s.client.getDatabase(database).createCollection(collection);
    }

    void dropCollection(String connectionId, String database, String collection, boolean confirm) {
        if (!confirm) {
            throw new IllegalArgumentException("删除集合需要二次确认");
        }
        Session s = session(connectionId);
        s.client.getDatabase(database).getCollection(collection).drop();
    }

    void dropDatabase(String connectionId, String database, boolean confirm) {
        if (!confirm) {
            throw new IllegalArgumentException("删除数据库需要二次确认");
        }
        Session s = session(connectionId);
        s.client.getDatabase(database).drop();
    }

    Map<String, Object> find(String connectionId, String database, String collection,
                             String filterJson, String sortJson, String projectionJson,
                             int skip, int limit) {
        Session s = session(connectionId);
        long start = System.currentTimeMillis();
        MongoCollection<Document> coll = s.client.getDatabase(database).getCollection(collection);
        Document filter = parse(filterJson, "查询条件");
        Document sort = parse(sortJson, "排序");
        Document projection = parse(projectionJson, "字段投影");
        int size = Math.max(1, Math.min(MAX_DOCS, limit));
        FindIterable<Document> iterable = coll.find(filter)
                .skip(Math.max(0, skip))
                .limit(size);
        if (!sort.isEmpty()) {
            iterable = iterable.sort(sort);
        }
        if (!projection.isEmpty()) {
            iterable = iterable.projection(projection);
        }
        List<String> documents = new ArrayList<String>();
        for (Document document : iterable) {
            documents.add(document.toJson(JSON));
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("documents", documents);
        out.put("count", documents.size());
        out.put("skip", Math.max(0, skip));
        out.put("limit", size);
        out.put("elapsedMs", System.currentTimeMillis() - start);
        return out;
    }

    Map<String, Object> count(String connectionId, String database, String collection,
                              String filterJson, boolean estimated) {
        Session s = session(connectionId);
        MongoCollection<Document> coll = s.client.getDatabase(database).getCollection(collection);
        long value = estimated
                ? coll.estimatedDocumentCount()
                : coll.countDocuments(parse(filterJson, "查询条件"));
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("count", value);
        return out;
    }

    Map<String, Object> insert(String connectionId, String database, String collection,
                               String documentJson) {
        Session s = session(connectionId);
        Document document = parse(documentJson, "文档");
        if (document.isEmpty()) {
            throw new IllegalArgumentException("文档不能为空");
        }
        InsertOneResult result = s.client.getDatabase(database).getCollection(collection)
                .insertOne(document, new InsertOneOptions());
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("insertedId", idJson(result.getInsertedId()));
        return out;
    }

    Map<String, Object> replace(String connectionId, String database, String collection,
                                String filterJson, String documentJson, boolean confirm) {
        Session s = session(connectionId);
        Document filter = parse(filterJson, "查询条件");
        Document document = parse(documentJson, "文档");
        if (filter.isEmpty()) {
            throw new IllegalArgumentException("请提供要替换的文档查询条件");
        }
        document.remove("_id");
        if (document.isEmpty() && !confirm) {
            throw new IllegalArgumentException("替换后的文档为空，需要二次确认");
        }
        UpdateResult result = s.client.getDatabase(database).getCollection(collection)
                .replaceOne(filter, document);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("matched", result.getMatchedCount());
        out.put("modified", result.getModifiedCount());
        return out;
    }

    Map<String, Object> update(String connectionId, String database, String collection,
                               String filterJson, String updateJson, boolean multi, boolean upsert,
                               boolean confirm) {
        Session s = session(connectionId);
        Document filter = parse(filterJson, "查询条件");
        Document update = parse(updateJson, "更新内容");
        if (filter.isEmpty() && !confirm) {
            throw new IllegalArgumentException("更新全部文档需要二次确认");
        }
        if (update.isEmpty()) {
            throw new IllegalArgumentException("更新内容不能为空");
        }
        UpdateOptions options = new UpdateOptions().upsert(upsert);
        UpdateResult result = multi
                ? s.client.getDatabase(database).getCollection(collection)
                        .updateMany(filter, update, options)
                : s.client.getDatabase(database).getCollection(collection)
                        .updateOne(filter, update, options);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("matched", result.getMatchedCount());
        out.put("modified", result.getModifiedCount());
        out.put("upsertedId", idJson(result.getUpsertedId()));
        return out;
    }

    Map<String, Object> delete(String connectionId, String database, String collection,
                               String filterJson, boolean multi, boolean confirm) {
        Session s = session(connectionId);
        Document filter = parse(filterJson, "查询条件");
        if (filter.isEmpty() && !confirm) {
            throw new IllegalArgumentException("删除全部文档需要二次确认");
        }
        if (filter.isEmpty()) {
            throw new IllegalArgumentException("为避免误删，请填写删除条件");
        }
        DeleteResult result = multi
                ? s.client.getDatabase(database).getCollection(collection).deleteMany(filter)
                : s.client.getDatabase(database).getCollection(collection).deleteOne(filter);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("deleted", result.getDeletedCount());
        return out;
    }

    List<Map<String, Object>> indexes(String connectionId, String database, String collection) {
        Session s = session(connectionId);
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (Document index : s.client.getDatabase(database).getCollection(collection).listIndexes()) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("name", string(index, "name"));
            Object key = index.get("key");
            item.put("keys", key == null ? "{}" : ((Document) key).toJson(JSON));
            item.put("unique", Boolean.TRUE.equals(index.getBoolean("unique")));
            item.put("sparse", Boolean.TRUE.equals(index.getBoolean("sparse")));
            Object ttl = index.get("expireAfterSeconds");
            item.put("ttl", ttl instanceof Number ? ((Number) ttl).longValue() : -1L);
            item.put("json", index.toJson(JSON));
            out.add(item);
        }
        return out;
    }

    void createIndex(String connectionId, String database, String collection, String keysJson,
                     String name, boolean unique, boolean sparse, long ttl) {
        Session s = session(connectionId);
        Document keys = parse(keysJson, "索引字段");
        if (keys.isEmpty()) {
            throw new IllegalArgumentException("索引字段不能为空，例如 {\"email\": 1}");
        }
        IndexOptions options = new IndexOptions();
        if (name != null && !name.trim().isEmpty()) {
            options.name(name.trim());
        }
        options.unique(unique).sparse(sparse);
        if (ttl > 0) {
            options.expireAfter(ttl, TimeUnit.SECONDS);
        }
        s.client.getDatabase(database).getCollection(collection)
                .createIndex(keys, options);
    }

    void dropIndex(String connectionId, String database, String collection, String name) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("缺少索引名称");
        }
        Session s = session(connectionId);
        s.client.getDatabase(database).getCollection(collection).dropIndex(name.trim());
    }

    String runCommand(String connectionId, String database, String commandJson) {
        Session s = session(connectionId);
        Document command = parse(commandJson, "命令");
        if (command.isEmpty()) {
            throw new IllegalArgumentException("命令不能为空");
        }
        Document result = s.client.getDatabase(database).runCommand(command);
        return result == null ? "{}" : result.toJson(JSON);
    }

    private Session session(String connectionId) {
        pruneSessions();
        Session session = connectionId == null ? null : sessions.get(connectionId);
        if (session == null) {
            throw new IllegalArgumentException("MongoDB 连接已断开，请重新连接");
        }
        session.lastUsed = System.currentTimeMillis();
        return session;
    }

    private void pruneSessions() {
        long cutoff = System.currentTimeMillis() - IDLE_TIMEOUT_MS;
        for (Map.Entry<String, Session> entry : sessions.entrySet()) {
            Session session = entry.getValue();
            if (session.lastUsed < cutoff && sessions.remove(entry.getKey(), session)) {
                session.close();
            }
        }
    }

    private void trimSessions() {
        while (sessions.size() > MAX_SESSIONS) {
            String oldestId = null;
            Session oldest = null;
            for (Map.Entry<String, Session> entry : sessions.entrySet()) {
                if (oldest == null || entry.getValue().lastUsed < oldest.lastUsed) {
                    oldest = entry.getValue();
                    oldestId = entry.getKey();
                }
            }
            if (oldest == null || !sessions.remove(oldestId, oldest)) {
                break;
            }
            oldest.close();
        }
    }

    private static Document command(MongoDatabase db, Document command) {
        try {
            return db.runCommand(command);
        } catch (Exception e) {
            return null;
        }
    }

    private static Document parse(String json, String label) {
        if (json == null || json.trim().isEmpty()) {
            return new Document();
        }
        try {
            return Document.parse(json);
        } catch (Exception e) {
            throw new IllegalArgumentException(label + "不是合法的 JSON: " + friendly(e));
        }
    }

    static List<ServerAddress> parseHosts(String hosts) {
        List<ServerAddress> out = new ArrayList<ServerAddress>();
        if (hosts == null) {
            return out;
        }
        for (String part : hosts.split("[,;\\s]+")) {
            String item = part.trim();
            if (item.isEmpty()) {
                continue;
            }
            if (item.startsWith("mongodb://") || item.startsWith("mongodb+srv://")) {
                try {
                    ConnectionString cs = new ConnectionString(item);
                    for (String host : cs.getHosts()) {
                        ServerAddress address = parseOne(host);
                        if (address != null) {
                            out.add(address);
                        }
                    }
                } catch (Exception e) {
                    throw new IllegalArgumentException("MongoDB 连接串不合法: " + e.getMessage());
                }
                continue;
            }
            ServerAddress address = parseOne(item);
            if (address != null) {
                out.add(address);
            }
        }
        return out;
    }

    private static ServerAddress parseOne(String item) {
        try {
            int colon = item.lastIndexOf(':');
            if (colon > 0 && item.indexOf(']') < 0) {
                String host = item.substring(0, colon).trim();
                int port = Integer.parseInt(item.substring(colon + 1).trim());
                if (host.isEmpty() || port < 1 || port > 65535) {
                    throw new IllegalArgumentException("MongoDB 地址不合法: " + item);
                }
                return new ServerAddress(host, port);
            }
            if (!item.trim().isEmpty()) {
                return new ServerAddress(item.trim(), 27017);
            }
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("MongoDB 端口不合法: " + item);
        }
        return null;
    }

    private static String idJson(BsonValue value) {
        if (value == null || value.isNull()) {
            return "";
        }
        if (value.isObjectId()) {
            return "{\"$oid\":\"" + value.asObjectId().getValue().toHexString() + "\"}";
        }
        return value.toString();
    }

    private static String string(Document doc, String key) {
        Object v = doc == null ? null : doc.get(key);
        return v == null ? "" : String.valueOf(v);
    }

    private static long number(Document doc, String key) {
        Object v = doc == null ? null : doc.get(key);
        if (v instanceof Number) {
            return ((Number) v).longValue();
        }
        return 0;
    }

    private static Document doc(Document doc, String key) {
        Object v = doc == null ? null : doc.get(key);
        return v instanceof Document ? (Document) v : null;
    }

    private static String friendly(Throwable e) {
        Throwable cause = e;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        String msg = cause.getMessage();
        if (msg == null || msg.trim().isEmpty()) {
            msg = cause.getClass().getSimpleName();
        }
        String lower = msg.toLowerCase();
        if (lower.contains("authentication failed") || lower.contains("bad auth")) {
            return "认证失败：请检查用户名、密码和认证数据库；老版本用户可尝试 SCRAM-SHA-1。";
        }
        if (lower.contains("timed out") || lower.contains("timeout")) {
            return "连接 MongoDB 超时，请检查地址、端口、防火墙和副本集状态。";
        }
        if (lower.contains("connection refused")) {
            return "MongoDB 拒绝连接，请确认服务已启动且端口正确。";
        }
        return msg;
    }

    private static final class Session {
        final MongoClient client;
        final int timeout;
        volatile long lastUsed = System.currentTimeMillis();

        Session(MongoClient client, int timeout) {
            this.client = client;
            this.timeout = timeout;
        }

        void close() {
            try {
                client.close();
            } catch (Exception ignore) {
                // ignore
            }
        }
    }
}
