package com.itdct.deepshell.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.plugin.PluginRuntimeService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * 系统备份 / 还原：
 * ZIP 同时包含 SQLite 配置表、浏览器 localStorage 设置、数据目录中的 AI 配置、密码密钥、
 * 背景图、桌面插件、插件数据与 SSH 私钥，便于在新安装的 DeepShell 上完整恢复。
 */
@Slf4j
@Service
public class BackupService {

    private static final String FORMAT = "deepshell-backup";
    private static final int FORMAT_VERSION = 1;
    private static final String KEY_FILE_MARKER = "@backup/ssh-keys/";
    private static final String SECRET_KEY_ENTRY = "config/secret.key";
    private static final String DATABASE_ENTRY = "config/database.json";
    private static final String BROWSER_ENTRY = "config/browser.json";
    private static final String AI_ENTRY = "config/ai.properties";
    private static final String NETWORK_ENTRY = "config/network.properties";

    private static final long MAX_BROWSER_BYTES = 32L * 1024 * 1024;
    private static final int MAX_BROWSER_KEYS = 5000;
    private static final long MAX_IMPORT_BYTES = 2L * 1024 * 1024 * 1024;
    private static final long MAX_CONFIG_ENTRY = 256L * 1024 * 1024;
    private static final long MAX_SINGLE_FILE = 256L * 1024 * 1024;
    private static final long MAX_KEY_FILE = 2L * 1024 * 1024;
    private static final int MAX_ENTRIES = 20000;
    private static final int MAX_ROWS_PER_TABLE = 200000;
    private static final int MAX_TOTAL_ROWS = 500000;

    private static final List<String> TABLES = Collections.unmodifiableList(Arrays.asList(
            "conn_folder",
            "ssh_connection",
            "quick_command",
            "common_dir",
            "port_forward_rule",
            "known_host",
            "desktop_icon_layout",
            "ai_conversation"));

    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<Map<String, Object>>() {
    };

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final ObjectMapper om = new ObjectMapper();
    private final CryptoService crypto;
    private final AuthService auth;
    private final PluginRuntimeService pluginRuntime;
    private final SshSessionManager sessionManager;
    private final AuditService audit;

    @Value("${server.address:127.0.0.1}")
    private String boundAddress;

