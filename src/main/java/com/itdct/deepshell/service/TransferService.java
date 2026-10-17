package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.PostConstruct;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 分片上传：浏览器按 4MB 分片写入数据目录下的临时文件，最后再通过 SFTP 一次性写入远端。
 * 网络抖动时可从服务端已收到的偏移继续上传；临时文件超过 24 小时未完成会被清理。
 */
@Slf4j
@Service
public class TransferService {

    public static final long MAX_UPLOAD_BYTES = 4L * 1024 * 1024 * 1024;
    private static final int MAX_RELATIVE_DEPTH = 32;
    private static final int MAX_RELATIVE_LENGTH = 1024;
    private static final long TEMP_TTL_MS = 24 * 60 * 60 * 1000L;

    private final SshSessionManager sessions;
    private final SftpService sftp;
    private final AuditService audit;
    private final Map<String, UploadTask> tasks = new ConcurrentHashMap<>();
    private Path uploadDir;

    public TransferService(SshSessionManager sessions, SftpService sftp, AuditService audit) {
        this.sessions = sessions;
        this.sftp = sftp;
        this.audit = audit;
    }

    @PostConstruct
    void init() throws Exception {
        uploadDir = DataDir.root().resolve("uploads");
        Files.createDirectories(uploadDir);
        cleanupTemps();
    }

    /** 开始或恢复一个上传任务；返回上传 id 与服务端已收到的字节数 */
    public Map<String, Object> init(String sessionId, String dirPath, String name,
                                    String relativePath, long size, String uploadId) throws Exception {
        if (sessionId == null || sessionId.trim().isEmpty()) {
            throw new IllegalArgumentException("缺少会话");
        }
        sessions.get(sessionId);
        if (dirPath == null || !dirPath.startsWith("/")) {
            throw new IllegalArgumentException("目标目录不合法");
        }
        String safeName = safeName(name);
        String relative = safeRelative(relativePath, safeName);
        if (size < 0 || size > MAX_UPLOAD_BYTES) {
            throw new IllegalArgumentException("文件大小超出限制");
        }

        UploadTask task = uploadId == null || uploadId.trim().isEmpty()
                ? null : tasks.get(uploadId.trim());
        if (task != null) {
            if (!task.sessionId.equals(sessionId) || !task.dir.equals(dirPath)
                    || !task.name.equals(safeName) || task.size != size) {
                throw new IllegalArgumentException("上传任务参数不一致，请重新开始");
            }
            long offset = Files.exists(task.temp) ? Files.size(task.temp) : 0L;
            task.currentSize = offset;
            return result(task, offset);
        }

        String id = UUID.randomUUID().toString().replace("-", "");
        Path temp = uploadDir.resolve(id + ".part");
        Files.deleteIfExists(temp);
        Files.createFile(temp);
        UploadTask created = new UploadTask(id, sessionId, dirPath, safeName, relative, size, temp);
        tasks.put(id, created);
        return result(created, 0L);
    }

