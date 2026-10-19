package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.LocalDownloadReq;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.annotation.PreDestroy;
import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;
import java.awt.Desktop;
import java.awt.GraphicsEnvironment;
import java.awt.Window;
import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 下载到本机目录：后端弹出原生目录选择框，自动创建子目录，后台通过 SFTP 直写本机文件。
 * 仅允许本机（loopback）访问，目录由服务端 token 绑定，客户端无法指定任意本地路径。
 */
@Slf4j
@Service
public class LocalDownloadService {

    private static final long PICK_TTL_MS = 10 * 60 * 1000L;
    private static final long TASK_TTL_MS = 2 * 60 * 60 * 1000L;
    private static final int MAX_NOTES = 50;

    private final SftpService sftp;
    private final AuditService audit;
    private final Map<String, PickedDir> pickedDirs = new ConcurrentHashMap<>();
    private final Map<String, DownloadTask> tasks = new ConcurrentHashMap<>();
    private final ExecutorService executor;
    private final boolean pickerAvailable;
    private final AtomicBoolean picking = new AtomicBoolean(false);

    public LocalDownloadService(SftpService sftp, AuditService audit) {
        this.sftp = sftp;
        this.audit = audit;
        this.pickerAvailable = detectPickerAvailable();
        this.executor = Executors.newSingleThreadExecutor(r -> {
            Thread thread = new Thread(r, "local-download");
            thread.setDaemon(true);
            return thread;
        });
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    public boolean isPickerAvailable() {
        return pickerAvailable;
    }

    private static boolean detectPickerAvailable() {
        if (GraphicsEnvironment.isHeadless()) {
            return false;
        }
        try {
            return !GraphicsEnvironment.getLocalGraphicsEnvironment().isHeadlessInstance();
        } catch (Throwable e) {
            // 无显示器 / 无可用 AWT 环境（如无 X11 的服务器）
            return false;
        }
    }

    /** 弹出本机目录选择框，返回一次性 token（客户端不能直接传本地路径） */
    public Map<String, Object> pickDirectory() {
        if (!pickerAvailable) {
            throw new IllegalStateException("当前运行环境没有图形界面，无法选择本机目录");
        }
        if (!picking.compareAndSet(false, true)) {
            throw new IllegalStateException("已有目录选择窗口正在打开");
        }
        try {
            cleanup();
            File selected = showDirectoryChooser();
            Map<String, Object> result = new LinkedHashMap<>();
            if (selected == null) {
                result.put("cancelled", true);
                return result;
            }
            File dir = selected.getAbsoluteFile();
            if (!dir.isDirectory()) {
                throw new IllegalArgumentException("请选择文件夹");
            }
            if (!dir.canWrite()) {
                throw new IllegalArgumentException("所选目录不可写：" + dir.getAbsolutePath());
            }
            String token = UUID.randomUUID().toString().replace("-", "");
            pickedDirs.put(token, new PickedDir(dir.toPath().toAbsolutePath().normalize(),
                    System.currentTimeMillis() + PICK_TTL_MS));
            result.put("token", token);
            result.put("path", dir.getAbsolutePath());
            return result;
        } finally {
            picking.set(false);
        }
    }

    /** 创建后台下载任务；立即返回任务快照 */
    public Map<String, Object> start(LocalDownloadReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        String token = req.getToken() == null ? "" : req.getToken().trim();
        PickedDir picked = token.isEmpty() ? null : pickedDirs.remove(token);
        if (picked == null || picked.expiresAt < System.currentTimeMillis()) {
            throw new IllegalArgumentException("目录选择已过期，请重新选择");
        }
        if (req.getSessionId() == null || req.getSessionId().trim().isEmpty()) {
            throw new IllegalArgumentException("会话未就绪");
        }
        String remoteDir = req.getDir() == null ? "" : req.getDir().trim();
        if (!remoteDir.startsWith("/") || remoteDir.contains("\n") || remoteDir.contains("\r")) {
            throw new IllegalArgumentException("目录不合法");
        }
        // 先校验远端路径，避免创建了本地目录才发现选择无效
        sftp.checkBundle(req.getSessionId(), remoteDir, req.getPaths());
        cleanup();
        String subDir = subDirName(remoteDir);
        Path target = createTargetDir(picked.dir, subDir);
        DownloadTask task = new DownloadTask(UUID.randomUUID().toString().replace("-", ""),
                req.getSessionId(), remoteDir, subDir, req.getPaths(), target);
        tasks.put(task.id, task);
        executor.submit(() -> runTask(task));
        return snapshot(task);
    }

    public Map<String, Object> getTask(String id) {
        cleanup();
        DownloadTask task = id == null ? null : tasks.get(id.trim());
        if (task == null) {
            throw new IllegalArgumentException("下载任务不存在或已过期");
        }
        return snapshot(task);
    }

    /** 终止进行中的本机下载：当前文件写完一个数据块后停止，已下载的文件保留 */
    public void cancelTask(String id) {
        DownloadTask task = id == null ? null : tasks.get(id.trim());
        if (task == null) {
            throw new IllegalArgumentException("下载任务不存在或已过期");
        }
        if ("done".equals(task.status) || "error".equals(task.status)
                || "cancelled".equals(task.status)) {
            return;
        }
        task.cancelled = true;
        task.status = "cancelled";
        task.currentFile = "";
        task.finishedAt = System.currentTimeMillis();
        recordAudit(task, "CANCELLED", "下载到本机：" + task.targetPath + "，用户已取消");
    }

    /** 在运行 DeepShell 的本机上打开下载目录 */
    public void openTarget(String id) {
        DownloadTask task = id == null ? null : tasks.get(id.trim());
        if (task == null) {
            throw new IllegalArgumentException("下载任务不存在或已过期");
        }
        if (!Files.isDirectory(task.targetPath)) {
            throw new IllegalArgumentException("目标目录不存在：" + task.targetPath);
        }
        if (GraphicsEnvironment.isHeadless() || !Desktop.isDesktopSupported()
                || !Desktop.getDesktop().isSupported(Desktop.Action.OPEN)) {
            throw new IllegalStateException("当前环境无法打开文件管理器");
        }
        try {
            Desktop.getDesktop().open(task.targetPath.toFile());
        } catch (Exception e) {
            throw new IllegalStateException("打开目录失败：" + displayError(e), e);
        }
    }

    private void runTask(DownloadTask task) {
        task.status = "scanning";
        SftpService.LocalDownloadPlan plan;
        try {
            plan = sftp.planLocalDownload(task.sessionId, task.remoteDir, task.paths);
        } catch (Exception e) {
            fail(task, e);
            return;
        }
        if (task.cancelled) {
            return;
        }
        task.totalFiles = plan.totalFiles;
        task.totalDirs = plan.totalDirs;
        task.totalBytes = plan.totalBytes;
        for (String warning : plan.warnings) {
            task.addError(warning);
        }
        task.status = "downloading";
        try {
            sftp.downloadLocalPlan(task.sessionId, plan, task.targetPath,
                    new SftpService.LocalDownloadProgress() {
                        @Override
                        public void onEntryStarted(String relativePath, long size) {
                            task.currentFile = relativePath;
                        }

                        @Override
                        public void onBytes(long delta) {
                            task.doneBytes += delta;
                        }

                        @Override
                        public void onFileDone(String relativePath, String localPath, long size) {
                            task.doneFiles++;
                        }

                        @Override
                        public void onFileFailed(String relativePath, String message) {
                            task.addError(relativePath + "：" + message);
                        }

                        @Override
                        public void onDirCreated(String relativePath, String localPath) {
                            // 目录进度不计入文件数
                        }

                        @Override
                        public void onDirFailed(String relativePath, String message) {
                            task.addError(relativePath + "：" + message);
                        }

                        @Override
                        public void onRenamed(String relativePath, String localName) {
                            task.addRenamed(relativePath, localName);
                        }

                        @Override
                        public boolean isCancelled() {
                            return task.cancelled;
                        }
                    });
            if (task.cancelled) {
                return;
            }
            task.status = "done";
            task.currentFile = "";
            task.finishedAt = System.currentTimeMillis();
            recordAudit(task, task.errorCount.get() == 0 ? "OK" : "PARTIAL",
                    "下载到本机：" + task.targetPath + "，成功 " + task.doneFiles + "/"
                            + task.totalFiles + (task.errorCount.get() > 0
                            ? "，失败 " + task.errorCount.get() : ""));
        } catch (Exception e) {
            if (task.cancelled || e instanceof InterruptedException) {
                task.status = "cancelled";
                task.currentFile = "";
                if (task.finishedAt == 0) {
                    task.finishedAt = System.currentTimeMillis();
                }
                return;
            }
            fail(task, e);
        }
    }

    private void fail(DownloadTask task, Exception e) {
        if (task.cancelled) {
            return;
        }
        task.status = "error";
        task.message = displayError(e);
        task.currentFile = "";
        task.finishedAt = System.currentTimeMillis();
        log.warn("本机下载任务失败 {} -> {}: {}", task.remoteDir, task.targetPath, task.message);
        recordAudit(task, "FAIL", "下载到本机：" + task.targetPath + "，失败：" + task.message);
    }

    private void recordAudit(DownloadTask task, String result, String detail) {
        try {
            audit.record("FILE_DOWNLOAD", task.remoteDir, result, detail);
        } catch (Exception e) {
            log.warn("记录本机下载审计日志失败: {}", e.getMessage());
        }
    }

    private static Map<String, Object> snapshot(DownloadTask task) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", task.id);
        result.put("status", task.status);
        result.put("remoteDir", task.remoteDir);
        result.put("subDir", task.subDir);
        result.put("targetPath", task.targetPath.toString());
        result.put("totalFiles", task.totalFiles);
        result.put("totalDirs", task.totalDirs);
        result.put("totalBytes", task.totalBytes);
        result.put("doneFiles", task.doneFiles);
        result.put("doneBytes", task.doneBytes);
        result.put("currentFile", task.currentFile);
        result.put("errorCount", task.errorCount.get());
        result.put("renamedCount", task.renamedCount.get());
        synchronized (task.errors) {
            result.put("errors", new ArrayList<>(task.errors));
        }
        synchronized (task.renamed) {
            result.put("renamed", new ArrayList<>(task.renamed));
        }
        result.put("message", task.message);
        result.put("startedAt", task.startedAt);
        result.put("finishedAt", task.finishedAt);
        return result;
    }

