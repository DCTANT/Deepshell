package com.itdct.deepshell.service;

import lombok.Getter;
import org.springframework.stereotype.Service;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 浏览器原生下载的进度跟踪：任务仅保存在内存中，供前端轮询显示进度与速度。
 * 任务在下载结束后保留一段时间，便于用户回看。
 */
@Service
public class DownloadTaskService {

    private static final int MAX_TASKS = 300;
    private static final long EXPIRE_MS = 30 * 60 * 1000L;

    @Getter
    public static class Task {
        private final String id;
        private final String name;
        private volatile long totalBytes;
        private volatile long doneBytes;
        private volatile String status = "downloading";
        private volatile String error;
        private final long startedAt = System.currentTimeMillis();
        private volatile long finishedAt;

        Task(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    private final Map<String, Task> tasks = new LinkedHashMap<>();

    public synchronized Task create(String name) {
        purgeExpired();
        Task t = new Task(UUID.randomUUID().toString().replace("-", "").substring(0, 12),
                name == null || name.trim().isEmpty() ? "下载" : name.trim());
        tasks.put(t.id, t);
        while (tasks.size() > MAX_TASKS) {
            Iterator<String> it = tasks.keySet().iterator();
            if (!it.hasNext()) {
                break;
            }
            it.next();
            it.remove();
        }
        return t;
    }

    public synchronized Task get(String id) {
        return id == null ? null : tasks.get(id);
    }

    /** 下载真正开始时由服务端补全总大小（单文件） */
    public void attach(String id, long totalBytes) {
        Task t = get(id);
        if (t != null) {
            t.totalBytes = Math.max(0, totalBytes);
        }
    }

    public void progress(String id, long doneBytes) {
        Task t = get(id);
        if (t != null && !isFinished(t.status)) {
            t.doneBytes = Math.max(0, doneBytes);
        }
    }

    /** 取消下载：写入端检测到后立即停止输出 */
    public void cancel(String id) {
        Task t = get(id);
        if (t != null && !isFinished(t.status)) {
            t.status = "cancelled";
            t.finishedAt = System.currentTimeMillis();
        }
    }

    public boolean isCancelled(String id) {
        Task t = get(id);
        return t != null && "cancelled".equals(t.status);
    }

    public void finish(String id) {
        Task t = get(id);
        if (t != null && !isFinished(t.status)) {
            if (t.totalBytes > 0) {
                t.doneBytes = t.totalBytes;
            }
            t.status = "done";
            t.finishedAt = System.currentTimeMillis();
        }
    }

    public void fail(String id, String message) {
        Task t = get(id);
        if (t != null && !isFinished(t.status)) {
            t.status = "error";
            t.error = message == null || message.trim().isEmpty() ? "下载失败" : message;
            t.finishedAt = System.currentTimeMillis();
        }
    }

    private static boolean isFinished(String status) {
        return "done".equals(status) || "error".equals(status) || "cancelled".equals(status);
    }

    private void purgeExpired() {
        long now = System.currentTimeMillis();
        Iterator<Map.Entry<String, Task>> it = tasks.entrySet().iterator();
        while (it.hasNext()) {
            Task t = it.next().getValue();
            boolean finished = isFinished(t.status);
            if (finished && t.finishedAt > 0 && now - t.finishedAt > EXPIRE_MS) {
                it.remove();
            }
        }
    }
}
