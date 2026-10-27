package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.dto.FileChecksumResult;
import com.itdct.deepshell.dto.FileContentMatch;
import com.itdct.deepshell.dto.SftpEntry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.FileSystems;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 无 SSH 连接时的本地桌面文件服务：所有路径都限制在数据目录的 Desktop 子目录内，
 * 不向插件或前端暴露任意本机路径。
 */
@Slf4j
@Service
public class LocalDesktopService {

    private static final long MAX_TEXT_BYTES = 8L * 1024 * 1024;
    private static final long MAX_THUMB_SOURCE = 30L * 1024 * 1024;
    private static final int MAX_COPY_DEPTH = 64;
    private static final int MAX_UPLOAD_DEPTH = 64;
    private static final int MAX_CONTENT_SEARCH_DEPTH = 8;
    private static final int MAX_CONTENT_SEARCH_FILES = 2000;
    private static final long MAX_CONTENT_SEARCH_FILE = 5L * 1024 * 1024;
    private static final int MAX_CONTENT_MATCH_TEXT = 600;
    private static final Set<String> SKIP_SEARCH_DIRS = new HashSet<>(Arrays.asList(
            ".git", ".svn", ".hg", "node_modules", "target", "dist", ".idea", "__pycache__"));
    private static final Set<String> WINDOWS_RESERVED_NAMES = new HashSet<>(Arrays.asList(
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"));

    private final Path root;

    public LocalDesktopService() {
        this.root = DataDir.root().resolve("Desktop").toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            log.warn("无法创建本地桌面目录 {}: {}", root, e.getMessage());
        }
    }

    public Path getRoot() {
        return root;
    }

    public List<SftpEntry> list(String virtualPath) throws IOException {
        Path dir = existing(virtualPath);
        if (!Files.isDirectory(dir)) {
            throw new IllegalArgumentException("目标不是目录");
        }
        List<SftpEntry> out = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path child : stream) {
                BasicFileAttributes attrs = Files.readAttributes(child, BasicFileAttributes.class,
                        LinkOption.NOFOLLOW_LINKS);
                out.add(new SftpEntry(child.getFileName().toString(), attrs.isDirectory(),
                        attrs.isSymbolicLink(), attrs.size(), attrs.lastModifiedTime().toMillis(),
                        perms(attrs)));
            }
        }
        out.sort(Comparator.comparing(SftpEntry::isDir).reversed()
                .thenComparing(e -> e.getName().toLowerCase(Locale.ROOT)));
        return out;
    }

    public String readText(String virtualPath) throws IOException {
        Path file = existing(virtualPath);
        if (!Files.isRegularFile(file)) {
            throw new IllegalArgumentException("目标不是文件");
        }
        long size = Files.size(file);
        if (size > MAX_TEXT_BYTES) {
            throw new IllegalArgumentException("文件超过 8MB，请下载后使用本地编辑器打开");
        }
        return new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
    }

    public void writeText(String virtualPath, String content) throws IOException {
        Path file = writable(virtualPath);
        if (Files.isDirectory(file)) {
            throw new IllegalArgumentException("目标是一个目录");
        }
        byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_TEXT_BYTES) {
            throw new IllegalArgumentException("文件超过 8MB，无法在浏览器中保存");
        }
        Files.write(file, bytes, StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
    }

    public void mkdir(String virtualPath) throws IOException {
        Path dir = writable(virtualPath);
        if (Files.exists(dir, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("目标已存在");
        }
        Files.createDirectory(dir);
    }

    public void createFile(String virtualPath) throws IOException {
        Path file = writable(virtualPath);
        if (Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("目标已存在");
        }
        Files.createFile(file);
    }

    public void rename(String virtualPath, String newName) throws IOException {
        String name = cleanName(newName);
        Path src = existing(virtualPath);
        Path target = writableChild(src.getParent(), name);
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("同名文件或文件夹已存在");
        }
        Files.move(src, target);
    }

    public void move(String virtualPath, String destDir) throws IOException {
        Path src = existing(virtualPath);
        if (src.equals(root)) {
            throw new IllegalArgumentException("不能移动桌面根目录");
        }
        Path dir = existing(destDir);
        requireDirectory(dir);
        if (Files.isDirectory(src) && (dir.equals(src) || dir.startsWith(src))) {
            throw new IllegalArgumentException("不能把文件夹移动到自身或其子目录");
        }
        Path target = writableChild(dir, src.getFileName().toString());
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("目标目录中已存在同名项目");
        }
        Files.move(src, target);
    }

    public List<String> copy(List<String> paths, String destDir) throws IOException {
        if (paths == null || paths.isEmpty()) {
            throw new IllegalArgumentException("没有要复制的项目");
        }
        Path dir = existing(destDir);
        requireDirectory(dir);
        List<String> created = new ArrayList<>();
        for (String path : paths) {
            Path src = existing(path);
            if (src.equals(root)) {
                throw new IllegalArgumentException("不能复制桌面根目录");
            }
            if (Files.isDirectory(src) && (dir.equals(src) || dir.startsWith(src))) {
                throw new IllegalArgumentException("不能把文件夹复制到自身或其子目录");
            }
            Path target = uniqueTarget(dir, src.getFileName().toString());
            copyRecursive(src, target, 0);
            created.add(target.getFileName().toString());
        }
        return created;
    }

    public void delete(String virtualPath) throws IOException {
        Path target = existing(virtualPath);
        if (target.equals(root)) {
            throw new IllegalArgumentException("不能删除桌面根目录");
        }
        Files.walkFileTree(target, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Files.delete(file);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
                if (exc != null) {
                    throw exc;
                }
                Files.delete(dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    public void upload(String virtualDir, MultipartFile file) throws IOException {
        upload(virtualDir, null, file);
    }

    /** relativePath 可包含多级目录（文件夹上传），自动创建父目录 */
    public void upload(String virtualDir, String relativePath, MultipartFile file) throws IOException {
        uploadWithPolicy(virtualDir, relativePath, file, SftpService.CONFLICT_OVERWRITE);
    }

    /** 按同名冲突策略上传；返回实际写入的相对路径、是否跳过/重命名 */
    public Map<String, Object> uploadWithPolicy(String virtualDir, String relativePath,
                                                MultipartFile file, String conflictPolicy)
            throws IOException {
        if (file == null) {
            throw new IllegalArgumentException("上传文件不存在");
        }
        List<String> parts = uploadParts(relativePath, file.getOriginalFilename());
        Path dir = existing(virtualDir);
        requireDirectory(dir);
        for (int i = 0; i < parts.size() - 1; i++) {
            dir = writableChild(dir, parts.get(i));
            if (Files.exists(dir, LinkOption.NOFOLLOW_LINKS)) {
                requireDirectory(dir);
            } else {
                Files.createDirectory(dir);
            }
        }
        String relative = String.join("/", parts);
        String virtualPath = virtualJoin(virtualDir, relative);
        String policy = SftpService.normalizeConflictPolicy(conflictPolicy);
        Path target = writableChild(dir, parts.get(parts.size() - 1));
        boolean renamed = false;
        if (SftpService.CONFLICT_SKIP.equals(policy)
                && Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            Map<String, Object> skipped = new LinkedHashMap<>();
            skipped.put("path", virtualPath);
            skipped.put("name", target.getFileName().toString());
            skipped.put("skipped", true);
            skipped.put("renamed", false);
            return skipped;
        }
        if (SftpService.CONFLICT_RENAME.equals(policy)
                && Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            target = uniqueTarget(dir, target.getFileName().toString());
            renamed = true;
        }
        try (InputStream in = file.getInputStream()) {
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        }
        String actualName = target.getFileName().toString();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("path", renamed ? virtualJoin(virtualDir, parentRelative(relative) + actualName) : virtualPath);
        out.put("name", actualName);
        out.put("skipped", false);
        out.put("renamed", renamed);
        return out;
    }

    /** 上传前预检本地桌面沙箱中的同名文件 */
    public List<Map<String, Object>> checkUploadConflicts(
            String virtualDir, List<SftpService.UploadConflictFile> files) throws IOException {
        Path dir = existing(virtualDir);
        requireDirectory(dir);
        List<Map<String, Object>> conflicts = new ArrayList<>();
        Set<String> checked = new HashSet<>();
        if (files == null) {
            return conflicts;
        }
        for (SftpService.UploadConflictFile file : files) {
            if (file == null) {
                continue;
            }
            List<String> parts = uploadParts(file.getRelativePath(), file.getName());
            String relative = String.join("/", parts);
            if (!checked.add(relative)) {
                continue;
            }
            Path parent = dir;
            Path target = null;
            boolean blocked = false;
            for (int i = 0; i < parts.size() - 1; i++) {
                parent = writableChild(parent, parts.get(i));
                if (!Files.exists(parent, LinkOption.NOFOLLOW_LINKS)) {
                    break;
                }
                if (!Files.isDirectory(parent)) {
                    blocked = true;
                    target = parent;
                    break;
                }
            }
            if (!blocked && Files.exists(parent, LinkOption.NOFOLLOW_LINKS)) {
                Path candidate = writableChild(parent, parts.get(parts.size() - 1));
                if (Files.exists(candidate, LinkOption.NOFOLLOW_LINKS)) {
                    target = candidate;
                }
            }
            if (target == null) {
                continue;
            }
            boolean isDir = Files.isDirectory(target, LinkOption.NOFOLLOW_LINKS);
            long size = isDir ? 0L : Files.size(target);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("relativePath", relative);
            item.put("name", parts.get(parts.size() - 1));
            item.put("dir", isDir);
            item.put("size", size);
            item.put("sameSize", !isDir && file.getSize() > 0 && file.getSize() == size);
            conflicts.add(item);
        }
        return conflicts;
    }

    private static String virtualJoin(String dir, String relative) {
        String base = dir == null || dir.trim().isEmpty() ? "/" : dir.trim();
        if (!base.startsWith("/")) {
            base = "/" + base;
        }
        while (base.length() > 1 && base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return ("/".equals(base) ? "/" : base + "/") + relative;
    }

    private static String parentRelative(String relative) {
        int idx = relative.lastIndexOf('/');
        return idx < 0 ? "" : relative.substring(0, idx + 1);
    }

    private static List<String> uploadParts(String relativePath, String originalName) {
        String rel = relativePath == null ? "" : relativePath.replace('\\', '/');
        while (rel.startsWith("/")) {
            rel = rel.substring(1);
        }
        if (rel.isEmpty()) {
            String name = originalName == null ? "" : originalName.replace('\\', '/');
            int idx = name.lastIndexOf('/');
            if (idx >= 0) {
                name = name.substring(idx + 1);
            }
            rel = name;
        }
        if (rel.isEmpty() || rel.endsWith("/")) {
            throw new IllegalArgumentException("文件名不合法");
        }
        String[] raw = rel.split("/");
        if (raw.length > MAX_UPLOAD_DEPTH) {
            throw new IllegalArgumentException("目录层级过深");
        }
        List<String> parts = new ArrayList<>();
        for (String part : raw) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)
                    || part.indexOf('\0') >= 0 || part.indexOf('\n') >= 0
                    || part.indexOf('\r') >= 0) {
                throw new IllegalArgumentException("上传路径不合法");
            }
            parts.add(cleanName(part));
        }
        return parts;
    }

    public long fileSize(String virtualPath) throws IOException {
        Path file = existing(virtualPath);
        if (!Files.isRegularFile(file)) {
            throw new IllegalArgumentException("目标不是文件");
        }
        return Files.size(file);
    }

    /** 文件大小与修改时间（秒），用于下载断点续传的 ETag / Last-Modified */
    public long[] fileStat(String virtualPath) throws IOException {
        Path file = existing(virtualPath);
        if (!Files.isRegularFile(file)) {
            throw new IllegalArgumentException("目标不是文件");
        }
        return new long[]{Files.size(file), Files.getLastModifiedTime(file).toMillis() / 1000L};
    }

    public void download(String virtualPath, OutputStream out) throws IOException {
        Path file = existing(virtualPath);
        if (!Files.isRegularFile(file)) {
            throw new IllegalArgumentException("目标不是文件");
        }
        Files.copy(file, out);
    }

    public byte[] readBytes(String virtualPath, long maxBytes) throws IOException {
        Path file = existing(virtualPath);
        if (!Files.isRegularFile(file)) {
            throw new IllegalArgumentException("目标不是文件");
        }
        long size = Files.size(file);
        if (size > maxBytes) {
            throw new IllegalArgumentException("文件过大");
        }
        return Files.readAllBytes(file);
    }

    public void streamRange(String virtualPath, long offset, long length, OutputStream out) throws IOException {
        Path file = existing(virtualPath);
        if (!Files.isRegularFile(file)) {
            throw new IllegalArgumentException("目标不是文件");
        }
        try (java.nio.channels.SeekableByteChannel channel = Files.newByteChannel(
                file, StandardOpenOption.READ)) {
            channel.position(offset);
            java.nio.ByteBuffer buffer = java.nio.ByteBuffer.allocate(64 * 1024);
            long remaining = length;
            while (remaining > 0) {
                buffer.clear();
                buffer.limit((int) Math.min(buffer.capacity(), remaining));
                int read = channel.read(buffer);
                if (read < 0) {
                    break;
                }
                out.write(buffer.array(), 0, read);
                remaining -= read;
            }
        }
    }

    /**
     * 本地桌面内容搜索：只扫描数据目录内的文本文件，限制目录深度、文件数与单文件大小，
     * 避免大目录阻塞请求线程。
     */
    public List<FileContentMatch> contentSearch(String virtualPath, String keyword, String include,
                                                boolean caseSensitive, int limit) throws IOException {
        List<FileContentMatch> out = new ArrayList<>();
        String kw = keyword == null ? "" : keyword.trim();
        if (kw.isEmpty()) {
            return out;
        }
        if (kw.length() > 200 || kw.contains("\n") || kw.contains("\r")) {
            throw new IllegalArgumentException("搜索关键字不合法");
        }
        int max = limit <= 0 ? 100 : Math.min(limit, 300);
        final Path base = existing(virtualPath);
        requireDirectory(base);
        final List<PathMatcher> matchers = contentMatchers(include);
        final String needle = caseSensitive ? kw : kw.toLowerCase(Locale.ROOT);
        final int[] scanned = {0};
        Files.walkFileTree(base, java.util.EnumSet.noneOf(java.nio.file.FileVisitOption.class),
                MAX_CONTENT_SEARCH_DEPTH, new SimpleFileVisitor<Path>() {
                    @Override
                    public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                        if (!dir.equals(base) && SKIP_SEARCH_DIRS.contains(
                                dir.getFileName().toString().toLowerCase(Locale.ROOT))) {
                            return FileVisitResult.SKIP_SUBTREE;
                        }
                        return FileVisitResult.CONTINUE;
                    }

                    @Override
                    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                        if (out.size() >= max) {
                            return FileVisitResult.TERMINATE;
                        }
                        if (!attrs.isRegularFile() || attrs.size() <= 0
                                || attrs.size() > MAX_CONTENT_SEARCH_FILE) {
                            return FileVisitResult.CONTINUE;
                        }
                        if (!matchers.isEmpty()) {
                            boolean matched = false;
                            for (PathMatcher matcher : matchers) {
                                if (matcher.matches(file.getFileName())) {
                                    matched = true;
                                    break;
                                }
                            }
                            if (!matched) {
                                return FileVisitResult.CONTINUE;
                            }
                        }
                        if (++scanned[0] > MAX_CONTENT_SEARCH_FILES) {
                            return FileVisitResult.TERMINATE;
                        }
                        byte[] bytes = Files.readAllBytes(file);
                        int probe = Math.min(bytes.length, 4096);
                        for (int i = 0; i < probe; i++) {
                            if (bytes[i] == 0) {
                                return FileVisitResult.CONTINUE;
                            }
                        }
                        String virtual = "/" + root.relativize(file).toString().replace('\\', '/');
                        String text = new String(bytes, StandardCharsets.UTF_8);
                        String[] lines = text.split("\n", -1);
                        for (int i = 0; i < lines.length && out.size() < max; i++) {
                            String line = lines[i].replace("\r", "");
                            String haystack = caseSensitive ? line : line.toLowerCase(Locale.ROOT);
                            if (haystack.contains(needle)) {
                                if (line.length() > MAX_CONTENT_MATCH_TEXT) {
                                    line = line.substring(0, MAX_CONTENT_MATCH_TEXT) + "…";
                                }
                                out.add(new FileContentMatch(virtual, i + 1, line));
                            }
                        }
                        return FileVisitResult.CONTINUE;
                    }
                });
        return out;
    }

    /** 本地文件校验和（MD5 / SHA-1 / SHA-256），流式读取，不占用大内存。 */
    public FileChecksumResult checksum(String virtualPath, String algorithm) throws IOException {
        String alg = FileSearchService.normalizeAlgorithm(algorithm);
        Path file = existing(virtualPath);
        if (!Files.isRegularFile(file)) {
            throw new IllegalArgumentException("目标不是文件");
        }
        String instance = "md5".equals(alg) ? "MD5" : ("sha1".equals(alg) ? "SHA-1" : "SHA-256");
        try {
            MessageDigest digest = MessageDigest.getInstance(instance);
            try (InputStream in = Files.newInputStream(file)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    digest.update(buf, 0, n);
                }
            }
            StringBuilder sb = new StringBuilder();
            for (byte b : digest.digest()) {
                sb.append(String.format("%02x", b));
            }
            return new FileChecksumResult(virtualPath, alg, sb.toString());
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("当前 Java 环境不支持 " + alg + " 校验");
        }
    }

    private static List<PathMatcher> contentMatchers(String include) {
        List<PathMatcher> out = new ArrayList<>();
        if (include == null) {
            return out;
        }
        for (String part : include.split("[,;\\s]+")) {
            String pattern = part.trim();
            if (pattern.isEmpty() || pattern.length() > 120
                    || pattern.contains("/") || pattern.contains("\\")) {
                continue;
            }
            try {
                out.add(FileSystems.getDefault().getPathMatcher("glob:" + pattern));
            } catch (Exception ignore) {
                // 无效通配符直接忽略
            }
            if (out.size() >= 8) {
                break;
            }
        }
        return out;
    }

    public static long maxThumbSource() {
        return MAX_THUMB_SOURCE;
    }

    private Path existing(String virtualPath) throws IOException {
        Path target = resolve(virtualPath);
        if (!Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("文件或目录不存在");
        }
        Path realRoot = root.toRealPath();
        Path realTarget = target.toRealPath();
        if (!realTarget.startsWith(realRoot)) {
            throw new IllegalArgumentException("路径超出本地桌面目录");
        }
        return target;
    }

    private Path writable(String virtualPath) throws IOException {
        Path target = resolve(virtualPath);
        return writableChild(target.getParent(), target.getFileName() == null
                ? "" : target.getFileName().toString());
    }

    private Path writableChild(Path parent, String name) throws IOException {
        if (parent == null || !Files.isDirectory(parent)) {
            throw new IllegalArgumentException("上级目录不存在");
        }
        Path realRoot = root.toRealPath();
        if (!parent.toRealPath().startsWith(realRoot)) {
            throw new IllegalArgumentException("路径超出本地桌面目录");
        }
        Path target = parent.resolve(cleanName(name)).normalize();
        if (target.equals(root) || !target.startsWith(root)) {
            throw new IllegalArgumentException("路径超出本地桌面目录");
        }
        if (Files.isSymbolicLink(target)) {
            throw new IllegalArgumentException("不能修改符号链接");
        }
        return target;
    }

    private Path resolve(String virtualPath) throws IOException {
        String raw = virtualPath == null ? "/" : virtualPath.trim().replace('\\', '/');
        if (raw.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("路径不合法");
        }
        if (!raw.startsWith("/")) {
            raw = "/" + raw;
        }
        String rel = raw.replaceAll("^/+", "");
        Path target = root.resolve(rel).normalize();
        if (!target.startsWith(root)) {
            throw new IllegalArgumentException("路径超出本地桌面目录");
        }
        return target;
    }

    private void requireDirectory(Path path) {
        if (!Files.isDirectory(path)) {
            throw new IllegalArgumentException("目标不是目录");
        }
    }

    private void copyRecursive(Path src, Path target, int depth) throws IOException {
        if (depth > MAX_COPY_DEPTH) {
            throw new IllegalArgumentException("目录层级过深");
        }
        if (Files.isSymbolicLink(src)) {
            throw new IllegalArgumentException("暂不支持复制符号链接");
        }
        if (Files.isDirectory(src)) {
            Files.createDirectory(target);
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(src)) {
                for (Path child : stream) {
                    copyRecursive(child, target.resolve(child.getFileName().toString()), depth + 1);
                }
            }
            return;
        }
        Files.copy(src, target);
    }

    private Path uniqueTarget(Path dir, String name) {
        Path target = dir.resolve(name);
        if (!Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            return target;
        }
        String base = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0 && dot < name.length() - 1) {
            base = name.substring(0, dot);
            ext = name.substring(dot);
        }
        int n = 2;
        while (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            target = dir.resolve(base + " (" + n + ")" + ext);
            n++;
        }
        return target;
    }

    private static String cleanName(String raw) {
        String name = raw == null ? "" : raw.replace('\\', '/');
        int slash = name.lastIndexOf('/');
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        name = name.trim();
        if (name.isEmpty() || ".".equals(name) || "..".equals(name)
                || name.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("文件名不合法");
        }
        // Windows 下 : 会写入 NTFS 备用数据流，结尾的点 / 空格会被系统规范化后覆盖同名文件
        if (name.indexOf(':') >= 0) {
            throw new IllegalArgumentException("文件名不能包含冒号");
        }
        while (name.endsWith(".") || name.endsWith(" ")) {
            name = name.substring(0, name.length() - 1);
        }
        if (name.isEmpty()) {
            throw new IllegalArgumentException("文件名不合法");
        }
        String base = name;
        int dot = base.indexOf('.');
        if (dot >= 0) {
            base = base.substring(0, dot);
        }
        if (WINDOWS_RESERVED_NAMES.contains(base.trim().toUpperCase(Locale.ROOT))) {
            name = "_" + name;
        }
        return name;
    }

    private static String perms(BasicFileAttributes attrs) {
        if (attrs.isSymbolicLink()) {
            return "lrwxrwxrwx";
        }
        return attrs.isDirectory() ? "drwxr-xr-x" : "-rw-r--r--";
    }
}
