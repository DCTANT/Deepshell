package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.SftpEntry;
import com.itdct.deepshell.dto.TrashDeleteReq;
import com.itdct.deepshell.dto.TrashDeleteResult;
import com.itdct.deepshell.dto.TrashItem;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 远端回收站：遵循 freedesktop.org 的 Trash 规范，落在用户主目录的
 * {@code .local/share/Trash}：{@code files/} 存放文件本体，{@code info/} 存放同名的
 * {@code .trashinfo} 元数据（原路径与删除时间）。与 GNOME / KDE 等桌面共用同一份回收站，
 * 双方删掉的文件可以互相看到并还原。
 */
@Slf4j
@Service
public class RecycleBinService {

    /** 回收站根目录，相对用户主目录（freedesktop.org Trash 规范） */
    private static final String TRASH_DIR = ".local/share/Trash";
    private static final String FILES_DIR = "files";
    private static final String INFO_DIR = "info";
    private static final String INFO_SUFFIX = ".trashinfo";
    private static final String INFO_HEADER = "[Trash Info]";
    private static final DateTimeFormatter DELETED_AT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
    private static final int MAX_ITEMS = 1000;
    private static final int MAX_ID_LENGTH = 255;

    private final SftpService sftp;
    private final AuditService audit;
    private final Map<String, Object> locks = new ConcurrentHashMap<>();

    public RecycleBinService(SftpService sftp, AuditService audit) {
        this.sftp = sftp;
        this.audit = audit;
    }

    public List<TrashItem> list(String sessionId) throws Exception {
        synchronized (lock(sessionId)) {
            String root = trashRoot(sessionId);
            String filesDir = join(root, FILES_DIR);
            String infoDir = join(root, INFO_DIR);
            if (!sftp.exists(sessionId, infoDir)) {
                return new ArrayList<>();
            }
            Map<String, SftpEntry> payloads = new HashMap<>();
            for (SftpEntry entry : safeList(sessionId, filesDir)) {
                payloads.put(entry.getName(), entry);
            }
            List<TrashItem> items = new ArrayList<>();
            List<String> stale = new ArrayList<>();
            for (SftpEntry entry : safeList(sessionId, infoDir)) {
                String id = stripInfoSuffix(entry.getName());
                if (id == null) {
                    continue;
                }
                SftpEntry payload = payloads.get(id);
                TrashInfo info = payload == null ? null
                        : readInfo(sessionId, join(infoDir, entry.getName()));
                if (info == null || info.path == null || info.path.isEmpty()) {
                    stale.add(entry.getName());
                    continue;
                }
                TrashItem item = new TrashItem();
                item.setId(id);
                item.setName(baseName(info.path));
                item.setOriginalPath(info.path);
                item.setStoredPath(join(filesDir, id));
                item.setDeletedAt(info.deletedAt > 0 ? info.deletedAt : payload.getMtime());
                item.setDir(payload.isDir());
                item.setSize(payload.getSize());
                items.add(item);
            }
            // 文件本体已经不在的 trashinfo 属于残留元数据，顺手清掉
            for (String name : stale) {
                deleteQuietly(sessionId, join(infoDir, name));
            }
            items.sort(Comparator.comparingLong(TrashItem::getDeletedAt).reversed()
                    .thenComparing(TrashItem::getName));
            return items;
        }
    }