    private static String subDirName(String remoteDir) {
        String dir = remoteDir;
        while (dir.length() > 1 && dir.endsWith("/")) {
            dir = dir.substring(0, dir.length() - 1);
        }
        String base = dir.substring(dir.lastIndexOf('/') + 1);
        if (base.isEmpty()) {
            base = "root";
        }
        base = SftpService.safeLocalName(base);
        if (base.length() > 80) {
            base = base.substring(0, 80);
        }
        return "deepshell-" + base + "-"
                + new SimpleDateFormat("yyyyMMdd-HHmmss").format(new Date());
    }

    private static Path createTargetDir(Path base, String name) throws Exception {
        for (int i = 1; i <= 1000; i++) {
            Path target = base.resolve(i == 1 ? name : name + "-" + i);
            try {
                Files.createDirectory(target);
                return target;
            } catch (FileAlreadyExistsException ignore) {
                // 同一秒内重复下载：追加序号
            }
        }
        throw new IllegalStateException("同名下载目录过多，请清理后重试");
    }

    private void cleanup() {
        long now = System.currentTimeMillis();
        pickedDirs.entrySet().removeIf(e -> e.getValue().expiresAt < now);
        tasks.entrySet().removeIf(e -> e.getValue().finishedAt > 0
                && now - e.getValue().finishedAt > TASK_TTL_MS);
    }

