package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.common.DataDir;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.PostConstruct;
import java.io.BufferedInputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * AI 桌面应用插件：导入 ZIP、校验 plugin.json、解压到数据目录并提供静态资源。
 *
 * <p>插件是纯静态网页应用（HTML / JS / CSS / 图片等），运行在桌面窗口的沙箱 iframe 中。
 * ZIP 根目录（或唯一的顶层文件夹）需要包含 plugin.json，示例：</p>
 * <pre>
 * {
 *   "id": "com.example.notes",
 *   "name": "便签",
 *   "version": "1.0.0",
 *   "description": "一个简单的便签应用",
 *   "author": "you",
 *   "icon": "icon.svg",
 *   "entry": "index.html",
 *   "window": { "width": 760, "height": 520, "title": "便签" }
 * }
 * </pre>
 */
@Slf4j
@Service
public class DesktopPluginService {

    private static final int MAX_FILES = 2000;
    private static final long MAX_TOTAL_BYTES = 50L * 1024 * 1024;
    private static final long MAX_FILE_BYTES = 20L * 1024 * 1024;
    private static final long MAX_MANIFEST_BYTES = 512 * 1024;
    private static final int DEFAULT_WIDTH = 760;
    private static final int DEFAULT_HEIGHT = 520;
    private static final ObjectMapper OM = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private final AuditService audit;

    private Path root;
    private Path stagingRoot;

    public DesktopPluginService(AuditService audit) {
        this.audit = audit;
    }

    @PostConstruct
    void init() throws Exception {
        initAt(DataDir.root().resolve("plugins"), DataDir.root().resolve("plugin-staging"));
    }

    /** 初始化存储目录（测试可指定临时目录） */
    void initAt(Path root, Path stagingRoot) throws Exception {
        this.root = root;
        this.stagingRoot = stagingRoot;
        Files.createDirectories(root);
        deleteTree(stagingRoot);
        Files.createDirectories(stagingRoot);
        cleanupTrash();
    }

    public List<PluginInfo> list() {
        List<PluginInfo> out = new ArrayList<>();
        if (root == null || !Files.isDirectory(root)) {
            return out;
        }
        try (java.util.stream.Stream<Path> stream = Files.list(root)) {
            stream.filter(Files::isDirectory)
                    .filter(p -> !p.getFileName().toString().startsWith("."))
                    .forEach(p -> {
                        try {
                            String id = p.getFileName().toString();
                            if (!validId(id)) {
                                return;
                            }
                            PluginInfo info = readInfo(id, p);
                            if (info != null) {
                                out.add(info);
                            }
                        } catch (Exception e) {
                            log.warn("读取桌面插件失败 {}: {}", p.getFileName(), e.getMessage());
                        }
                    });
        } catch (Exception e) {
            log.warn("列出桌面插件失败: {}", e.getMessage());
        }
        out.sort(Comparator.comparing(p -> p.getName() == null ? "" : p.getName()));
        return out;
    }

    /**
     * 导入或更新一个插件 ZIP。同名 / 同 ID 插件会覆盖更新，返回 updated=true。
     */
    public PluginInfo install(MultipartFile zip) throws Exception {
        if (zip == null || zip.isEmpty()) {
            throw new IllegalArgumentException("请选择插件 ZIP 包");
        }
        if (zip.getSize() > MAX_TOTAL_BYTES) {
            throw new IllegalArgumentException("插件包不能超过 50MB");
        }
        if (root == null) {
            throw new IllegalStateException("插件目录尚未初始化");
        }
        String uuid = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        Path staging = stagingRoot.resolve(uuid);
        Files.createDirectories(staging);
        Path backup = null;
        Path target = null;
        boolean hadExisting = false;
        boolean oldMoved = false;
        boolean committed = false;
        try {
            extract(zip, staging);
            Path base = findPluginBase(staging);
            Manifest manifest = readManifest(base);
            validateManifest(manifest);
            String id = resolveId(manifest);
            String entry = safeEntry(manifest.entry == null ? "index.html" : manifest.entry);
            ensureFileUnder(base, entry, "入口文件");
            if (manifest.icon != null && !manifest.icon.trim().isEmpty()) {
                ensureFileUnder(base, safeEntry(manifest.icon), "图标文件");
            }

            target = root.resolve(id).normalize();
            if (!target.startsWith(root)) {
                throw new IllegalArgumentException("插件 ID 不合法");
            }
            hadExisting = Files.exists(target);
            if (hadExisting) {
                Path trash = root.resolve(".trash-" + id + "-" + uuid);
                Files.move(target, trash, StandardCopyOption.REPLACE_EXISTING);
                backup = trash;
                oldMoved = true;
            }
            Files.move(base, target);

            PluginInfo info = readInfo(id, target);
            if (info == null) {
                throw new IllegalStateException("插件清单无效");
            }
            info.updated = hadExisting;
            committed = true;
            audit.record("PLUGIN_INSTALL", id, "OK",
                    info.getName() + " v" + info.getVersion() + (hadExisting ? "（更新）" : ""));
            return info;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("插件安装失败: " + friendly(e));
        } finally {
            deleteTree(staging);
            if (committed) {
                if (backup != null) {
                    deleteTree(backup);
                }
            } else if (hadExisting && !oldMoved) {
                // 旧版本尚未移走，保持原样
            } else {
                if (target != null) {
                    deleteTree(target);
                }
                if (backup != null) {
                    try {
                        Files.move(backup, target, StandardCopyOption.REPLACE_EXISTING);
                    } catch (Exception e) {
                        log.warn("插件更新回滚失败 {}: {}", target, e.getMessage());
                    }
                }
            }
        }
    }