    public List<TrashDeleteResult> delete(String sessionId, List<TrashDeleteReq.Item> items)
            throws Exception {
        if (items == null || items.isEmpty()) {
            throw new IllegalArgumentException("请选择要删除的文件");
        }
        synchronized (lock(sessionId)) {
            String root = trashRoot(sessionId);
            String filesDir = join(root, FILES_DIR);
            String infoDir = join(root, INFO_DIR);
            int existing = countInfo(sessionId, infoDir);
            List<TrashDeleteResult> results = new ArrayList<>();
            boolean prepared = false;
            int stored = 0;
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
                if (src.startsWith(root + "/")) {
                    results.add(new TrashDeleteResult(src, false,
                            "回收站内的文件不能再次移入回收站"));
                    continue;
                }
                if (existing + stored >= MAX_ITEMS) {
                    results.add(new TrashDeleteResult(src, false,
                            "回收站项目过多，请先清空回收站"));
                    continue;
                }
                if (!sftp.exists(sessionId, src)) {
                    results.add(new TrashDeleteResult(src, false, "文件不存在或已被移动"));
                    continue;
                }
                if (!prepared) {
                    sftp.mkdirs(sessionId, filesDir);
                    sftp.mkdirs(sessionId, infoDir);
                    prepared = true;
                }
                String name = item.getName() == null || item.getName().trim().isEmpty()
                        ? baseName(src) : item.getName().trim();
                String storedName = newId() + "__" + safeName(name);
                String dest = join(filesDir, storedName);
                try {
                    sftp.renameAbsolute(sessionId, src, dest);
                } catch (Exception e) {
                    log.debug("移入回收站失败 {}: {}", src, e.getMessage());
                    results.add(new TrashDeleteResult(src, false,
                            "无法移入回收站（跨分区或权限不足），可改用 Shift+Delete 彻底删除"));
                    continue;
                }
                try {
                    sftp.writeText(sessionId, join(infoDir, storedName + INFO_SUFFIX),
                            infoContent(src));
                } catch (Exception e) {
                    // 元数据写不进去就回滚，避免 files/ 里留下无法还原的孤儿文件
                    log.debug("写入回收站元数据失败 {}: {}", src, e.getMessage());
                    try {
                        sftp.renameAbsolute(sessionId, dest, src);
                    } catch (Exception rollback) {
                        log.warn("回收站回滚失败，文件当前位于 {}: {}",
                                dest, rollback.getMessage());
                    }
                    results.add(new TrashDeleteResult(src, false, "写入回收站信息失败，已取消删除"));
                    continue;
                }
                results.add(new TrashDeleteResult(src, true, null));
                audit.record("FILE_TRASH", src, "OK", "移入回收站");
                stored++;
            }
            return results;
        }
    }

    public Map<String, Object> restore(String sessionId, String id) throws Exception {
        checkId(id);
        synchronized (lock(sessionId)) {
            String root = trashRoot(sessionId);
            String filesDir = join(root, FILES_DIR);
            String infoDir = join(root, INFO_DIR);
            String stored = join(filesDir, id);
            String infoPath = join(infoDir, id + INFO_SUFFIX);
            TrashInfo info = sftp.exists(sessionId, infoPath) ? readInfo(sessionId, infoPath) : null;
            if (!sftp.exists(sessionId, stored)) {
                deleteQuietly(sessionId, infoPath);
                throw new IllegalArgumentException("文件已不在回收站中");
            }
            String target = info == null ? null : trimTrailingSlash(info.path);
            if (target == null || target.isEmpty() || !target.startsWith("/")) {
                throw new IllegalArgumentException("原路径缺失，无法恢复");
            }
            if (target.equals(root) || target.startsWith(root + "/")) {
                throw new IllegalArgumentException("原路径不合法，无法恢复");
            }
            boolean dir = false;
            for (SftpEntry entry : safeList(sessionId, filesDir)) {
                if (id.equals(entry.getName())) {
                    dir = entry.isDir();
                    break;
                }
            }
            if (sftp.exists(sessionId, target)) {
                target = uniqueRestorePath(sessionId, target, dir);
            }
            String parent = parentOf(target);
            if (parent != null && !parent.isEmpty()) {
                sftp.mkdirs(sessionId, parent);
            }
            sftp.renameAbsolute(sessionId, stored, target);
            deleteQuietly(sessionId, infoPath);
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
            String filesDir = join(root, FILES_DIR);
            String infoDir = join(root, INFO_DIR);
            int deleted = 0;
            int failed = 0;
            for (String id : ids) {
                if (id == null || id.isEmpty() || id.contains("/") || id.contains("\\")
                        || id.length() > MAX_ID_LENGTH) {
                    continue;
                }
                String stored = join(filesDir, id);
                try {
                    boolean existed = false;
                    if (sftp.exists(sessionId, stored)) {
                        sftp.delete(sessionId, stored);
                        existed = true;
                    }
                    String infoPath = join(infoDir, id + INFO_SUFFIX);
                    if (sftp.exists(sessionId, infoPath)) {
                        sftp.delete(sessionId, infoPath);
                        existed = true;
                    }
                    if (existed) {
                        deleted++;
                        audit.record("FILE_TRASH_PURGE", stored, "OK", "彻底删除");
                    }
                } catch (Exception e) {
                    failed++;
                    log.debug("彻底删除回收站项目失败 {}: {}", stored, e.getMessage());
                }
            }
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
            int count = countInfo(sessionId, join(root, INFO_DIR));
            sftp.delete(sessionId, root);
            audit.record("FILE_TRASH_EMPTY", root, "OK", "清空回收站，共 " + count + " 项");
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("deleted", count);
            return out;
        }
    }

    private List<SftpEntry> safeList(String sessionId, String dir) {
        try {
            if (!sftp.exists(sessionId, dir)) {
                return new ArrayList<>();
            }
            return sftp.list(sessionId, dir);
        } catch (Exception e) {
            log.debug("读取回收站目录失败 {}: {}", dir, e.getMessage());
            return new ArrayList<>();
        }
    }

    private int countInfo(String sessionId, String infoDir) {
        int n = 0;
        for (SftpEntry entry : safeList(sessionId, infoDir)) {
            if (stripInfoSuffix(entry.getName()) != null) {
                n++;
            }
        }
        return n;
    }

    private TrashInfo readInfo(String sessionId, String path) {
        String text;
        try {
            text = sftp.readText(sessionId, path);
        } catch (Exception e) {
            log.debug("读取回收站元数据失败 {}: {}", path, e.getMessage());
            return null;
        }
        if (text == null || text.trim().isEmpty()) {
            return null;
        }
        TrashInfo info = new TrashInfo();
        for (String line : text.split("\\r?\\n")) {
            String row = line.trim();
            int eq = row.indexOf('=');
            if (eq <= 0) {
                continue;
            }
            String key = row.substring(0, eq).trim();
            String value = row.substring(eq + 1).trim();
            if ("Path".equalsIgnoreCase(key)) {
                info.path = decodePath(value);
            } else if ("DeletionDate".equalsIgnoreCase(key)) {
                info.deletedAt = parseDeletedAt(value);
            }
        }
        return info.path == null ? null : info;
    }

    /** 生成 freedesktop 规范的 .trashinfo 内容：原路径按 URI 规则百分号编码 */
    private static String infoContent(String originalPath) {
        return INFO_HEADER + "\n"
                + "Path=" + encodePath(originalPath) + "\n"
                + "DeletionDate=" + LocalDateTime.now().format(DELETED_AT) + "\n";
    }

    private static String encodePath(String path) {
        StringBuilder sb = new StringBuilder(path.length() + 16);
        for (byte b : path.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xFF;
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || c == '-' || c == '_' || c == '.' || c == '~' || c == '/') {
                sb.append((char) c);
            } else {
                sb.append('%')
                        .append(Character.toUpperCase(Character.forDigit((c >> 4) & 0xF, 16)))
                        .append(Character.toUpperCase(Character.forDigit(c & 0xF, 16)));
            }
        }
        return sb.toString();
    }

    private static String decodePath(String value) {
        byte[] raw = value.getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream out = new ByteArrayOutputStream(raw.length);
        for (int i = 0; i < raw.length; i++) {
            byte b = raw[i];
            if (b == '%' && i + 2 < raw.length) {
                int hi = Character.digit((char) raw[i + 1], 16);
                int lo = Character.digit((char) raw[i + 2], 16);
                if (hi >= 0 && lo >= 0) {
                    out.write((hi << 4) + lo);
                    i += 2;
                    continue;
                }
            }
            out.write(b);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static long parseDeletedAt(String value) {
        String s = value == null ? "" : value.trim();
        if (s.isEmpty()) {
            return 0L;
        }
        int dot = s.indexOf('.');
        if (dot > 0) {
            s = s.substring(0, dot);
        }
        if (s.length() > 19) {
            s = s.substring(0, 19);
        }
        try {
            return LocalDateTime.parse(s, DELETED_AT)
                    .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (Exception e) {
            return 0L;
        }
    }

    private static String stripInfoSuffix(String fileName) {
        if (fileName == null || !fileName.endsWith(INFO_SUFFIX)) {
            return null;
        }
        String id = fileName.substring(0, fileName.length() - INFO_SUFFIX.length());
        return id.isEmpty() ? null : id;
    }

    private static void checkId(String id) {
        if (id == null || id.trim().isEmpty()) {
            throw new IllegalArgumentException("缺少回收站项目");
        }
        if (id.length() > MAX_ID_LENGTH || id.contains("/") || id.contains("\\")
                || ".".equals(id) || "..".equals(id)) {
            throw new IllegalArgumentException("回收站项目标识不合法");
        }
    }

    private void deleteQuietly(String sessionId, String path) {
        try {
            if (sftp.exists(sessionId, path)) {
                sftp.delete(sessionId, path);
            }
        } catch (Exception e) {
            log.debug("清理回收站残留文件失败 {}: {}", path, e.getMessage());
        }
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
        return join(sftp.home(sessionId), TRASH_DIR);
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
    private static class TrashInfo {
        private String path;
        private long deletedAt;
    }
}