    private static File showDirectoryChooser() {
        AtomicReference<File> selected = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        try {
            SwingUtilities.invokeAndWait(() -> {
                try {
                    UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
                } catch (Exception ignore) {
                    // 使用默认外观
                }
                JFrame owner = new JFrame();
                try {
                    owner.setUndecorated(true);
                    owner.setType(Window.Type.UTILITY);
                    owner.setSize(1, 1);
                    owner.setLocationRelativeTo(null);
                    owner.setAlwaysOnTop(true);
                    owner.setFocusableWindowState(false);
                    owner.setVisible(true);
                    JFileChooser chooser = new JFileChooser();
                    chooser.setDialogTitle("选择 DeepShell 下载目录");
                    chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
                    chooser.setAcceptAllFileFilterUsed(false);
                    chooser.setMultiSelectionEnabled(false);
                    chooser.setApproveButtonText("选择此目录");
                    File start = defaultStartDir();
                    if (start != null) {
                        chooser.setCurrentDirectory(start);
                    }
                    if (chooser.showOpenDialog(owner) == JFileChooser.APPROVE_OPTION) {
                        selected.set(chooser.getSelectedFile());
                    }
                } catch (Throwable t) {
                    failure.set(t);
                } finally {
                    owner.dispose();
                }
            });
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("目录选择被中断", e);
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            throw new IllegalStateException("无法打开目录选择框：" + displayError(cause), cause);
        }
        Throwable error = failure.get();
        if (error != null) {
            throw new IllegalStateException("无法打开目录选择框：" + displayError(error), error);
        }
        return selected.get();
    }