    public void delete(String id) throws Exception {
        if (!validId(id)) {
            throw new IllegalArgumentException("插件 ID 不合法");
        }
        Path target = root.resolve(id).normalize();
        if (!target.startsWith(root) || !Files.isDirectory(target)) {
            throw new IllegalArgumentException("插件不存在: " + id);
        }
        String name = id;
        try {
            PluginInfo info = readInfo(id, target);
            if (info != null && info.getName() != null) {
                name = info.getName();
            }
        } catch (Exception ignore) {
            // ignore
        }
        deleteTree(target);
        audit.record("PLUGIN_DELETE", id, "OK", name);
    }

    private void extract(MultipartFile zip, Path staging) throws Exception {
        int files = 0;
        long total = 0;
        byte[] buf = new byte[64 * 1024];
        try (ZipInputStream zin = new ZipInputStream(
                new BufferedInputStream(zip.getInputStream()), StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zin.getNextEntry()) != null) {
                String raw = entry.getName();
                if (raw == null || raw.isEmpty()) {
                    continue;
                }
                String name = raw.replace('\\', '/');
                if (name.startsWith("/") || name.matches("^[A-Za-z]:.*")) {
                    throw new IllegalArgumentException("ZIP 中包含非法绝对路径: " + raw);
                }
                Path target = staging.resolve(name).normalize();
                if (!target.startsWith(staging)) {
                    throw new IllegalArgumentException("ZIP 中包含越界路径: " + raw);
                }
                if (entry.isDirectory() || name.endsWith("/")) {
                    Files.createDirectories(target);
                    continue;
                }
                if (++files > MAX_FILES) {
                    throw new IllegalArgumentException("插件包文件数超过 " + MAX_FILES + " 个");
                }
                Files.createDirectories(target.getParent());
                long written = 0;
                try (OutputStream out = Files.newOutputStream(target,
                        StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                    int n;
                    while ((n = zin.read(buf)) != -1) {
                        written += n;
                        total += n;
                        if (written > MAX_FILE_BYTES) {
                            throw new IllegalArgumentException("单个文件超过 20MB: " + name);
                        }
                        if (total > MAX_TOTAL_BYTES) {
                            throw new IllegalArgumentException("插件解压后不能超过 50MB");
                        }
                        out.write(buf, 0, n);
                    }
                }
            }
        }
        if (files == 0) {
            throw new IllegalArgumentException("ZIP 包为空");
        }
    }

    private static Path findPluginBase(Path staging) throws Exception {
        if (Files.isRegularFile(staging.resolve("plugin.json"))) {
            return staging;
        }
        List<Path> candidates = new ArrayList<>();
        try (java.util.stream.Stream<Path> stream = Files.list(staging)) {
            stream.filter(Files::isDirectory).forEach(dir -> {
                if (Files.isRegularFile(dir.resolve("plugin.json"))) {
                    candidates.add(dir);
                }
            });
        }
        if (candidates.isEmpty()) {
            throw new IllegalArgumentException("ZIP 根目录缺少 plugin.json");
        }
        if (candidates.size() > 1) {
            throw new IllegalArgumentException("一个 ZIP 只能包含一个插件（发现多个 plugin.json）");
        }
        return candidates.get(0);
    }

