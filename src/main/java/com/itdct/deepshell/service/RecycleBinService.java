package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.dto.TrashDeleteResult;
import com.itdct.deepshell.dto.TrashItem;
import com.itdct.deepshell.dto.TrashDeleteReq;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 远端回收站：文件先移动到用户主目录下的 .recycle-bin，目录和索引均为惰性创建。
 */
@Slf4j
@Service
public class RecycleBinService {

    private static final String TRASH_NAME = ".recycle-bin";
    private static final String INDEX_NAME = ".index.json";
    private static final int MAX_ITEMS = 1000;

    private final SftpService sftp;
    private final AuditService audit;
    private final ObjectMapper mapper;
    private final Map<String, Object> locks = new ConcurrentHashMap<>();

    public RecycleBinService(SftpService sftp, AuditService audit, ObjectMapper mapper) {
        this.sftp = sftp;
        this.audit = audit;
        this.mapper = mapper;
    }

    public List<TrashItem> list(String sessionId) throws Exception {
        synchronized (lock(sessionId)) {
            String root = trashRoot(sessionId);
            if (!sftp.exists(sessionId, root)) {
                return new ArrayList<>();
            }
            Index index = loadIndex(sessionId, root);
            boolean changed = false;
            for (Iterator<TrashItem> it = index.items.iterator(); it.hasNext(); ) {
                TrashItem item = it.next();
                if (item.getStoredPath() == null
                        || !sftp.exists(sessionId, item.getStoredPath())) {
                    it.remove();
                    changed = true;
                }
            }
            if (changed) {
                saveIndex(sessionId, root, index);
            }
            List<TrashItem> out = new ArrayList<>(index.items);
            out.sort(Comparator.comparingLong(TrashItem::getDeletedAt).reversed());
            return out;
        }
    }

    public List<TrashDeleteResult> delete(String sessionId, List<TrashDeleteReq.Item> items)
            throws Exception {
        if (items == null || items.isEmpty()) {
            throw new IllegalArgumentException("请选择要删除的文件");
        }
        synchronized (lock(sessionId)) {
            String root = trashRoot(sessionId);
            boolean rootExisted = sftp.exists(sessionId, root);
            if (!rootExisted) {
                sftp.mkdirs(sessionId, root);
            }
            Index index = loadIndex(sessionId, root);
            List<TrashDeleteResult> results = new ArrayList<>();
            int ok = 0;
            for (TrashDeleteReq.Item item : items) {
                String src = trimTrailingSlash(item == null ? null : item.getPath());
                if (src == null || src.isEmpty() || !src.startsWith("/")) {
                    results.add(new TrashDeleteResult(item == null ? "" : item.getPath(),
                            false, "路径不合法"));
                    continue;
                }
                if ("/".equals(src) || src.equals(root) || root.startsWith(src + "/")) {
                    results.add(new TrashDeleteResult(src, false,
                            "不能删除回收站自身或其上级目录"));
                    continue;
                }
                if (index.items.size() >= MAX_ITEMS) {
                    results.add(new TrashDeleteResult(src, false,
                            "回收站项目过多，请先清空回收站"));
                    continue;
                }
                if (!sftp.exists(sessionId, src)) {
                    results.add(new TrashDeleteResult(src, false, "文件不存在或已被移动"));
                    continue;
                }
                String name = item.getName() == null || item.getName().trim().isEmpty()
                        ? baseName(src) : item.getName().trim();
                String stored = join(root, newId() + "__" + safeName(name));
                try {
                    sftp.renameAbsolute(sessionId, src, stored);
                    TrashItem trashed = new TrashItem();
                    trashed.setId(newId());
                    trashed.setName(name);
                    trashed.setOriginalPath(src);
                    trashed.setStoredPath(stored);
                    trashed.setDeletedAt(System.currentTimeMillis());
                    trashed.setDir(item.isDir());
                    trashed.setSize(item.getSize());
                    index.items.add(trashed);
                    results.add(new TrashDeleteResult(src, true, null));
                    audit.record("FILE_TRASH", src, "OK", "移入回收站");
                    ok++;
                } catch (Exception e) {
                    log.debug("移入回收站失败 {}: {}", src, e.getMessage());
                    results.add(new TrashDeleteResult(src, false,
                            "无法移入回收站（跨文件系统或权限不足），可改用 Shift+Delete 彻底删除"));
                }
            }
            if (ok > 0) {
                saveIndex(sessionId, root, index);
            } else if (!rootExisted && sftp.exists(sessionId, root)) {
                // 首次删除全部失败时，不留下空目录
                try {
                    sftp.delete(sessionId, root);
                } catch (Exception ignore) {
                    // ignore
                }
            }
            return results;
        }
    }

    public Map<String, Object> restore(String sessionId, String id) throws Exception {
        if (id == null || id.trim().isEmpty()) {
            throw new IllegalArgumentException("缺少回收站项目");
        }
        synchronized (lock(sessionId)) {
            String root = trashRoot(sessionId);
            Index index = loadIndex(sessionId, root);
            TrashItem item = null;
            for (TrashItem it : index.items) {
                if (id.equals(it.getId())) {
                    item = it;
                    break;
                }
            }
            if (item == null) {
                throw new IllegalArgumentException("回收站项目不存在或已恢复");
            }
            if (!sftp.exists(sessionId, item.getStoredPath())) {
                index.items.remove(item);
                saveIndex(sessionId, root, index);
                throw new IllegalArgumentException("文件已不在回收站中");
            }
            String target = item.getOriginalPath();
            if (target == null || target.trim().isEmpty()) {
                throw new IllegalArgumentException("原路径缺失，无法恢复");
            }
            if (sftp.exists(sessionId, target)) {
                target = uniqueRestorePath(sessionId, target, item.isDir());
            }
            String parent = parentOf(target);
            if (parent != null && !parent.isEmpty()) {
                sftp.mkdirs(sessionId, parent);
            }
            sftp.renameAbsolute(sessionId, item.getStoredPath(), target);
            index.items.remove(item);
            saveIndex(sessionId, root, index);
            audit.record("FILE_TRASH_RESTORE", target, "OK", "从回收站恢复");
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", id);
            out.put("path", target);
            return out;
        }
    }