    /** 写入一个分片；offset 小于已收到大小时视为重试，直接返回当前偏移 */
    public Map<String, Object> append(String uploadId, long offset, MultipartFile chunk) throws Exception {
        UploadTask task = requireTask(uploadId);
        if (chunk == null) {
            throw new IllegalArgumentException("缺少分片内容");
        }
        synchronized (task) {
            long current = Files.exists(task.temp) ? Files.size(task.temp) : 0L;
            if (offset > current) {
                throw new IllegalArgumentException("上传偏移不一致，请刷新后重试");
            }
            if (offset < current) {
                task.currentSize = current;
                return result(task, current);
            }
            if (current + chunk.getSize() > task.size) {
                throw new IllegalArgumentException("分片超出文件大小");
            }
            try (RandomAccessFile raf = new RandomAccessFile(task.temp.toFile(), "rw");
                 InputStream in = chunk.getInputStream()) {
                raf.seek(offset);
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    raf.write(buf, 0, n);
                }
            }
            task.currentSize = Files.size(task.temp);
            return result(task, task.currentSize);
        }
    }

    /** 所有分片到齐后，通过 SFTP 写入远端 */
    public Map<String, Object> complete(String uploadId) throws Exception {
        UploadTask task = requireTask(uploadId);
        long size;
        synchronized (task) {
            size = Files.exists(task.temp) ? Files.size(task.temp) : 0L;
            if (size != task.size) {
                throw new IllegalStateException("文件尚未上传完整（" + size + "/" + task.size + " 字节）");
            }
        }
        String target = join(task.dir, task.relativePath);
        try {
            sftp.putLocalFile(task.sessionId, task.dir, task.relativePath, task.temp);
            audit.record("FILE_UPLOAD", target, "OK", task.size + " bytes");
        } catch (Exception e) {
            audit.record("FILE_UPLOAD", target, "FAIL", e.getMessage());
            throw e;
        } finally {
            Files.deleteIfExists(task.temp);
            tasks.remove(task.id);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("path", target);
        result.put("size", task.size);
        result.put("name", task.name);
        return result;
    }

    public void abort(String uploadId) {
        UploadTask task = uploadId == null ? null : tasks.remove(uploadId.trim());
        if (task != null) {
            try {
                Files.deleteIfExists(task.temp);
            } catch (Exception ignore) {
                // 临时文件清理失败不阻塞前端
            }
        }
    }

    /** 清理超过 24 小时的未完成分片，避免数据目录无限增长 */
    private void cleanupTemps() {
        long now = System.currentTimeMillis();
        try (java.util.stream.Stream<Path> stream = Files.list(uploadDir)) {
            stream.forEach(path -> {
                try {
                    if (Files.isRegularFile(path)
                            && now - Files.getLastModifiedTime(path).toMillis() > TEMP_TTL_MS) {
                        Files.deleteIfExists(path);
                    }
                } catch (Exception ignore) {
                    // 忽略单个文件清理失败
                }
            });
        } catch (Exception e) {
            log.warn("清理上传临时文件失败: {}", e.getMessage());
        }
    }

    private UploadTask requireTask(String uploadId) {
        if (uploadId == null || uploadId.trim().isEmpty()) {
            throw new IllegalArgumentException("缺少上传任务");
        }
        UploadTask task = tasks.get(uploadId.trim());
        if (task == null) {
            throw new IllegalArgumentException("上传任务不存在或已过期，请重新上传");
        }
        return task;
    }

    private static Map<String, Object> result(UploadTask task, long offset) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("uploadId", task.id);
        result.put("offset", offset);
        result.put("size", task.size);
        result.put("name", task.name);
        return result;
    }

    private static String safeName(String name) {
        String value = name == null ? "" : name.trim();
        if (value.isEmpty() || value.length() > 255
                || value.contains("/") || value.contains("\\")
                || value.contains("..") || value.contains("\n") || value.contains("\r")) {
            throw new IllegalArgumentException("文件名不合法");
        }
        return value;
    }

    private static String safeRelative(String relativePath, String name) {
        String value = relativePath == null ? "" : relativePath.trim().replace('\\', '/');
        while (value.startsWith("/")) {
            value = value.substring(1);
        }
        if (value.isEmpty()) {
            value = name;
        }
        if (value.length() > MAX_RELATIVE_LENGTH) {
            throw new IllegalArgumentException("上传路径过长");
        }
        String[] parts = value.split("/");
        if (parts.length > MAX_RELATIVE_DEPTH) {
            throw new IllegalArgumentException("目录层级过深");
        }
        for (String part : parts) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)
                    || part.length() > 255 || part.contains("\n") || part.contains("\r")) {
                throw new IllegalArgumentException("上传路径不合法");
            }
        }
        return value;
    }

    private static String join(String dir, String rel) {
        if (dir.endsWith("/")) {
            return dir + rel;
        }
        return dir + "/" + rel;
    }

    private static final class UploadTask {
        final String id;
        final String sessionId;
        final String dir;
        final String name;
        final String relativePath;
        final long size;
        final Path temp;
        long currentSize;

        UploadTask(String id, String sessionId, String dir, String name,
                   String relativePath, long size, Path temp) {
            this.id = id;
            this.sessionId = sessionId;
            this.dir = dir;
            this.name = name;
            this.relativePath = relativePath;
            this.size = size;
            this.temp = temp;
        }
    }
}