    private static Manifest readManifest(Path base) throws Exception {
        try {
            Manifest manifest = parseManifest(base.resolve("plugin.json"));
            if (manifest == null) {
                throw new IllegalArgumentException("plugin.json 内容为空");
            }
            return manifest;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("plugin.json 格式不正确: " + e.getMessage());
        }
    }

    /** 读取清单并容忍 Windows 记事本写入的 UTF-8 BOM */
    private static Manifest parseManifest(Path file) throws Exception {
        if (!Files.isRegularFile(file)) {
            throw new IllegalArgumentException("缺少 plugin.json");
        }
        if (Files.size(file) > MAX_MANIFEST_BYTES) {
            throw new IllegalArgumentException("plugin.json 不能超过 512KB");
        }
        byte[] data = Files.readAllBytes(file);
        if (data.length >= 3 && (data[0] & 0xFF) == 0xEF
                && (data[1] & 0xFF) == 0xBB && (data[2] & 0xFF) == 0xBF) {
            data = java.util.Arrays.copyOfRange(data, 3, data.length);
        }
        return OM.readValue(data, Manifest.class);
    }

    private static void validateManifest(Manifest m) {
        if (m.name == null || m.name.trim().isEmpty()) {
            throw new IllegalArgumentException("plugin.json 缺少 name");
        }
        m.name = limit(m.name.trim(), 60);
        m.version = limit(m.version == null || m.version.trim().isEmpty() ? "1.0.0" : m.version.trim(), 32);
        m.description = limit(m.description == null ? "" : m.description.trim(), 500);
        m.author = limit(m.author == null ? "" : m.author.trim(), 60);
        if (m.id != null && !m.id.trim().isEmpty()) {
            String id = m.id.trim();
            if (!validId(id)) {
                throw new IllegalArgumentException("id 只能使用字母、数字、点、下划线、短横线，且不超过 64 个字符");
            }
        }
    }

