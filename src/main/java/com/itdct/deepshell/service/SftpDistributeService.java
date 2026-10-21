package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.entity.SshConnection;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.SftpException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * SFTP 批量分发：把浏览器选择的一批本地文件，上传到多台已保存服务器的同一目录。
 *
 * <p>文件先暂存在数据目录，再并行分发；优先复用已经打开的 SSH 会话，
 * 未连接的服务器按保存的代理 / 跳板机配置临时建连。任务保存在内存中，
 * 前端轮询获取每个目标的进度，支持取消与失败重试。</p>
 */
@Slf4j
@Service
public class SftpDistributeService {

    private static final int MAX_FILES = 500;
    private static final int MAX_TARGETS = 200;
    private static final int PARALLEL_TARGETS = 4;
    private static final long TASK_TTL_MS = 30 * 60 * 1000L;
    private static final int MAX_TASKS = 100;

    private final SshSessionManager sessions;
    private final ConnectionService connectionService;
    private final AuditService audit;
    private final SftpService sftp;

    private final Map<String, Task> tasks = new ConcurrentHashMap<>();
    private final ExecutorService pool = Executors.newFixedThreadPool(PARALLEL_TARGETS, r -> {
        Thread t = new Thread(r, "sftp-distribute");
        t.setDaemon(true);
        return t;
    });
    private final ScheduledExecutorService cleaner = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "sftp-distribute-cleaner");
        t.setDaemon(true);
        return t;
    });
    private Path root;
    private volatile boolean cleanerStarted;

    public SftpDistributeService(SshSessionManager sessions, ConnectionService connectionService,
                                 AuditService audit, SftpService sftp) {
        this.sessions = sessions;
        this.connectionService = connectionService;
        this.audit = audit;
        this.sftp = sftp;
    }

    @PostConstruct
    void init() throws Exception {
        initAt(DataDir.root().resolve("distribute"));
    }

    /** 测试或自定义数据目录 */
    void initAt(Path dir) throws Exception {
        this.root = dir;
        Files.createDirectories(root);
        cleanupOrphans();
        if (!cleanerStarted) {
            cleanerStarted = true;
            cleaner.scheduleWithFixedDelay(this::purge, 10, 10, TimeUnit.MINUTES);
        }
    }

    @PreDestroy
    void shutdown() {
        pool.shutdownNow();
        cleaner.shutdownNow();
    }

    /**
     * 暂存文件并立即开始分发；返回任务快照。
     * connectionIds 是有序的保存连接 id；targetPath 是远端目录（所有目标相同）。
     */
    public Map<String, Object> distribute(List<MultipartFile> files, List<Long> connectionIds,
                                          String targetPath) throws Exception {
        Task task = stage(files);
        try {
            return start(task, connectionIds, targetPath);
        } catch (Exception e) {
            cleanupDir(task.dir);
            tasks.remove(task.id, task);
            throw e;
        }
    }

    /**
     * 跨服务器传输：先把当前会话选中的远端文件暂存到本机，再复用批量分发任务
     * 并行上传到目标服务器。源文件保持不变。
     */
    public Map<String, Object> crossTransfer(String sourceSessionId, List<String> paths,
                                             List<Long> connectionIds, String targetPath)
            throws Exception {
        Task task = stageRemote(sourceSessionId, paths);
        try {
            Map<String, Object> out = start(task, connectionIds, targetPath);
            audit.record("FILE_CROSS_TRANSFER", targetPath, "OK",
                    task.files.size() + " 个文件，" + task.totalBytes + " 字节");
            return out;
        } catch (Exception e) {
            cleanupDir(task.dir);
            tasks.remove(task.id, task);
            throw e;
        }
    }

    public Map<String, Object> get(String taskId) {
        return snapshot(require(taskId));
    }

    public Map<String, Object> cancel(String taskId) {
        Task task = require(taskId);
        task.cancelled = true;
        List<SshSessionManager.SftpHandle> handles = new ArrayList<>();
        synchronized (task) {
            if (!isFinished(task.status)) {
                task.status = "cancelled";
                task.finishedAt = System.currentTimeMillis();
            }
            for (Target t : task.targets) {
                SshSessionManager.SftpHandle h = t.handle;
                if (h != null) {
                    handles.add(h);
                }
            }
        }
        // 关闭通道可以立即中断阻塞中的 put；目标线程随后会走 cancelled 分支
        for (SshSessionManager.SftpHandle h : handles) {
            try {
                h.close();
            } catch (Exception ignore) {
                // ignore
            }
        }
        return snapshot(task);
    }

    public Map<String, Object> retry(String taskId) {
        Task task = require(taskId);
        List<Target> retryables = new ArrayList<>();
        synchronized (task) {
            if (!"done".equals(task.status)) {
                throw new IllegalStateException("只有已结束的分发任务可以重试失败项");
            }
            for (Target t : task.targets) {
                if ("error".equals(t.status)) {
                    retryables.add(t);
                }
            }
            if (retryables.isEmpty()) {
                return snapshot(task);
            }
            for (Target t : retryables) {
                t.status = "pending";
                t.error = null;
                t.currentFile = "";
                t.fileIndex = 0;
                t.doneFiles = 0;
                t.doneBytes = 0;
                t.startedAt = 0;
                t.finishedAt = 0;
                t.handle = null;
            }
            task.cancelled = false;
            task.error = null;
            task.status = "running";
            task.finishedAt = 0;
            task.remaining.set(retryables.size());
        }
        for (Target t : retryables) {
            submit(task, t);
        }
        return snapshot(task);
    }

    private Map<String, Object> start(Task task, List<Long> connectionIds, String targetPath) {
        List<Long> ids = normalizeIds(connectionIds);
        if (ids.isEmpty()) {
            throw new IllegalArgumentException("请选择至少一台目标服务器");
        }
        String path = normalizeTargetPath(targetPath);
        Map<Long, SshConnection> saved = new HashMap<>();
        for (SshConnection c : connectionService.list()) {
            saved.put(c.getId(), c);
        }
        List<Target> targets = new ArrayList<>();
        for (Long id : ids) {
            SshConnection c = saved.get(id);
            if (c == null) {
                throw new IllegalArgumentException("连接不存在或已被删除: " + id);
            }
            targets.add(new Target(c, task.totalBytes));
        }
        synchronized (task) {
            task.targetPath = path;
            task.targets.clear();
            task.targets.addAll(targets);
            task.status = "running";
            task.startedAt = System.currentTimeMillis();
            task.remaining.set(targets.size());
        }
        for (Target t : targets) {
            submit(task, t);
        }
        return snapshot(task);
    }

    private void submit(Task task, Target target) {
        try {
            pool.execute(() -> runTarget(task, target));
        } catch (RejectedExecutionException e) {
            target.status = "error";
            target.error = "服务正在关闭，无法继续分发";
            completeTarget(task);
        }
    }

    private void runTarget(Task task, Target target) {
        if (task.cancelled) {
            target.status = "cancelled";
            target.finishedAt = System.currentTimeMillis();
            completeTarget(task);
            return;
        }
        target.status = "connecting";
        target.startedAt = System.currentTimeMillis();
        SshSessionManager.SftpHandle handle = null;
        try {
            handle = sessions.openSftp(target.connectionId);
            target.handle = handle;
            ensureDirectory(handle.getChannel(), task.targetPath);
            if (task.cancelled) {
                throw new IOException("分发已取消");
            }
            target.status = "uploading";
            for (int i = 0; i < task.files.size(); i++) {
                if (task.cancelled) {
                    throw new IOException("分发已取消");
                }
                DistFile file = task.files.get(i);
                target.currentFile = file.name;
                target.fileIndex = i + 1;
                long base = target.doneBytes;
                try (InputStream in = new ProgressInputStream(
                        Files.newInputStream(file.path), task, target, base)) {
                    handle.getChannel().put(in, joinRemote(task.targetPath, file.name),
                            ChannelSftp.OVERWRITE);
                }
                target.doneBytes = base + file.size;
                target.doneFiles++;
            }
            target.status = "done";
            target.finishedAt = System.currentTimeMillis();
            audit.record("FILE_DISTRIBUTE", target.name + " " + task.targetPath, "OK",
                    task.files.size() + " 个文件，" + task.totalBytes + " 字节");
        } catch (Exception e) {
            if (task.cancelled) {
                target.status = "cancelled";
            } else {
                target.status = "error";
                target.error = friendly(e);
                audit.record("FILE_DISTRIBUTE", target.name + " " + task.targetPath, "FAIL",
                        target.error);
            }
            target.finishedAt = System.currentTimeMillis();
        } finally {
            target.handle = null;
            if (handle != null) {
                try {
                    handle.close();
                } catch (Exception ignore) {
                    // ignore
                }
            }
            completeTarget(task);
        }
    }

    private void completeTarget(Task task) {
        if (task.remaining.decrementAndGet() != 0) {
            return;
        }
        boolean clean = false;
        synchronized (task) {
            task.finishedAt = System.currentTimeMillis();
            if (task.cancelled) {
                task.status = "cancelled";
                clean = true;
            } else {
                int failed = 0;
                for (Target t : task.targets) {
                    if ("error".equals(t.status)) {
                        failed++;
                    }
                }
                task.status = "done";
                if (failed > 0 && failed == task.targets.size()) {
                    task.error = "全部目标分发失败";
                }
                // 全部成功无需再重试，立即释放暂存文件；有失败则保留给「重试失败项」
                clean = failed == 0;
            }
        }
        if (clean) {
            cleanupDir(task.dir);
        }
    }

    private Task stage(List<MultipartFile> files) throws Exception {
        purge();
        if (files == null || files.isEmpty()) {
            throw new IllegalArgumentException("请选择要分发的文件");
        }
        int count = 0;
        for (MultipartFile f : files) {
            if (f != null) {
                count++;
            }
        }
        if (count == 0) {
            throw new IllegalArgumentException("请选择要分发的文件");
        }
        if (count > MAX_FILES) {
            throw new IllegalArgumentException("一次最多分发 " + MAX_FILES + " 个文件");
        }

        String id = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        Path dir = root.resolve(id);
        Files.createDirectories(dir);
        List<DistFile> list = new ArrayList<>();
        Set<String> names = new HashSet<>();
        long total = 0;
        try {
            for (MultipartFile f : files) {
                if (f == null) {
                    continue;
                }
                String name = safeName(f.getOriginalFilename());
                if (!names.add(name)) {
                    throw new IllegalArgumentException("存在同名文件：" + name);
                }
                Path dest = dir.resolve(name);
                try (InputStream in = f.getInputStream()) {
                    Files.copy(in, dest, StandardCopyOption.REPLACE_EXISTING);
                }
                long size = Files.size(dest);
                list.add(new DistFile(name, size, dest));
                total += size;
            }
        } catch (Exception e) {
            cleanupDir(dir);
            throw e;
        }
        Task task = new Task(id, dir, list, total);
        tasks.put(id, task);
        return task;
    }

    private Task stageRemote(String sourceSessionId, List<String> paths) throws Exception {
        purge();
        if (sourceSessionId == null || sourceSessionId.trim().isEmpty()) {
            throw new IllegalArgumentException("源会话不存在");
        }
        if (paths == null || paths.isEmpty()) {
            throw new IllegalArgumentException("请选择要传输的文件");
        }
        int count = 0;
        for (String p : paths) {
            if (p != null && !p.trim().isEmpty()) {
                count++;
            }
        }
        if (count == 0) {
            throw new IllegalArgumentException("请选择要传输的文件");
        }
        if (count > MAX_FILES) {
            throw new IllegalArgumentException("一次最多传输 " + MAX_FILES + " 个文件");
        }

        String id = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        Path dir = root.resolve(id);
        Files.createDirectories(dir);
        List<DistFile> list = new ArrayList<>();
        Set<String> names = new HashSet<>();
        long total = 0;
        try {
            for (String raw : paths) {
                if (raw == null || raw.trim().isEmpty()) {
                    continue;
                }
                String src = trimRemote(raw);
                if (!src.startsWith("/")) {
                    throw new IllegalArgumentException("源文件路径必须是绝对路径：" + src);
                }
                String name = src.substring(src.lastIndexOf('/') + 1);
                if (name.isEmpty()) {
                    throw new IllegalArgumentException("源文件路径不合法：" + src);
                }
                if (!names.add(name)) {
                    throw new IllegalArgumentException("选中文件中存在同名文件：" + name);
                }
                Path dest = dir.resolve("f" + list.size() + ".bin");
                try {
                    sftp.downloadToLocal(sourceSessionId, src, dest);
                } catch (Exception e) {
                    throw new IllegalArgumentException("无法读取源文件 " + src
                            + "：" + (e.getMessage() == null ? "读取失败" : e.getMessage()));
                }
                long size = Files.size(dest);
                list.add(new DistFile(name, size, dest));
                total += size;
            }
        } catch (Exception e) {
            cleanupDir(dir);
            throw e;
        }
        Task task = new Task(id, dir, list, total);
        tasks.put(id, task);
        return task;
    }

    private static String trimRemote(String path) {
        String s = path.trim();
        while (s.length() > 1 && s.endsWith("/")) {
            s = s.substring(0, s.length() - 1);
        }
        return s;
    }

    private Task require(String taskId) {
        Task task = taskId == null ? null : tasks.get(taskId);
        if (task == null) {
            throw new IllegalArgumentException("分发任务不存在或已过期");
        }
        return task;
    }

    private Map<String, Object> snapshot(Task task) {
        synchronized (task) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", task.id);
            r.put("status", task.status);
            r.put("targetPath", task.targetPath);
            r.put("error", task.error);
            r.put("createdAt", task.createdAt);
            r.put("startedAt", task.startedAt);
            r.put("finishedAt", task.finishedAt);
            r.put("fileTotalBytes", task.totalBytes);
            List<Map<String, Object>> files = new ArrayList<>();
            for (DistFile f : task.files) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("name", f.name);
                m.put("size", f.size);
                files.add(m);
            }
            r.put("files", files);

            List<Map<String, Object>> targets = new ArrayList<>();
            int doneTargets = 0;
            int failedTargets = 0;
            int cancelledTargets = 0;
            long doneBytes = 0;
            for (Target t : task.targets) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("connectionId", t.connectionId);
                m.put("name", t.name);
                m.put("host", t.host);
                m.put("port", t.port);
                m.put("username", t.username);
                m.put("status", t.status);
                m.put("error", t.error);
                m.put("currentFile", t.currentFile);
                m.put("fileIndex", t.fileIndex);
                m.put("fileCount", task.files.size());
                m.put("doneFiles", t.doneFiles);
                m.put("doneBytes", t.doneBytes);
                m.put("totalBytes", t.totalBytes);
                m.put("startedAt", t.startedAt);
                m.put("finishedAt", t.finishedAt);
                targets.add(m);
                doneBytes += t.doneBytes;
                if ("done".equals(t.status)) {
                    doneTargets++;
                } else if ("error".equals(t.status)) {
                    failedTargets++;
                } else if ("cancelled".equals(t.status)) {
                    cancelledTargets++;
                }
            }
            r.put("targets", targets);
            r.put("totalTargets", task.targets.size());
            r.put("doneTargets", doneTargets);
            r.put("failedTargets", failedTargets);
            r.put("cancelledTargets", cancelledTargets);
            r.put("doneBytes", doneBytes);
            r.put("totalBytes", task.totalBytes * task.targets.size());
            return r;
        }
    }

    private void purge() {
        long now = System.currentTimeMillis();
        List<Task> finished = new ArrayList<>();
        for (Task task : tasks.values()) {
            if (isFinished(task.status)) {
                if (task.finishedAt > 0 && now - task.finishedAt > TASK_TTL_MS) {
                    removeTask(task);
                } else {
                    finished.add(task);
                }
            }
        }
        if (tasks.size() <= MAX_TASKS) {
            return;
        }
        finished.sort(Comparator.comparingLong(t -> t.finishedAt));
        int remove = tasks.size() - MAX_TASKS;
        for (int i = 0; i < finished.size() && i < remove; i++) {
            removeTask(finished.get(i));
        }
    }

    private void removeTask(Task task) {
        tasks.remove(task.id, task);
        cleanupDir(task.dir);
    }

    private void cleanupOrphans() {
        try (java.util.stream.Stream<Path> stream = Files.list(root)) {
            stream.forEach(this::cleanupDir);
        } catch (Exception e) {
            log.warn("清理批量分发临时目录失败: {}", e.getMessage());
        }
    }

    private void cleanupDir(Path dir) {
        if (dir == null) {
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

    private static boolean isFinished(String status) {
        return "done".equals(status) || "cancelled".equals(status) || "error".equals(status);
    }

    private static List<Long> normalizeIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            throw new IllegalArgumentException("请选择至少一台目标服务器");
        }
        LinkedHashSet<Long> unique = new LinkedHashSet<>();
        for (Long id : ids) {
            if (id != null) {
                unique.add(id);
            }
        }
        if (unique.isEmpty()) {
            throw new IllegalArgumentException("请选择至少一台目标服务器");
        }
        if (unique.size() > MAX_TARGETS) {
            throw new IllegalArgumentException("一次最多分发到 " + MAX_TARGETS + " 台服务器");
        }
        return new ArrayList<>(unique);
    }

    private static String normalizeTargetPath(String targetPath) {
        String raw = targetPath == null ? "" : targetPath.trim();
        if (raw.isEmpty()) {
            throw new IllegalArgumentException("请填写目标目录");
        }
        if (raw.indexOf('\\') >= 0) {
            throw new IllegalArgumentException("目标目录请使用 / 分隔");
        }
        if (!raw.startsWith("/")) {
            throw new IllegalArgumentException("目标目录必须是绝对路径，例如 /opt/app");
        }
        if (raw.length() > 4096) {
            throw new IllegalArgumentException("目标目录过长");
        }
        StringBuilder sb = new StringBuilder();
        for (String part : raw.split("/")) {
            if (part.isEmpty()) {
                continue;
            }
            if (".".equals(part) || "..".equals(part)) {
                throw new IllegalArgumentException("目标目录不能包含 . 或 ..");
            }
            sb.append('/').append(part);
        }
        return sb.length() == 0 ? "/" : sb.toString();
    }

    private static String safeName(String original) {
        String raw = original == null ? "" : original.replace('\\', '/');
        int slash = raw.lastIndexOf('/');
        if (slash >= 0) {
            raw = raw.substring(slash + 1);
        }
        if (raw.trim().isEmpty() || ".".equals(raw) || "..".equals(raw)
                || raw.length() > 255
                || raw.indexOf('\0') >= 0 || raw.indexOf('\n') >= 0 || raw.indexOf('\r') >= 0) {
            throw new IllegalArgumentException("文件名不合法: " + original);
        }
        return raw;
    }

    private static String joinRemote(String dir, String name) {
        if ("/".equals(dir)) {
            return "/" + name;
        }
        return dir + "/" + name;
    }

    /** 逐级创建远端目录，已存在则跳过 */
    private static void ensureDirectory(ChannelSftp channel, String dir) throws SftpException {
        if (dir == null || dir.isEmpty() || "/".equals(dir)) {
            return;
        }
        StringBuilder current = new StringBuilder();
        for (String part : dir.split("/")) {
            if (part.isEmpty()) {
                continue;
            }
            current.append('/').append(part);
            String path = current.toString();
            try {
                channel.stat(path);
            } catch (SftpException e) {
                if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                    try {
                        channel.mkdir(path);
                    } catch (SftpException mkdirError) {
                        // 并发创建或权限问题：再确认一次
                        channel.stat(path);
                    }
                } else {
                    throw e;
                }
            }
        }
    }

    private static String friendly(Exception e) {
        if (e instanceof HostKeyCheckException) {
            return "主机指纹未信任或已变更，请先在终端连接一次该服务器并确认指纹";
        }
        if (e instanceof SftpException) {
            SftpException se = (SftpException) e;
            if (se.id == ChannelSftp.SSH_FX_PERMISSION_DENIED) {
                return "权限不足，无法写入目标目录";
            }
            String msg = se.getMessage() == null ? "" : se.getMessage();
            return "SFTP 错误: " + (msg.isEmpty() ? "操作失败" : msg);
        }
        if (e instanceof JSchException) {
            String raw = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
            if (raw.contains("auth fail") || raw.contains("auth cancel")) {
                return "认证失败：用户名、密码或私钥不正确";
            }
            if (raw.contains("connection refused")) {
                return "连接被拒绝：请检查端口与 SSH 服务是否开启";
            }
            if (raw.contains("timeout") || raw.contains("timed out")) {
                return "连接超时：请检查主机地址、端口与网络";
            }
            if (raw.contains("unknownhost") || raw.contains("name or service not known")) {
                return "无法解析主机地址";
            }
            if (raw.contains("session is down")) {
                return "SSH 会话已断开";
            }
        }
        if (e instanceof IOException && "分发已取消".equals(e.getMessage())) {
            return "已取消";
        }
        String msg = e.getMessage();
        if (msg == null || msg.trim().isEmpty()) {
            msg = e.getClass().getSimpleName();
        }
        return msg;
    }

    private static class DistFile {
        final String name;
        final long size;
        final Path path;

        DistFile(String name, long size, Path path) {
            this.name = name;
            this.size = size;
            this.path = path;
        }
    }

    private static class Target {
        final Long connectionId;
        final String name;
        final String host;
        final int port;
        final String username;
        final long totalBytes;
        volatile String status = "pending";
        volatile String error;
        volatile String currentFile = "";
        volatile int fileIndex;
        volatile int doneFiles;
        volatile long doneBytes;
        volatile long startedAt;
        volatile long finishedAt;
        volatile SshSessionManager.SftpHandle handle;

        Target(SshConnection c, long totalBytes) {
            this.connectionId = c.getId();
            this.name = c.getName();
            this.host = c.getHost();
            this.port = c.getPort() == null ? 22 : c.getPort();
            this.username = c.getUsername();
            this.totalBytes = totalBytes;
        }
    }

    private static class Task {
        final String id;
        final Path dir;
        final List<DistFile> files;
        final long totalBytes;
        final long createdAt = System.currentTimeMillis();
        final List<Target> targets = new ArrayList<>();
        final AtomicInteger remaining = new AtomicInteger();
        volatile String status = "created";
        volatile String targetPath = "";
        volatile String error;
        volatile long startedAt;
        volatile long finishedAt;
        volatile boolean cancelled;

        Task(String id, Path dir, List<DistFile> files, long totalBytes) {
            this.id = id;
            this.dir = dir;
            this.files = Collections.unmodifiableList(files);
            this.totalBytes = totalBytes;
        }
    }

    /** 统计实际读出的字节数，用于实时进度和取消 */
    private static class ProgressInputStream extends FilterInputStream {
        private final Task task;
        private final Target target;
        private final long base;
        private long count;

        ProgressInputStream(InputStream in, Task task, Target target, long base) {
            super(in);
            this.task = task;
            this.target = target;
            this.base = base;
        }

        @Override
        public int read() throws IOException {
            checkCancelled();
            int b = super.read();
            if (b >= 0) {
                count++;
                target.doneBytes = base + count;
            }
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            checkCancelled();
            int n = super.read(b, off, len);
            if (n > 0) {
                count += n;
                target.doneBytes = base + count;
            }
            return n;
        }

        private void checkCancelled() throws IOException {
            if (task.cancelled) {
                throw new IOException("分发已取消");
            }
        }
    }
}
