package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.dto.SftpEntry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

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
        if (file == null) {
            throw new IllegalArgumentException("上传文件不存在");
        }
        Path dir = existing(virtualDir);
        requireDirectory(dir);
        String name = cleanName(file.getOriginalFilename());
        Path target = writableChild(dir, name);
        try (InputStream in = file.getInputStream()) {
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public long fileSize(String virtualPath) throws IOException {
        Path file = existing(virtualPath);
        if (!Files.isRegularFile(file)) {
            throw new IllegalArgumentException("目标不是文件");
        }
        return Files.size(file);
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
        return name;
    }

    private static String perms(BasicFileAttributes attrs) {
        if (attrs.isSymbolicLink()) {
            return "lrwxrwxrwx";
        }
        return attrs.isDirectory() ? "drwxr-xr-x" : "-rw-r--r--";
    }
}