    public Map<String, Object> purge(String sessionId, List<String> ids) throws Exception {
        if (ids == null || ids.isEmpty()) {
            throw new IllegalArgumentException("请选择要彻底删除的项目");
        }
        synchronized (lock(sessionId)) {
            String root = trashRoot(sessionId);
            Index index = loadIndex(sessionId, root);
            int deleted = 0;
            int failed = 0;
            for (String id : ids) {
                TrashItem item = null;
                for (TrashItem it : index.items) {
                    if (id != null && id.equals(it.getId())) {
                        item = it;
                        break;
                    }
                }
                if (item == null) {
                    continue;
                }
                try {
                    if (sftp.exists(sessionId, item.getStoredPath())) {
                        sftp.delete(sessionId, item.getStoredPath());
                    }
                    index.items.remove(item);
                    deleted++;
                    audit.record("FILE_TRASH_PURGE", item.getOriginalPath(), "OK", "彻底删除");
                } catch (Exception e) {
                    failed++;
                    log.debug("彻底删除回收站项目失败 {}: {}", item.getStoredPath(), e.getMessage());
                }
            }
            saveIndex(sessionId, root, index);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("deleted", deleted);
            out.put("failed", failed);
            return out;
        }
    }

    public Map<String, Object> empty(String sessionId) throws Exception {
        synchronized (lock(sessionId)) {
            String root = trashRoot(sessionId);
            if (!sftp.exists(sessionId, root)) {
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("deleted", 0);
                return out;
            }
            Index index = loadIndex(sessionId, root);
            int count = index.items.size();
            sftp.delete(sessionId, root);
            audit.record("FILE_TRASH_EMPTY", root, "OK", "清空回收站，共 " + count + " 项");
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("deleted", count);
            return out;
        }
    }

    private Index loadIndex(String sessionId, String root) throws Exception {
        String path = join(root, INDEX_NAME);
        if (!sftp.exists(sessionId, path)) {
            return new Index();
        }
        String json = sftp.readText(sessionId, path);
        if (json == null || json.trim().isEmpty()) {
            return new Index();
        }
        try {
            Index index = mapper.readValue(json, Index.class);
            if (index.items == null) {
                index.items = new ArrayList<>();
            }
            return index;
        } catch (Exception e) {
            throw new IllegalStateException("回收站索引损坏，无法读取");
        }
    }

    private void saveIndex(String sessionId, String root, Index index) throws Exception {
        sftp.mkdirs(sessionId, root);
        sftp.writeText(sessionId, join(root, INDEX_NAME), mapper.writeValueAsString(index));
    }

    private String uniqueRestorePath(String sessionId, String target, boolean dir)
            throws Exception {
        String parent = parentOf(target);
        String name = baseName(target);
        String base = name;
        String ext = "";
        if (!dir) {
            int dot = name.lastIndexOf('.');
            if (dot > 0 && dot < name.length() - 1) {
                base = name.substring(0, dot);
                ext = name.substring(dot);
            }
        }
        String candidate = join(parent, base + " - 恢复" + ext);
        if (!sftp.exists(sessionId, candidate)) {
            return candidate;
        }
        for (int i = 2; i <= 1000; i++) {
            candidate = join(parent, base + " - 恢复 (" + i + ")" + ext);
            if (!sftp.exists(sessionId, candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("同名文件过多，无法生成恢复名称");
    }

    private String trashRoot(String sessionId) throws Exception {
        return join(sftp.home(sessionId), TRASH_NAME);
    }

    private Object lock(String sessionId) {
        String key = sessionId == null ? "" : sessionId;
        return locks.computeIfAbsent(key, k -> new Object());
    }

    private static String newId() {
        return Long.toHexString(System.currentTimeMillis())
                + UUID.randomUUID().toString().replace("-", "").substring(0, 6);
    }

    private static String safeName(String name) {
        String s = name == null ? "" : name.replace("/", "_").replace("\\", "_").trim();
        return s.isEmpty() ? "item" : s;
    }

    private static String join(String parent, String name) {
        String p = trimTrailingSlash(parent);
        if (p == null || p.isEmpty()) {
            return "/" + name;
        }
        return "/".equals(p) ? "/" + name : p + "/" + name;
    }

    private static String parentOf(String path) {
        String p = trimTrailingSlash(path);
        if (p == null || "/".equals(p)) {
            return "/";
        }
        int i = p.lastIndexOf('/');
        return i <= 0 ? "/" : p.substring(0, i);
    }

    private static String baseName(String path) {
        String p = trimTrailingSlash(path);
        if (p == null || p.isEmpty() || "/".equals(p)) {
            return "";
        }
        return p.substring(p.lastIndexOf('/') + 1);
    }

    private static String trimTrailingSlash(String path) {
        if (path == null) {
            return null;
        }
        String s = path.trim();
        while (s.length() > 1 && s.endsWith("/")) {
            s = s.substring(0, s.length() - 1);
        }
        return s;
    }

    @Data
    public static class Index {
        private int version = 1;
        private List<TrashItem> items = new ArrayList<>();
    }
}