    private static String resolveId(Manifest m) throws Exception {
        if (m.id != null && !m.id.trim().isEmpty()) {
            return m.id.trim();
        }
        String slug = m.name.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9._-]+", "-")
                .replaceAll("^-+", "")
                .replaceAll("-+$", "")
                .replaceAll("\\.+$", "");
        if (slug.isEmpty()) {
            slug = "app-" + sha1(m.name).substring(0, 10);
        }
        if (slug.length() > 64) {
            slug = slug.substring(0, 64);
        }
        if (!validId(slug)) {
            slug = "app-" + sha1(m.name).substring(0, 10);
        }
        return slug;
    }

    private static String safeEntry(String value) {
        String path = value == null ? "" : value.trim().replace('\\', '/');
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        if (path.isEmpty() || path.contains("\u0000") || path.length() > 512) {
            throw new IllegalArgumentException("插件文件路径不合法: " + value);
        }
        for (String part : path.split("/")) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) {
                throw new IllegalArgumentException("插件文件路径不合法: " + value);
            }
        }
        return path;
    }

    private static void ensureFileUnder(Path base, String rel, String label) throws Exception {
        Path file = base.resolve(rel).normalize();
        if (!file.startsWith(base) || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException(label + "不存在: " + rel);
        }
    }

    private PluginInfo readInfo(String id, Path dir) throws Exception {
        Path manifestFile = dir.resolve("plugin.json");
        if (!Files.isRegularFile(manifestFile)) {
            return null;
        }
        Manifest m = parseManifest(manifestFile);
        if (m == null || m.name == null || m.name.trim().isEmpty()) {
            return null;
        }
        String entry = safeEntry(m.entry == null || m.entry.trim().isEmpty() ? "index.html" : m.entry);
        Path entryFile = dir.resolve(entry).normalize();
        if (!entryFile.startsWith(dir) || !Files.isRegularFile(entryFile, LinkOption.NOFOLLOW_LINKS)) {
            log.warn("插件 {} 的入口不存在: {}", id, entry);
            return null;
        }
        String iconRel = null;
        Path iconFile = null;
        if (m.icon != null && !m.icon.trim().isEmpty()) {
            try {
                iconRel = safeEntry(m.icon);
                iconFile = dir.resolve(iconRel).normalize();
                if (!iconFile.startsWith(dir) || !Files.isRegularFile(iconFile, LinkOption.NOFOLLOW_LINKS)) {
                    iconFile = null;
                }
            } catch (Exception ignore) {
                iconFile = null;
            }
        }
        long installedAt = Files.getLastModifiedTime(dir).toMillis();
        int[] count = new int[1];
        long[] bytes = new long[1];
        try (java.util.stream.Stream<Path> stream = Files.walk(dir)) {
            stream.filter(Files::isRegularFile).forEach(p -> {
                count[0]++;
                try {
                    bytes[0] += Files.size(p);
                } catch (Exception ignore) {
                    // ignore
                }
            });
        }
        int width = clamp(m.window == null || m.window.width == null ? DEFAULT_WIDTH : m.window.width, 360, 1600);
        int height = clamp(m.window == null || m.window.height == null ? DEFAULT_HEIGHT : m.window.height, 260, 1200);
        String title = m.window != null && m.window.title != null && !m.window.title.trim().isEmpty()
                ? limit(m.window.title.trim(), 80) : limit(m.name.trim(), 60);
        String baseUrl = "/plugin-assets/" + encodePath(id);
        String entryUrl = baseUrl + "/" + encodePath(entry) + "?v=" + installedAt;
        String iconUrl = iconFile == null ? null : baseUrl + "/" + encodePath(iconRel);
        String version = m.version == null || m.version.trim().isEmpty() ? "1.0.0" : limit(m.version.trim(), 32);
        String description = m.description == null ? "" : limit(m.description.trim(), 500);
        String author = m.author == null ? "" : limit(m.author.trim(), 60);
        return new PluginInfo(id, limit(m.name.trim(), 60), version, description, author,
                iconUrl, entryUrl, title, width, height, count[0], bytes[0], installedAt);
    }

    private void cleanupTrash() {
        try (java.util.stream.Stream<Path> stream = Files.list(root)) {
            stream.filter(p -> p.getFileName().toString().startsWith(".trash-"))
                    .forEach(this::deleteTree);
        } catch (Exception e) {
            log.warn("清理插件临时目录失败: {}", e.getMessage());
        }
    }

    private void deleteTree(Path dir) {
        if (dir == null || !Files.exists(dir, LinkOption.NOFOLLOW_LINKS)) {
            return;
        }
        try (java.util.stream.Stream<Path> stream = Files.walk(dir)) {
            stream.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (Exception ignore) {
                    // ignore
                }
            });
        } catch (Exception ignore) {
            // ignore
        }
    }

    private static String encodePath(String path) throws Exception {
        StringBuilder out = new StringBuilder();
        for (String part : path.replace('\\', '/').split("/")) {
            if (part.isEmpty()) {
                continue;
            }
            if (out.length() > 0) {
                out.append('/');
            }
            out.append(URLEncoder.encode(part, "UTF-8").replace("+", "%20"));
        }
        return out.toString();
    }

    private static String friendly(Exception e) {
        String msg = e.getMessage();
        if (msg == null || msg.trim().isEmpty()) {
            return e.getClass().getSimpleName();
        }
        return msg;
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    private static String limit(String s, int max) {
        if (s == null) {
            return "";
        }
        return s.length() <= max ? s : s.substring(0, max);
    }

    private static boolean validId(String id) {
        if (id == null || !id.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,63}") || id.endsWith(".")) {
            return false;
        }
        String upper = id.toUpperCase(Locale.ROOT);
        return !upper.matches("(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\\..*)?");
    }

    private static String sha1(String s) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : d) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    public static class Manifest {
        public String id;
        public String name;
        public String version;
        public String description;
        public String author;
        public String icon;
        public String entry;
        public Window window;
    }

    public static class Window {
        public Integer width;
        public Integer height;
        public String title;
    }

    @Getter
    public static class PluginInfo {
        private final String id;
        private final String name;
        private final String version;
        private final String description;
        private final String author;
        private final String iconUrl;
        private final String entryUrl;
        private final String title;
        private final int windowWidth;
        private final int windowHeight;
        private final int fileCount;
        private final long totalBytes;
        private final long installedAt;
        private boolean updated;

        PluginInfo(String id, String name, String version, String description, String author,
                   String iconUrl, String entryUrl, String title, int windowWidth, int windowHeight,
                   int fileCount, long totalBytes, long installedAt) {
            this.id = id;
            this.name = name;
            this.version = version;
            this.description = description;
            this.author = author;
            this.iconUrl = iconUrl;
            this.entryUrl = entryUrl;
            this.title = title;
            this.windowWidth = windowWidth;
            this.windowHeight = windowHeight;
            this.fileCount = fileCount;
            this.totalBytes = totalBytes;
            this.installedAt = installedAt;
        }
    }
}