    private static File defaultStartDir() {
        String home = System.getProperty("user.home");
        if (home == null || home.trim().isEmpty()) {
            return null;
        }
        File downloads = new File(home, "Downloads");
        if (downloads.isDirectory()) {
            return downloads;
        }
        File desktop = new File(home, "Desktop");
        if (desktop.isDirectory()) {
            return desktop;
        }
        File homeDir = new File(home);
        return homeDir.isDirectory() ? homeDir : null;
    }

    private static String displayError(Throwable e) {
        String message = e.getMessage();
        return message == null || message.isEmpty() ? e.getClass().getSimpleName() : message;
    }

    private static final class PickedDir {
        final Path dir;
        final long expiresAt;

        PickedDir(Path dir, long expiresAt) {
            this.dir = dir;
            this.expiresAt = expiresAt;
        }
    }

    private static final class DownloadTask {
        final String id;
        final String sessionId;
        final String remoteDir;
        final String subDir;
        final List<String> paths;
        final Path targetPath;
        final long startedAt = System.currentTimeMillis();
        final List<String> errors = Collections.synchronizedList(new ArrayList<>());
        final List<String> renamed = Collections.synchronizedList(new ArrayList<>());
        final AtomicInteger errorCount = new AtomicInteger();
        final AtomicInteger renamedCount = new AtomicInteger();
        volatile String status = "queued";
        volatile int totalFiles;
        volatile int totalDirs;
        volatile long totalBytes;
        volatile int doneFiles;
        volatile long doneBytes;
        volatile String currentFile = "";
        volatile String message = "";
        volatile boolean cancelled;
        volatile long finishedAt;

        DownloadTask(String id, String sessionId, String remoteDir, String subDir,
                     List<String> paths, Path targetPath) {
            this.id = id;
            this.sessionId = sessionId;
            this.remoteDir = remoteDir;
            this.subDir = subDir;
            this.paths = paths;
            this.targetPath = targetPath;
        }

        void addError(String message) {
            int count = errorCount.incrementAndGet();
            if (count <= MAX_NOTES) {
                synchronized (errors) {
                    if (errors.size() < MAX_NOTES) {
                        errors.add(message);
                    }
                }
            }
        }

        void addRenamed(String relativePath, String localName) {
            int count = renamedCount.incrementAndGet();
            if (count <= MAX_NOTES) {
                synchronized (renamed) {
                    if (renamed.size() < MAX_NOTES) {
                        renamed.add(relativePath + " → " + localName);
                    }
                }
            }
        }
    }
}