    public BackupService(JdbcTemplate jdbc, PlatformTransactionManager transactionManager,
                         CryptoService crypto, AuthService auth, PluginRuntimeService pluginRuntime,
                         SshSessionManager sessionManager, AuditService audit) {
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactionManager);
        this.crypto = crypto;
        this.auth = auth;
        this.pluginRuntime = pluginRuntime;
        this.sessionManager = sessionManager;
        this.audit = audit;
    }

    public BackupExport createExport(Map<String, Object> browserBody) throws Exception {
        Map<String, List<Map<String, Object>>> tables = exportTables();
        List<String> warnings = new ArrayList<>();
        List<KeyFile> keyFiles = prepareConnectionKeys(tables, warnings);
        Map<String, String> browserItems = null;
        String browserOrigin = null;
        if (browserBody != null) {
            Object origin = browserBody.get("origin");
            browserOrigin = origin == null ? "" : truncate(String.valueOf(origin), 500);
            browserItems = sanitizeBrowserItems(browserBody.get("items"));
        }

        String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss").format(new Date());
        String fileName = "deepshell-backup-" + stamp + ".zip";
        Path file = Files.createTempFile("deepshell-backup-", ".zip");
        boolean completed = false;
        try (ZipOutputStream zos = new ZipOutputStream(
                new BufferedOutputStream(Files.newOutputStream(file)), StandardCharsets.UTF_8)) {
            Set<String> written = new HashSet<>();
            writeJson(zos, DATABASE_ENTRY, databaseNode(tables), written);
            if (browserItems != null) {
                ObjectNode browser = om.createObjectNode();
                browser.put("savedAt", System.currentTimeMillis());
                browser.put("origin", browserOrigin);
                browser.set("items", om.valueToTree(browserItems));
                writeJson(zos, BROWSER_ENTRY, browser, written);
            }

            Path aiFile = DataDir.root().resolve("ai.properties");
            Path networkFile = DataDir.root().resolve("network.properties");
            Path secretFile = DataDir.root().resolve("secret.key");
            boolean hasAi = Files.isRegularFile(aiFile);
            boolean hasNetwork = Files.isRegularFile(networkFile);
            boolean hasSecret = Files.isRegularFile(secretFile);
            if (hasAi) {
                writeFile(zos, AI_ENTRY, aiFile, written, warnings);
            }
            if (hasNetwork) {
                writeFile(zos, NETWORK_ENTRY, networkFile, written, warnings);
            }
            if (hasSecret) {
                writeFile(zos, SECRET_KEY_ENTRY, secretFile, written, warnings);
            }
            for (KeyFile keyFile : keyFiles) {
                writeBytes(zos, keyFile.entryName, keyFile.data, written);
            }

            addDirectory(zos, DataDir.root().resolve("bg"), "data/bg", written, warnings, false);
            addDirectory(zos, DataDir.root().resolve("plugins"), "data/plugins", written, warnings, true);
            addDirectory(zos, DataDir.root().resolve("plugin-data"), "data/plugin-data",
                    written, warnings, false);

            ObjectNode manifest = om.createObjectNode();
            manifest.put("format", FORMAT);
            manifest.put("version", FORMAT_VERSION);
            manifest.put("createdAt", java.time.OffsetDateTime.now().toString());
            manifest.put("appVersion", appVersion());
            ArrayNode sections = manifest.putArray("sections");
            sections.add("database");
            if (browserItems != null) {
                sections.add("browser");
            }
            if (hasAi) {
                sections.add("ai");
            }
            if (hasNetwork) {
                sections.add("network");
            }
            if (hasSecret) {
                sections.add("secretKey");
            }
            sections.add("backgrounds");
            sections.add("plugins");
            sections.add("pluginData");
            sections.add("sshKeys");
            ObjectNode counts = manifest.putObject("counts");
            counts.put("connections", rowCount(tables, "ssh_connection"));
            counts.put("folders", rowCount(tables, "conn_folder"));
            counts.put("quickCommands", rowCount(tables, "quick_command"));
            counts.put("commonDirs", rowCount(tables, "common_dir"));
            counts.put("portForwards", rowCount(tables, "port_forward_rule"));
            counts.put("knownHosts", rowCount(tables, "known_host"));
            counts.put("desktopLayouts", rowCount(tables, "desktop_icon_layout"));
            counts.put("aiConversations", rowCount(tables, "ai_conversation"));
            counts.put("sshKeys", keyFiles.size());
            counts.put("plugins", countDirectories(DataDir.root().resolve("plugins")));
            counts.put("backgrounds", countFiles(DataDir.root().resolve("bg")));
            counts.put("pluginDataFiles", countFiles(DataDir.root().resolve("plugin-data")));
            ArrayNode warningNode = manifest.putArray("warnings");
            for (String warning : warnings) {
                warningNode.add(warning);
            }
            writeJson(zos, "manifest.json", manifest, written);
            completed = true;
        } finally {
            if (!completed) {
                Files.deleteIfExists(file);
            }
        }
        audit.record("BACKUP_EXPORT", fileName, "OK",
                "连接 " + rowCount(tables, "ssh_connection") + " 条，大小 " + Files.size(file) + " 字节");
        return new BackupExport(file, fileName, Files.size(file), warnings);
    }

    public Map<String, Object> importBackup(MultipartFile file) throws Exception {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("请选择备份 ZIP 文件");
        }
        if (file.getSize() > MAX_IMPORT_BYTES) {
            throw new IllegalArgumentException("备份文件不能超过 2GB");
        }
        String originalName = file.getOriginalFilename() == null ? "backup.zip" : file.getOriginalFilename();
        Path zipPath = Files.createTempFile("deepshell-restore-", ".zip");
        Path staging = Files.createTempDirectory("deepshell-restore-");
        try {
            file.transferTo(zipPath.toFile());
            try (ZipFile zip = new ZipFile(zipPath.toFile(), StandardCharsets.UTF_8)) {
                return doImport(zip, staging, originalName);
            }
        } finally {
            deleteTreeQuietly(staging);
            deleteTreeQuietly(zipPath);
        }
    }

    private Map<String, Object> doImport(ZipFile zip, Path staging, String originalName) throws Exception {
        List<String> warnings = new ArrayList<>();
        JsonNode manifest = readJson(zip, "manifest.json", 1024 * 1024, true);
        if (manifest == null || !FORMAT.equals(manifest.path("format").asText())) {
            throw new IllegalArgumentException("不是有效的 DeepShell 系统备份");
        }
        int version = manifest.path("version").asInt(0);
        if (version <= 0 || version > FORMAT_VERSION) {
            throw new IllegalArgumentException("备份格式版本不受支持（" + version + "）");
        }
        Set<String> sections = resolveSections(manifest, zip);
        JsonNode exportWarnings = manifest.get("warnings");
        if (exportWarnings != null && exportWarnings.isArray()) {
            int count = 0;
            for (JsonNode item : exportWarnings) {
                if (count++ >= 20) {
                    break;
                }
                if (item != null && item.isTextual() && !item.asText().trim().isEmpty()) {
                    warnings.add("备份导出时提示：" + truncate(item.asText(), 300));
                }
            }
        }
        extractData(zip, staging);

        if (!sections.contains("database")) {
            throw new IllegalArgumentException("备份中缺少数据库配置，无法还原");
        }
        Map<String, List<Map<String, Object>>> tables = parseTables(
                readJson(zip, DATABASE_ENTRY, MAX_CONFIG_ENTRY, true));

        Map<String, Object> browser = null;
        if (sections.contains("browser")) {
            browser = parseBrowser(readJson(zip, BROWSER_ENTRY, MAX_BROWSER_BYTES, true));
        }
        byte[] ai = sections.contains("ai") ? readEntry(zip, AI_ENTRY, 16L * 1024 * 1024, true) : null;
        byte[] network = sections.contains("network")
                ? readEntry(zip, NETWORK_ENTRY, 16L * 1024 * 1024, true) : null;
        byte[] secret = sections.contains("secretKey")
                ? readEntry(zip, SECRET_KEY_ENTRY, 16 * 1024, true) : null;
        validateSecretKey(secret);
        if (secret == null && hasEncryptedPasswords(tables)) {
            warnings.add("备份未包含密码加密密钥，已保存的连接密码可能无法使用");
        }

        boolean restartRequired = false;
        if (network != null) {
            network = guardLanSettings(network, warnings);
            restartRequired = needsNetworkRestart(network);
        }

        try {
            sessionManager.closeAll("系统还原");
        } catch (Exception e) {
            log.warn("还原前关闭 SSH 会话失败: {}", e.getMessage());
        }
        boolean pluginsTouched = sections.contains("plugins");
        if (pluginsTouched) {
            unloadPlugins();
        }

        Path root = DataDir.root();
        Path rollback = root.resolve(".restore-" + UUID.randomUUID().toString().replace("-", ""));
        Files.createDirectories(rollback);
        List<Runnable> undo = new ArrayList<>();
        try {
            if (sections.contains("backgrounds")) {
                applyDirectory(root.resolve("bg"), staging.resolve("data/bg"),
                        rollback.resolve("bg"), undo);
            }
            if (sections.contains("plugins")) {
                applyDirectory(root.resolve("plugins"), staging.resolve("data/plugins"),
                        rollback.resolve("plugins"), undo);
            }
            if (sections.contains("pluginData")) {
                applyDirectory(root.resolve("plugin-data"), staging.resolve("data/plugin-data"),
                        rollback.resolve("plugin-data"), undo);
            }
            if (sections.contains("sshKeys")) {
                applyDirectory(root.resolve("keys"), staging.resolve("data/ssh-keys"),
                        rollback.resolve("keys"), undo);
            }
            if (ai != null) {
                applyFile(root.resolve("ai.properties"), ai, undo);
            }
            if (network != null) {
                applyFile(root.resolve("network.properties"), network, undo);
            }
            if (secret != null) {
                applyFile(root.resolve("secret.key"), secret, undo);
                crypto.reloadKey();
            }
            transformKeyPaths(tables, warnings);

            transaction.executeWithoutResult(status -> restoreDatabase(tables));
        } catch (Exception e) {
            for (int i = undo.size() - 1; i >= 0; i--) {
                try {
                    undo.get(i).run();
                } catch (Exception rollbackError) {
                    log.warn("还原回滚失败: {}", rollbackError.getMessage());
                }
            }
            try {
                crypto.reloadKey();
            } catch (Exception keyError) {
                log.warn("还原回滚后重新加载密钥失败: {}", keyError.getMessage());
            }
            if (pluginsTouched) {
                reloadPlugins(warnings);
            }
            if (e instanceof IllegalArgumentException) {
                throw e;
            }
            log.warn("还原系统备份失败", e);
            throw new IllegalArgumentException("还原失败，已回滚到操作前状态：" + failureDetail(e));
        } finally {
            deleteTreeQuietly(rollback);
        }

        if (pluginsTouched) {
            reloadPlugins(warnings);
        }

        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("connections", rowCount(tables, "ssh_connection"));
        counts.put("folders", rowCount(tables, "conn_folder"));
        counts.put("quickCommands", rowCount(tables, "quick_command"));
        counts.put("commonDirs", rowCount(tables, "common_dir"));
        counts.put("portForwards", rowCount(tables, "port_forward_rule"));
        counts.put("knownHosts", rowCount(tables, "known_host"));
        counts.put("desktopLayouts", rowCount(tables, "desktop_icon_layout"));
        counts.put("aiConversations", rowCount(tables, "ai_conversation"));
        counts.put("sshKeys", sections.contains("sshKeys") ? countFiles(staging.resolve("data/ssh-keys")) : 0);
        counts.put("plugins", sections.contains("plugins") ? countDirectories(staging.resolve("data/plugins")) : 0);
        counts.put("backgrounds", sections.contains("backgrounds") ? countFiles(staging.resolve("data/bg")) : 0);
        counts.put("pluginDataFiles", sections.contains("pluginData")
                ? countFiles(staging.resolve("data/plugin-data")) : 0);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("counts", counts);
        result.put("warnings", warnings);
        result.put("restartRequired", restartRequired);
        if (browser != null) {
            result.put("browser", browser);
        }
        result.put("message", "还原完成：连接 " + counts.get("connections")
                + " 条，快捷命令 " + counts.get("quickCommands") + " 条");
        audit.record("BACKUP_IMPORT", originalName, "OK",
                "连接 " + counts.get("connections") + " 条，插件 " + counts.get("plugins") + " 个");
        return result;
    }

    private Map<String, List<Map<String, Object>>> exportTables() {
        Map<String, List<Map<String, Object>>> tables = new LinkedHashMap<>();
        for (String table : TABLES) {
            List<Map<String, Object>> rows = new ArrayList<>();
            try {
                rows = jdbc.queryForList("select * from \"" + table + "\" order by id");
            } catch (Exception e) {
                log.warn("导出数据表 {} 失败: {}", table, e.getMessage());
            }
            tables.put(table, rows);
        }
        return tables;
    }

    private ObjectNode databaseNode(Map<String, List<Map<String, Object>>> tables) {
        ObjectNode root = om.createObjectNode();
        root.put("version", FORMAT_VERSION);
        ObjectNode node = root.putObject("tables");
        for (String table : TABLES) {
            node.set(table, om.valueToTree(tables.get(table) == null
                    ? Collections.emptyList() : tables.get(table)));
        }
        return root;
    }

    private List<KeyFile> prepareConnectionKeys(Map<String, List<Map<String, Object>>> tables,
                                                List<String> warnings) {
        List<KeyFile> out = new ArrayList<>();
        List<Map<String, Object>> connections = tables.get("ssh_connection");
        if (connections == null) {
            return out;
        }
        for (Map<String, Object> row : connections) {
            Object raw = row.get("key_path");
            if (raw == null || String.valueOf(raw).trim().isEmpty()) {
                continue;
            }
            String keyPath = String.valueOf(raw).trim();
            Path source;
            try {
                source = Paths.get(keyPath);
            } catch (Exception e) {
                warnings.add("连接「" + row.get("name") + "」的私钥路径无效，未包含私钥");
                continue;
            }
            if (!Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)) {
                if ("KEY".equalsIgnoreCase(String.valueOf(row.get("auth_type")))) {
                    warnings.add("连接「" + row.get("name") + "」的私钥文件不存在，未包含在备份中");
                }
                continue;
            }
            try {
                long size = Files.size(source);
                if (size > MAX_KEY_FILE) {
                    warnings.add("连接「" + row.get("name") + "」的私钥文件超过 2MB，未包含在备份中");
                    continue;
                }
                String base = source.getFileName() == null ? "key" : source.getFileName().toString();
                base = base.replaceAll("[^A-Za-z0-9._-]", "_");
                if (base.isEmpty()) {
                    base = "key";
                }
                String entryName = "data/ssh-keys/" + row.get("id") + "/" + base;
                byte[] content = Files.readAllBytes(source);
                if (!looksLikePrivateKey(content)) {
                    warnings.add("连接「" + row.get("name") + "」的私钥路径不是可识别的私钥文件，未包含在备份中");
                    continue;
                }
                out.add(new KeyFile(entryName, content));
                row.put("key_path", KEY_FILE_MARKER + row.get("id") + "/" + base);
            } catch (Exception e) {
                warnings.add("连接「" + row.get("name") + "」的私钥文件读取失败，未包含在备份中");
            }
        }
        return out;
    }

    /**
     * 连接的 key_path 由用户任意填写：备份只导出可识别为私钥的文件，
     * 避免把 /etc/shadow 等任意本机文件当作“私钥”打进备份包。
     */
    private static boolean looksLikePrivateKey(byte[] content) {
        if (content == null || content.length == 0) {
            return false;
        }
        int len = Math.min(content.length, 8192);
        String head = new String(content, 0, len, StandardCharsets.ISO_8859_1);
        return head.contains("PRIVATE KEY-----") || head.contains("PuTTY-User-Key-File-");
    }

    private Set<String> resolveSections(JsonNode manifest, ZipFile zip) {
        Set<String> sections = new LinkedHashSet<>();
        JsonNode node = manifest.get("sections");
        if (node != null && node.isArray()) {
            for (JsonNode item : node) {
                if (item != null && item.isTextual()) {
                    sections.add(item.asText());
                }
            }
            return sections;
        }
        if (zip.getEntry(DATABASE_ENTRY) != null) {
            sections.add("database");
        }
        if (zip.getEntry(BROWSER_ENTRY) != null) {
            sections.add("browser");
        }
        if (zip.getEntry(AI_ENTRY) != null) {
            sections.add("ai");
        }
        if (zip.getEntry(NETWORK_ENTRY) != null) {
            sections.add("network");
        }
        if (zip.getEntry(SECRET_KEY_ENTRY) != null) {
            sections.add("secretKey");
        }
        addDataSection(zip, sections, "data/bg/", "backgrounds");
        addDataSection(zip, sections, "data/plugins/", "plugins");
        addDataSection(zip, sections, "data/plugin-data/", "pluginData");
        addDataSection(zip, sections, "data/ssh-keys/", "sshKeys");
        return sections;
    }

    private static void addDataSection(ZipFile zip, Set<String> sections, String prefix, String name) {
        Enumeration<? extends ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            String entryName = entry.getName();
            if (entryName != null && entryName.replace('\\', '/').startsWith(prefix)) {
                sections.add(name);
                return;
            }
        }
    }

    private Map<String, List<Map<String, Object>>> parseTables(JsonNode root) {
        if (root == null || !root.isObject()) {
            throw new IllegalArgumentException("备份中的数据库配置格式不正确");
        }
        JsonNode tablesNode = root.get("tables");
        if (tablesNode == null || !tablesNode.isObject()) {
            throw new IllegalArgumentException("备份中的数据库配置格式不正确");
        }
        Map<String, List<Map<String, Object>>> tables = new LinkedHashMap<>();
        int total = 0;
        for (String table : TABLES) {
            JsonNode array = tablesNode.get(table);
            if (array == null) {
                continue;
            }
            if (!array.isArray()) {
                throw new IllegalArgumentException("备份中的数据表格式不正确: " + table);
            }
            if (array.size() > MAX_ROWS_PER_TABLE) {
                throw new IllegalArgumentException("数据表行数过多: " + table);
            }
            total += array.size();
            if (total > MAX_TOTAL_ROWS) {
                throw new IllegalArgumentException("备份中的数据行数过多");
            }
            List<Map<String, Object>> rows = new ArrayList<>(array.size());
            for (JsonNode rowNode : array) {
                if (!rowNode.isObject()) {
                    throw new IllegalArgumentException("备份中的数据行格式不正确: " + table);
                }
                Map<String, Object> row = om.convertValue(rowNode, MAP_TYPE);
                for (Map.Entry<String, Object> entry : row.entrySet()) {
                    Object value = entry.getValue();
                    if (value instanceof Map || value instanceof List) {
                        throw new IllegalArgumentException("数据表 " + table + " 中存在不支持的嵌套字段");
                    }
                }
                rows.add(row);
            }
            tables.put(table, rows);
        }
        return tables;
    }

    private void transformKeyPaths(Map<String, List<Map<String, Object>>> tables, List<String> warnings) {
        List<Map<String, Object>> connections = tables.get("ssh_connection");
        if (connections == null) {
            return;
        }
        Path keysRoot = DataDir.root().resolve("keys").toAbsolutePath().normalize();
        for (Map<String, Object> row : connections) {
            Object raw = row.get("key_path");
            if (raw == null) {
                continue;
            }
            String keyPath = String.valueOf(raw);
            if (!keyPath.startsWith(KEY_FILE_MARKER)) {
                continue;
            }
            String relative = keyPath.substring(KEY_FILE_MARKER.length());
            Path target = keysRoot.resolve(relative).normalize();
            if (!target.startsWith(keysRoot) || !Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
                row.put("key_path", null);
                warnings.add("连接「" + row.get("name") + "」的私钥未随备份恢复");
            } else {
                row.put("key_path", target.toString());
            }
        }
    }

    private Map<String, Object> parseBrowser(JsonNode node) {
        if (node == null || !node.isObject()) {
            throw new IllegalArgumentException("备份中的浏览器设置格式不正确");
        }
        Map<String, Object> browser = new LinkedHashMap<>();
        browser.put("savedAt", node.path("savedAt").asLong(0));
        browser.put("origin", truncate(node.path("origin").asText(""), 500));
        Object items = node.has("items") ? om.convertValue(node.get("items"), Map.class) : null;
        browser.put("items", sanitizeBrowserItems(items));
        return browser;
    }

    private Map<String, String> sanitizeBrowserItems(Object raw) {
        if (raw != null && !(raw instanceof Map)) {
            throw new IllegalArgumentException("浏览器设置格式不正确");
        }
        Map<String, String> out = new LinkedHashMap<>();
        if (!(raw instanceof Map)) {
            return out;
        }
        long total = 0;
        for (Map.Entry<?, ?> entry : ((Map<?, ?>) raw).entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) {
                continue;
            }
            String key = String.valueOf(entry.getKey());
            if (!key.startsWith("deepshell.")) {
                continue;
            }
            String value = String.valueOf(entry.getValue());
            total += key.length() + value.length();
            if (total > MAX_BROWSER_BYTES) {
                throw new IllegalArgumentException("浏览器设置过大，无法写入备份");
            }
            if (out.size() >= MAX_BROWSER_KEYS) {
                throw new IllegalArgumentException("浏览器设置条目过多，无法写入备份");
            }
            out.put(key, value);
        }
        return out;
    }

    private byte[] guardLanSettings(byte[] raw, List<String> warnings) {
        try {
            Properties properties = new Properties();
            try (InputStream in = new ByteArrayInputStream(raw)) {
                properties.load(in);
            }
            if (!Boolean.parseBoolean(properties.getProperty("lan.enabled", "false"))) {
                return raw;
            }
            if (auth.isEnabled() && !auth.isDefaultPassword()) {
                return raw;
            }
            properties.setProperty("lan.enabled", "false");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            properties.store(out, "DeepShell network settings");
            warnings.add("备份中的局域网访问已关闭：当前实例未启用登录或仍在使用默认密码");
            return out.toByteArray();
        } catch (Exception e) {
            throw new IllegalArgumentException("备份中的网络设置无效: " + e.getMessage());
        }
    }

    private boolean needsNetworkRestart(byte[] raw) {
        try {
            Properties properties = new Properties();
            try (InputStream in = new ByteArrayInputStream(raw)) {
                properties.load(in);
            }
            boolean lan = Boolean.parseBoolean(properties.getProperty("lan.enabled", "false"));
            return lan != "0.0.0.0".equals(boundAddress);
        } catch (Exception e) {
            return true;
        }
    }

    private void validateSecretKey(byte[] raw) {
        if (raw == null) {
            return;
        }
        try {
            byte[] key = Base64.getDecoder().decode(new String(raw, StandardCharsets.UTF_8).trim());
            if (key.length != 16 && key.length != 24 && key.length != 32) {
                throw new IllegalArgumentException("密钥长度无效");
            }
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("备份中的密码密钥无效: " + e.getMessage());
        }
    }

    private boolean hasEncryptedPasswords(Map<String, List<Map<String, Object>>> tables) {
        List<Map<String, Object>> connections = tables.get("ssh_connection");
        if (connections == null) {
            return false;
        }
        for (Map<String, Object> row : connections) {
            if (nonEmpty(row.get("password_enc")) || nonEmpty(row.get("passphrase_enc"))
                    || nonEmpty(row.get("proxy_password_enc"))) {
                return true;
            }
        }
        return false;
    }

    private static boolean nonEmpty(Object value) {
        return value != null && !String.valueOf(value).trim().isEmpty();
    }

    private void restoreDatabase(Map<String, List<Map<String, Object>>> tables) {
        for (int i = TABLES.size() - 1; i >= 0; i--) {
            String table = TABLES.get(i);
            if (!tables.containsKey(table)) {
                continue;
            }
            if (tableColumns(table).isEmpty()) {
                if (!tables.get(table).isEmpty()) {
                    throw new IllegalArgumentException("当前版本缺少数据表: " + table);
                }
                continue;
            }
            jdbc.update("delete from \"" + table + "\"");
        }
        for (String table : TABLES) {
            List<Map<String, Object>> rows = tables.get(table);
            if (rows == null || rows.isEmpty()) {
                continue;
            }
            List<String> targetColumns = tableColumns(table);
            if (targetColumns.isEmpty()) {
                throw new IllegalArgumentException("当前版本缺少数据表: " + table);
            }
            Set<String> backupColumns = new LinkedHashSet<>();
            for (Map<String, Object> row : rows) {
                backupColumns.addAll(row.keySet());
            }
            List<String> columns = new ArrayList<>();
            for (String column : targetColumns) {
                if (backupColumns.contains(column)) {
                    columns.add(column);
                }
            }
            if (columns.isEmpty()) {
                throw new IllegalArgumentException("备份数据与当前版本不兼容: " + table);
            }
            StringBuilder sql = new StringBuilder("insert into \"").append(table).append("\" (");
            StringBuilder values = new StringBuilder();
            for (int i = 0; i < columns.size(); i++) {
                if (i > 0) {
                    sql.append(", ");
                    values.append(", ");
                }
                sql.append('"').append(columns.get(i).replace("\"", "\"\"")).append('"');
                values.append('?');
            }
            sql.append(") values (").append(values).append(')');
            List<Object[]> args = new ArrayList<>(rows.size());
            for (Map<String, Object> row : rows) {
                Object[] valuesRow = new Object[columns.size()];
                for (int i = 0; i < columns.size(); i++) {
                    valuesRow[i] = row.get(columns.get(i));
                }
                args.add(valuesRow);
            }
            jdbc.batchUpdate(sql.toString(), args);
        }
    }

    private List<String> tableColumns(String table) {
        List<String> columns = new ArrayList<>();
        try {
            for (Map<String, Object> row : jdbc.queryForList("PRAGMA table_info(\"" + table + "\")")) {
                Object name = row.get("name");
                if (name != null && !String.valueOf(name).trim().isEmpty()) {
                    columns.add(String.valueOf(name));
                }
            }
        } catch (Exception e) {
            log.warn("读取数据表结构失败 {}: {}", table, e.getMessage());
        }
        return columns;
    }

    private void unloadPlugins() {
        Path root = DataDir.root().resolve("plugins");
        if (!Files.isDirectory(root)) {
            return;
        }
        try (Stream<Path> stream = Files.list(root)) {
            stream.filter(Files::isDirectory)
                    .filter(p -> !p.getFileName().toString().startsWith("."))
                    .forEach(p -> pluginRuntime.unload(p.getFileName().toString()));
        } catch (Exception e) {
            log.warn("还原前释放插件失败: {}", e.getMessage());
        }
    }

    private void reloadPlugins(List<String> warnings) {
        try {
            pluginRuntime.loadAll();
            if (!pluginRuntime.loadErrors().isEmpty()) {
                warnings.add("部分插件后端加载失败，请重启 DeepShell 或查看日志");
            }
        } catch (Exception e) {
            log.warn("还原后加载插件失败: {}", e.getMessage());
            warnings.add("插件后端加载失败，请重启 DeepShell 后检查");
        }
    }

    private void applyDirectory(Path target, Path source, Path rollback, List<Runnable> undo)
            throws Exception {
        boolean existed = Files.exists(target, LinkOption.NOFOLLOW_LINKS);
        if (existed) {
            Files.createDirectories(rollback.getParent());
            move(target, rollback);
        }
        try {
            Files.createDirectories(target);
            if (source != null && Files.isDirectory(source)) {
                copyDirectory(source, target);
            }
        } catch (Exception e) {
            deleteTreeQuietly(target);
            if (existed) {
                move(rollback, target);
            }
            throw e;
        }
        undo.add(() -> {
            deleteTreeQuietly(target);
            if (existed) {
                try {
                    move(rollback, target);
                } catch (Exception e) {
                    throw new IllegalStateException("恢复原目录失败: " + e.getMessage(), e);
                }
            }
        });
    }

    private void applyFile(Path target, byte[] data, List<Runnable> undo) throws Exception {
        byte[] old = Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)
                ? Files.readAllBytes(target) : null;
        Files.createDirectories(target.getParent());
        try {
            Files.write(target, data, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        } catch (Exception e) {
            restoreFile(target, old);
            throw e;
        }
        if ("secret.key".equals(target.getFileName().toString())) {
            try {
                Files.setPosixFilePermissions(target, PosixFilePermissions.fromString("rw-------"));
            } catch (Exception ignore) {
                // Windows 等文件系统不支持 POSIX 权限
            }
        }
        undo.add(() -> {
            try {
                restoreFile(target, old);
            } catch (IOException e) {
                throw new IllegalStateException("恢复原配置文件失败: " + e.getMessage(), e);
            }
        });
    }

    private static void restoreFile(Path target, byte[] data) throws IOException {
        if (data == null) {
            Files.deleteIfExists(target);
        } else {
            Files.write(target, data, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        }
    }

    private void extractData(ZipFile zip, Path staging) throws Exception {
        Set<String> names = new HashSet<>();
        long totalBytes = 0;
        int files = 0;
        Enumeration<? extends ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            String name = safeEntryName(entry.getName());
            if (name.isEmpty()) {
                continue;
            }
            if (!names.add(name)) {
                throw new IllegalArgumentException("备份中存在重复条目: " + name);
            }
            if (names.size() > MAX_ENTRIES) {
                throw new IllegalArgumentException("备份中的文件数量过多");
            }
            if (entry.getSize() > MAX_SINGLE_FILE) {
                throw new IllegalArgumentException("备份中的单个文件超过 256MB: " + name);
            }
            if (!name.startsWith("data/")) {
                continue;
            }
            if (!allowedDataEntry(name)
                    || (name.startsWith("data/plugins/") && hasHiddenSegment(name.substring("data/".length())))) {
                continue;
            }
            Path target = staging.resolve(name).normalize();
            if (!target.startsWith(staging)) {
                throw new IllegalArgumentException("备份中包含越界路径: " + name);
            }
            if (entry.isDirectory()) {
                Files.createDirectories(target);
                continue;
            }
            files++;
            if (files > MAX_ENTRIES) {
                throw new IllegalArgumentException("备份中的文件数量过多");
            }
            Files.createDirectories(target.getParent());
            try (InputStream in = zip.getInputStream(entry);
                 OutputStream out = new BufferedOutputStream(Files.newOutputStream(target))) {
                byte[] buffer = new byte[64 * 1024];
                long fileBytes = 0;
                int read;
                while ((read = in.read(buffer)) >= 0) {
                    fileBytes += read;
                    totalBytes += read;
                    if (fileBytes > MAX_SINGLE_FILE) {
                        throw new IllegalArgumentException("备份中的单个文件超过 256MB: " + name);
                    }
                    if (totalBytes > MAX_IMPORT_BYTES) {
                        throw new IllegalArgumentException("备份解压后超过 2GB");
                    }
                    out.write(buffer, 0, read);
                }
            }
        }
        if (totalBytes == 0 && files == 0) {
            log.debug("备份中没有需要解压的数据文件");
        }
    }

    private static boolean allowedDataEntry(String name) {
        return name.startsWith("data/bg/")
                || name.startsWith("data/plugins/")
                || name.startsWith("data/plugin-data/")
                || name.startsWith("data/ssh-keys/");
    }

    private static boolean hasHiddenSegment(String relative) {
        for (String segment : relative.replace('\\', '/').split("/")) {
            if (segment.startsWith(".")) {
                return true;
            }
        }
        return false;
    }

    private static String safeEntryName(String raw) {
        if (raw == null) {
            return "";
        }
        String name = raw.replace('\\', '/');
        while (name.endsWith("/")) {
            name = name.substring(0, name.length() - 1);
        }
        if (name.isEmpty()) {
            return "";
        }
        if (name.startsWith("/") || name.matches("^[A-Za-z]:.*") || name.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("备份中包含非法路径: " + raw);
        }
        for (String segment : name.split("/")) {
            if ("..".equals(segment)) {
                throw new IllegalArgumentException("备份中包含越界路径: " + raw);
            }
        }
        return name;
    }

    private JsonNode readJson(ZipFile zip, String name, long max, boolean required) throws Exception {
        byte[] bytes = readEntry(zip, name, max, required);
        if (bytes == null) {
            return null;
        }
        return om.readTree(bytes);
    }

    private byte[] readEntry(ZipFile zip, String name, long max, boolean required) throws Exception {
        ZipEntry entry = zip.getEntry(name);
        if (entry == null || entry.isDirectory()) {
            if (required) {
                throw new IllegalArgumentException("备份缺少必要文件: " + name);
            }
            return null;
        }
        if (entry.getSize() > max) {
            throw new IllegalArgumentException("备份中的文件过大: " + name);
        }
        try (InputStream in = zip.getInputStream(entry)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            int read;
            while ((read = in.read(buffer)) >= 0) {
                total += read;
                if (total > max) {
                    throw new IllegalArgumentException("备份中的文件过大: " + name);
                }
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private void addDirectory(ZipOutputStream zos, Path dir, String prefix,
                              Set<String> written, List<String> warnings, boolean skipHidden)
            throws IOException {
        if (!Files.isDirectory(dir)) {
            return;
        }
        List<Path> paths;
        try (Stream<Path> stream = Files.walk(dir)) {
            paths = new ArrayList<>();
            stream.forEach(paths::add);
        }
        Collections.sort(paths);
        for (Path path : paths) {
            if (path.equals(dir)) {
                continue;
            }
            String relative = dir.relativize(path).toString().replace('\\', '/');
            if (skipHidden && hasHiddenSegment(relative)) {
                continue;
            }
            if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
                continue;
            }
            String entryName = prefix + "/" + relative;
            if (written.contains(entryName)) {
                continue;
            }
            long size;
            try {
                size = Files.size(path);
            } catch (IOException e) {
                warnings.add("读取文件失败，已跳过: " + entryName);
                continue;
            }
            if (size > MAX_SINGLE_FILE) {
                warnings.add("文件超过 256MB，已跳过: " + entryName);
                continue;
            }
            try (InputStream in = Files.newInputStream(path)) {
                ZipEntry entry = new ZipEntry(entryName);
                entry.setTime(Files.getLastModifiedTime(path).toMillis());
                zos.putNextEntry(entry);
                try {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) >= 0) {
                        zos.write(buffer, 0, read);
                    }
                } finally {
                    zos.closeEntry();
                }
                written.add(entryName);
            }
        }
    }

    private void writeFile(ZipOutputStream zos, String name, Path file,
                           Set<String> written, List<String> warnings) throws IOException {
        if (written.contains(name)) {
            return;
        }
        long size;
        try {
            size = Files.size(file);
        } catch (IOException e) {
            warnings.add("读取文件失败，已跳过: " + name);
            return;
        }
        if (size > MAX_SINGLE_FILE) {
            warnings.add("文件超过 256MB，已跳过: " + name);
            return;
        }
        try (InputStream in = Files.newInputStream(file)) {
            ZipEntry entry = new ZipEntry(name);
            entry.setTime(Files.getLastModifiedTime(file).toMillis());
            zos.putNextEntry(entry);
            try {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) >= 0) {
                    zos.write(buffer, 0, read);
                }
            } finally {
                zos.closeEntry();
            }
            written.add(name);
        }
    }

    private void writeJson(ZipOutputStream zos, String name, JsonNode node, Set<String> written)
            throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        om.writerWithDefaultPrettyPrinter().writeValue(out, node);
        writeBytes(zos, name, out.toByteArray(), written);
    }

    private void writeBytes(ZipOutputStream zos, String name, byte[] data, Set<String> written)
            throws IOException {
        if (!written.add(name)) {
            return;
        }
        ZipEntry entry = new ZipEntry(name);
        entry.setTime(System.currentTimeMillis());
        zos.putNextEntry(entry);
        zos.write(data);
        zos.closeEntry();
    }

    private static void copyDirectory(Path source, Path target) throws IOException {
        List<Path> paths;
        try (Stream<Path> stream = Files.walk(source)) {
            paths = new ArrayList<>();
            stream.forEach(paths::add);
        }
        for (Path path : paths) {
            Path destination = target.resolve(source.relativize(path).toString());
            if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) {
                Files.createDirectories(destination);
            } else if (Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
                Files.createDirectories(destination.getParent());
                Files.copy(path, destination, StandardCopyOption.REPLACE_EXISTING);
            }
        }
    }

    private static void move(Path source, Path target) throws IOException {
        Files.createDirectories(target.getParent());
        Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
    }

    private static void deleteTreeQuietly(Path path) {
        if (path == null || !Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
            return;
        }
        try (Stream<Path> stream = Files.walk(path)) {
            List<Path> paths = new ArrayList<>();
            stream.forEach(paths::add);
            Collections.sort(paths, Collections.reverseOrder());
            for (Path p : paths) {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException ignore) {
                    // 临时文件清理失败不影响主流程
                }
            }
        } catch (IOException e) {
            log.debug("清理临时目录失败 {}: {}", path, e.getMessage());
        }
    }

    private static int rowCount(Map<String, List<Map<String, Object>>> tables, String table) {
        List<Map<String, Object>> rows = tables.get(table);
        return rows == null ? 0 : rows.size();
    }

    private static int countFiles(Path dir) {
        if (dir == null || !Files.isDirectory(dir)) {
            return 0;
        }
        try (Stream<Path> stream = Files.walk(dir)) {
            return (int) stream.filter(p -> Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS)).count();
        } catch (IOException e) {
            return 0;
        }
    }

    private static int countDirectories(Path dir) {
        if (dir == null || !Files.isDirectory(dir)) {
            return 0;
        }
        try (Stream<Path> stream = Files.list(dir)) {
            return (int) stream.filter(Files::isDirectory)
                    .filter(p -> !p.getFileName().toString().startsWith(".")).count();
        } catch (IOException e) {
            return 0;
        }
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return "";
        }
        return value.length() <= max ? value : value.substring(0, max);
    }

    private static String failureDetail(Exception e) {
        String message = e.getMessage();
        if (message == null || message.trim().isEmpty()) {
            return e.getClass().getSimpleName();
        }
        if (message.contains("NOT NULL constraint failed")) {
            return "备份数据缺少必填字段";
        }
        if (message.contains("UNIQUE constraint failed")) {
            return "备份数据存在重复记录";
        }
        if (message.contains("no such table")) {
            return "当前版本缺少备份所需的数据表";
        }
        return truncate(message, 200);
    }

    private static String appVersion() {
        String version = BackupService.class.getPackage().getImplementationVersion();
        return version == null ? "dev" : version;
    }

    private static final class KeyFile {
        private final String entryName;
        private final byte[] data;

        private KeyFile(String entryName, byte[] data) {
            this.entryName = entryName;
            this.data = data;
        }
    }

    public static final class BackupExport {
        private final Path file;
        private final String fileName;
        private final long size;
        private final List<String> warnings;

        public BackupExport(Path file, String fileName, long size, List<String> warnings) {
            this.file = file;
            this.fileName = fileName;
            this.size = size;
            this.warnings = warnings == null ? Collections.emptyList() : warnings;
        }

        public Path getFile() {
            return file;
        }

        public String getFileName() {
            return fileName;
        }

        public long getSize() {
            return size;
        }

        public List<String> getWarnings() {
            return warnings;
        }
    }
}
