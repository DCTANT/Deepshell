package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.SftpEntry;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.SftpATTRS;
import com.jcraft.jsch.SftpException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.Vector;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * SFTP 文件操作：每个 SSH 会话复用一个 SFTP 通道，所有操作在会话锁内串行执行
 */
@Slf4j
@Service
public class SftpService {

    private static final int MAX_EDIT_SIZE = 512 * 1024;
    private static final int MAX_RECURSION = 64;
    private static final int MAX_BUNDLE_SOURCES = 200;
    private static final int MAX_LOCAL_DOWNLOAD_ENTRIES = 200_000;

    private final SshSessionManager sessions;

    public SftpService(SshSessionManager sessions) {
        this.sessions = sessions;
    }

    @FunctionalInterface
    public interface SftpCallable<T> {
        T run(ChannelSftp c) throws Exception;
    }

    private <T> T withSftp(String sessionId, SftpCallable<T> fn) throws Exception {
        SshSessionManager.SshSession s = sessions.get(sessionId);
        synchronized (s.sftpLock) {
            ChannelSftp c = s.sftpChannel();
            if (c == null || !c.isConnected()) {
                c = (ChannelSftp) s.getJsch().openChannel("sftp");
                c.connect(8000);
                c.setFilenameEncoding("UTF-8");
                s.setSftpChannel(c);
            }
            return fn.run(c);
        }
    }

    public List<SftpEntry> list(String sessionId, String path) throws Exception {
        return withSftp(sessionId, c -> {
            String p = (path == null || path.trim().isEmpty()) ? "." : path;
            @SuppressWarnings("unchecked")
            Vector<ChannelSftp.LsEntry> entries = c.ls(p);
            List<SftpEntry> out = new ArrayList<>();
            for (ChannelSftp.LsEntry e : entries) {
                String name = e.getFilename();
                if (".".equals(name) || "..".equals(name)) {
                    continue;
                }
                SftpATTRS a = e.getAttrs();
                boolean link = a.isLink();
                boolean dir = a.isDir();
                long mtime = a.getMTime() * 1000L;
                if (link && !dir) {
                    // ls 返回的是链接自身属性（lstat）；跟随链接判断目标是否为目录，
                    // 否则指向目录的符号链接会被当成文件，前端无法进入
                    try {
                        SftpATTRS target = c.stat(join(p, name));
                        if (target.isDir()) {
                            dir = true;
                            mtime = target.getMTime() * 1000L;
                        }
                    } catch (SftpException ex) {
                        // 失效链接或无权限访问目标：按普通文件展示，仍可重命名/删除
                        log.debug("无法解析符号链接 {}: {}", join(p, name), ex.getMessage());
                    }
                }
                out.add(new SftpEntry(name, dir, link, a.getSize(),
                        mtime, a.getPermissionsString()));
            }
            out.sort((x, y) -> x.isDir() == y.isDir()
                    ? x.getName().compareToIgnoreCase(y.getName())
                    : (x.isDir() ? -1 : 1));
            return out;
        });
    }

    public String home(String sessionId) throws Exception {
        return withSftp(sessionId, ChannelSftp::getHome);
    }

    /** 修改文件/目录权限（八进制模式，如 0644、0755） */
    public void chmod(String sessionId, String path, int mode) throws Exception {
        if (path == null || path.trim().isEmpty()) {
            throw new IllegalArgumentException("路径不能为空");
        }
        if (mode < 0 || mode > 07777) {
            throw new IllegalArgumentException("权限模式不合法，应为八进制 0 - 7777");
        }
        withSftp(sessionId, c -> {
            c.chmod(mode, path);
            return null;
        });
    }

    /** 把本地上传临时文件写入远端，relativePath 可包含多级目录，自动创建父目录 */
    public void putLocalFile(String sessionId, String dirPath, String relativePath,
                             java.nio.file.Path localFile) throws Exception {
        String rel = relativePath == null ? "" : relativePath.replace('\\', '/');
        while (rel.startsWith("/")) {
            rel = rel.substring(1);
        }
        if (rel.isEmpty()) {
            throw new IllegalArgumentException("目标文件名不能为空");
        }
        final String target = join(dirPath, rel);
        withSftp(sessionId, c -> {
            ensureDir(c, parentOf(target));
            try (InputStream in = java.nio.file.Files.newInputStream(localFile)) {
                c.put(in, target, ChannelSftp.OVERWRITE);
            }
            return null;
        });
    }

    private void ensureDir(ChannelSftp c, String dir) throws Exception {
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
                c.stat(path);
            } catch (SftpException e) {
                if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                    c.mkdir(path);
                } else {
                    throw e;
                }
            }
        }
    }

    public void mkdir(String sessionId, String path) throws Exception {
        withSftp(sessionId, c -> {
            c.mkdir(path);
            return null;
        });
    }

    /** 递归创建目录（已存在时忽略） */
    public void mkdirs(String sessionId, String path) throws Exception {
        withSftp(sessionId, c -> {
            ensureDir(c, path);
            return null;
        });
    }

    /** 把源路径直接重命名/移动到目标绝对路径 */
    public void renameAbsolute(String sessionId, String src, String dest) throws Exception {
        withSftp(sessionId, c -> {
            c.rename(src, dest);
            return null;
        });
    }

    public boolean exists(String sessionId, String path) throws Exception {
        return withSftp(sessionId, c -> sftpExists(c, path));
    }

    /** 下载单个文件到本机临时路径（跨服务器传输暂存用） */
    public void downloadToLocal(String sessionId, String path, Path local) throws Exception {
        withSftp(sessionId, c -> {
            SftpATTRS attrs = c.stat(path);
            if (attrs.isDir()) {
                throw new IllegalArgumentException("跨服务器传输暂只支持文件");
            }
            Files.createDirectories(local.toAbsolutePath().getParent());
            c.get(path, local.toString());
            return null;
        });
    }

    public void rename(String sessionId, String path, String newName) throws Exception {
        if (newName == null || newName.trim().isEmpty() || newName.contains("/")) {
            throw new IllegalArgumentException("新名称不合法");
        }
        withSftp(sessionId, c -> {
            c.rename(path, join(parentOf(path), newName.trim()));
            return null;
        });
    }

    /** 移动文件/目录到目标目录（拖拽移动） */
    public void move(String sessionId, String srcPath, String destDir) throws Exception {
        if (srcPath == null || srcPath.trim().isEmpty() || destDir == null || destDir.trim().isEmpty()) {
            throw new IllegalArgumentException("参数不完整");
        }
        String src = trimTrailingSlash(srcPath.trim());
        String dest = trimTrailingSlash(destDir.trim());
        String name = src.substring(src.lastIndexOf('/') + 1);
        if (name.isEmpty()) {
            throw new IllegalArgumentException("源路径不合法");
        }
        if (dest.equals(src) || dest.startsWith(src + "/")) {
            throw new IllegalArgumentException("不能移动到自身或其子目录");
        }
        String parent = parentOf(src);
        if (trimTrailingSlash(parent).equals(dest)) {
            throw new IllegalArgumentException("文件已在该目录中");
        }
        final String target = join(dest, name);
        withSftp(sessionId, c -> {
            c.rename(src, target);
            return null;
        });
    }

    private static String trimTrailingSlash(String p) {
        String s = p;
        while (s.length() > 1 && s.endsWith("/")) {
            s = s.substring(0, s.length() - 1);
        }
        return s;
    }

    /** 复制文件或文件夹到目标目录（同名目标存在时按 Windows 习惯生成「- 副本」），返回实际生成的名称 */
    public List<String> copy(String sessionId, List<String> paths, String destDir) throws Exception {
        if (paths == null || paths.isEmpty()) {
            throw new IllegalArgumentException("没有要复制的文件");
        }
        if (destDir == null || destDir.trim().isEmpty()) {
            throw new IllegalArgumentException("目标目录为空");
        }
        final String dest = trimTrailingSlash(destDir.trim());
        return withSftp(sessionId, c -> {
            SftpATTRS destAttrs = c.stat(dest);
            if (!destAttrs.isDir()) {
                throw new IllegalArgumentException("目标不是目录");
            }
            List<String> created = new ArrayList<>();
            for (String raw : paths) {
                if (raw == null || raw.trim().isEmpty()) {
                    continue;
                }
                String src = trimTrailingSlash(raw.trim());
                String name = src.substring(src.lastIndexOf('/') + 1);
                if (name.isEmpty()) {
                    throw new IllegalArgumentException("源路径不合法");
                }
                SftpATTRS srcAttrs = c.stat(src);
                if (srcAttrs.isDir() && (dest.equals(src) || dest.startsWith(src + "/"))) {
                    throw new IllegalArgumentException("不能把文件夹复制到自身或其子目录");
                }
                String targetName = uniqueCopyName(c, dest, name, srcAttrs.isDir());
                if (!targetName.equals(name)) {
                    log.info("复制目标同名，自动重命名: {} -> {}", name, targetName);
                }
                copyRecursive(c, src, join(dest, targetName), 0);
                created.add(targetName);
            }
            return created;
        });
    }

    /**
     * 目标已存在时生成 Windows 风格名称：file.txt -> file - 副本.txt，
     * 再次冲突为 file - 副本 (2).txt；文件夹不拆分扩展名。
     */
    private static String uniqueCopyName(ChannelSftp c, String dest, String name, boolean dir)
            throws Exception {
        if (!sftpExists(c, join(dest, name))) {
            return name;
        }
        String base = name;
        String ext = "";
        if (!dir) {
            int dot = name.lastIndexOf('.');
            if (dot > 0 && dot < name.length() - 1) {
                base = name.substring(0, dot);
                ext = name.substring(dot);
            }
        }
        String candidate = base + " - 副本" + ext;
        if (!sftpExists(c, join(dest, candidate))) {
            return candidate;
        }
        for (int i = 2; i <= 1000; i++) {
            candidate = base + " - 副本 (" + i + ")" + ext;
            if (!sftpExists(c, join(dest, candidate))) {
                return candidate;
            }
        }
        throw new IllegalStateException("同名文件过多，无法生成副本名称：" + name);
    }

    private static boolean sftpExists(ChannelSftp c, String path) throws SftpException {
        try {
            c.stat(path);
            return true;
        } catch (SftpException e) {
            if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                return false;
            }
            throw e;
        }
    }

    private void copyRecursive(ChannelSftp c, String src, String target, int depth) throws Exception {
        if (depth > MAX_RECURSION) {
            throw new IllegalArgumentException("目录层级过深");
        }
        SftpATTRS attrs = c.stat(src);
        if (attrs.isDir()) {
            c.mkdir(target);
            @SuppressWarnings("unchecked")
            Vector<ChannelSftp.LsEntry> entries = c.ls(src);
            for (ChannelSftp.LsEntry entry : entries) {
                String name = entry.getFilename();
                if (".".equals(name) || "..".equals(name)) {
                    continue;
                }
                copyRecursive(c, join(src, name), join(target, name), depth + 1);
            }
            return;
        }
        // JSch 的同一个 SFTP 通道不支持同时打开 get 读流和 put 写流
        // （并发流常见报错 java.io.IOException: 1: End of file）。
        // 先完整下载到本机临时文件，再顺序上传到目标，避免两个流同时占用通道。
        Path tmp = Files.createTempFile("deepshell-copy-", ".tmp");
        try {
            c.get(src, tmp.toString());
            c.put(tmp.toString(), target);
        } finally {
            try {
                Files.deleteIfExists(tmp);
            } catch (Exception ignore) {
                // 临时文件清理失败不影响复制结果
            }
        }
    }

    public void delete(String sessionId, String path) throws Exception {
        withSftp(sessionId, c -> {
            deleteRecursive(c, path, 0);
            return null;
        });
    }

    private void deleteRecursive(ChannelSftp c, String path, int depth) throws Exception {
        if (depth > MAX_RECURSION) {
            throw new IllegalStateException("目录层级过深，已终止删除");
        }
        SftpATTRS a;
        try {
            a = c.lstat(path);
        } catch (Exception e) {
            a = c.stat(path);
        }
        if (a.isDir() && !a.isLink()) {
            @SuppressWarnings("unchecked")
            Vector<ChannelSftp.LsEntry> children = c.ls(path);
            for (ChannelSftp.LsEntry e : children) {
                String n = e.getFilename();
                if (".".equals(n) || "..".equals(n)) {
                    continue;
                }
                deleteRecursive(c, join(path, n), depth + 1);
            }
            c.rmdir(path);
        } else {
            c.rm(path);
        }
    }

    /** 新建空文本文件（已存在同名文件时报错） */
    public void createFile(String sessionId, String path) throws Exception {
        if (path == null || path.trim().isEmpty()) {
            throw new IllegalArgumentException("路径不合法");
        }
        final String p = path.trim();
        withSftp(sessionId, c -> {
            try {
                c.lstat(p);
                throw new IllegalStateException("同名文件已存在");
            } catch (SftpException e) {
                if (e.id != ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                    throw e;
                }
            }
            c.put(new ByteArrayInputStream(new byte[0]), p);
            return null;
        });
    }

    public void upload(String sessionId, String dirPath, MultipartFile file) throws Exception {
        String original = file.getOriginalFilename() == null ? "upload.bin" : file.getOriginalFilename();
        String name = original.replace('\\', '/');
        int idx = name.lastIndexOf('/');
        if (idx >= 0) {
            name = name.substring(idx + 1);
        }
        if (name.isEmpty()) {
            name = "upload.bin";
        }
        final String fname = name;
        withSftp(sessionId, c -> {
            try (InputStream in = file.getInputStream()) {
                c.put(in, join(dirPath, fname), ChannelSftp.OVERWRITE);
            }
            return null;
        });
    }

    public void download(String sessionId, String path, OutputStream out) throws Exception {
        withSftp(sessionId, c -> {
            c.get(path, out);
            return null;
        });
    }

    /**
     * 按字节区间读取远程文件（视频预览 Range 请求用）。
     * 单独开一个 SFTP 通道，避免长时间播放占用文件面板的共享通道。
     */
    public void streamRange(String sessionId, String path, long offset, long length,
                            OutputStream out) throws Exception {
        SshSessionManager.SshSession s = sessions.get(sessionId);
        ChannelSftp channel = (ChannelSftp) s.getJsch().openChannel("sftp");
        try {
            channel.connect(8000);
            channel.setFilenameEncoding("UTF-8");
            try (InputStream in = channel.get(path, null, Math.max(0, offset))) {
                byte[] buf = new byte[64 * 1024];
                long remaining = length;
                while (remaining > 0) {
                    int n = in.read(buf, 0, (int) Math.min(buf.length, remaining));
                    if (n == -1) {
                        break;
                    }
                    out.write(buf, 0, n);
                    remaining -= n;
                }
                out.flush();
            }
        } finally {
            try {
                channel.disconnect();
            } catch (Exception ignore) {
                // 浏览器取消播放时连接可能已断开
            }
        }
    }

    /** 文件大小（下载进度跟踪用） */
    public long fileSize(String sessionId, String path) throws Exception {
        return withSftp(sessionId, c -> c.stat(path).getSize());
    }

    /** 多选打包下载预检：校验目录 / 路径关系，并确认顶层文件或文件夹可访问 */
    public int checkBundle(String sessionId, String dir, List<String> paths) throws Exception {
        return checkSources(sessionId, dir, paths, MAX_BUNDLE_SOURCES);
    }

    /** 本机直写下载预检：顶层选中项不设数量上限（整目录照片备份可能一次几千项） */
    public int checkLocalDownload(String sessionId, String dir, List<String> paths) throws Exception {
        return checkSources(sessionId, dir, paths, 0);
    }

    private int checkSources(String sessionId, String dir, List<String> paths, int maxSources)
            throws Exception {
        BundleSelection sel = validateBundle(dir, paths, maxSources);
        withSftp(sessionId, c -> {
            for (String name : sel.names) {
                try {
                    c.stat(sel.path(name));
                } catch (SftpException e) {
                    throw new IllegalArgumentException("文件不存在或无法访问：" + name);
                }
            }
            return null;
        });
        return sel.names.size();
    }

    /**
     * 后端 SFTP 流式打包：逐个读取选中文件和文件夹，直接写入 ZIP 输出流。
     * 不在服务器落临时文件，也不依赖服务器的 zip 命令；单个文件失败会记录到压缩包内的说明文件。
     */
    public void writeZip(String sessionId, String dir, List<String> paths, OutputStream out) throws Exception {
        BundleSelection sel = validateBundle(dir, paths);
        withSftp(sessionId, c -> {
            writeZipTo(c, sel, out);
            return null;
        });
    }

    /** 供单元测试：基于已建立的 SFTP 通道写 ZIP */
    static void writeZipTo(ChannelSftp c, String dir, List<String> paths, OutputStream out) throws Exception {
        writeZipTo(c, validateBundle(dir, paths), out);
    }

    private static void writeZipTo(ChannelSftp c, BundleSelection sel, OutputStream out) throws Exception {
        ZipOutputStream zip = new ZipOutputStream(out, StandardCharsets.UTF_8);
        List<String> errors = new ArrayList<>();
        Set<String> visitedDirs = new HashSet<>();
        try {
            for (String name : sel.names) {
                addZipEntry(c, zip, sel.path(name), name, 0, visitedDirs, errors);
            }
            if (!errors.isEmpty()) {
                String errName = "_deepshell_errors.txt";
                if (sel.names.contains(errName)) {
                    errName = "_deepshell_errors_" + System.currentTimeMillis() + ".txt";
                }
                zip.putNextEntry(new ZipEntry(errName));
                String content = "以下文件或目录未能打包：\n" + String.join("\n", errors);
                zip.write(content.getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
                log.warn("打包下载部分文件失败: {}", errors);
            }
            zip.finish();
            zip.flush();
        } finally {
            try {
                zip.flush();
            } catch (Exception ignore) {
                // 客户端提前断开时忽略
            }
        }
    }

    private static void addZipEntry(ChannelSftp c, ZipOutputStream zip, String path, String entryName,
                                    int depth, Set<String> visitedDirs, List<String> errors) throws Exception {
        if (depth > MAX_RECURSION) {
            errors.add(entryName + "：目录层级过深，已跳过");
            return;
        }
        SftpATTRS attrs;
        try {
            attrs = c.stat(path);
        } catch (Exception e) {
            errors.add(entryName + "：" + errorText(e));
            return;
        }
        if (attrs.isDir()) {
            String realPath;
            try {
                realPath = c.realpath(path);
            } catch (Exception e) {
                realPath = path;
            }
            if (!visitedDirs.add(realPath)) {
                errors.add(entryName + "：重复目录（符号链接），已跳过");
                return;
            }
            try {
                ZipEntry dirEntry = new ZipEntry(entryName + "/");
                dirEntry.setTime(attrs.getMTime() * 1000L);
                zip.putNextEntry(dirEntry);
                zip.closeEntry();
            } catch (IOException e) {
                throw new DownloadAbortedException(e);
            }
            Vector<ChannelSftp.LsEntry> children;
            try {
                children = c.ls(path);
            } catch (Exception e) {
                errors.add(entryName + "：" + errorText(e));
                return;
            }
            List<ChannelSftp.LsEntry> sorted = new ArrayList<>(children);
            sorted.sort(Comparator.comparing(ChannelSftp.LsEntry::getFilename));
            for (ChannelSftp.LsEntry child : sorted) {
                String childName = child.getFilename();
                if (".".equals(childName) || "..".equals(childName)) {
                    continue;
                }
                addZipEntry(c, zip, join(path, childName), entryName + "/" + childName,
                        depth + 1, visitedDirs, errors);
            }
        } else {
            try {
                ZipEntry entry = new ZipEntry(entryName);
                entry.setTime(attrs.getMTime() * 1000L);
                zip.putNextEntry(entry);
                try (InputStream in = c.get(path)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        try {
                            zip.write(buf, 0, n);
                        } catch (IOException e) {
                            throw new DownloadAbortedException(e);
                        }
                    }
                }
                zip.closeEntry();
            } catch (DownloadAbortedException e) {
                throw e;
            } catch (Exception e) {
                try {
                    zip.closeEntry();
                } catch (Exception ignore) {
                    // 当前条目可能已写入部分数据，保留其余文件继续打包
                }
                errors.add(entryName + "：" + errorText(e));
            }
        }
    }

    private static String errorText(Exception e) {
        String message = e.getMessage();
        return message == null || message.isEmpty() ? e.getClass().getSimpleName() : message;
    }

    private static BundleSelection validateBundle(String dir, List<String> paths) {
        return validateBundle(dir, paths, MAX_BUNDLE_SOURCES);
    }

    /** maxSources 为 0 表示不限顶层项数 */
    private static BundleSelection validateBundle(String dir, List<String> paths, int maxSources) {
        String d = dir == null ? "" : dir.trim();
        while (d.length() > 1 && d.endsWith("/")) {
            d = d.substring(0, d.length() - 1);
        }
        if (!d.startsWith("/") || d.contains("\n") || d.contains("\r") || d.length() > 4096) {
            throw new IllegalArgumentException("目录不合法");
        }
        if (paths == null || paths.isEmpty()) {
            throw new IllegalArgumentException("请选择要下载的文件或文件夹");
        }
        LinkedHashSet<String> names = new LinkedHashSet<>();
        for (String raw : paths) {
            if (raw == null) {
                continue;
            }
            if (!raw.startsWith("/") || raw.contains("\n") || raw.contains("\r")
                    || raw.length() > 4096) {
                throw new IllegalArgumentException("文件路径不合法");
            }
            int idx = raw.lastIndexOf('/');
            String parent = idx <= 0 ? "/" : raw.substring(0, idx);
            if (!parent.equals(d)) {
                throw new IllegalArgumentException("只能下载当前目录下的文件或文件夹");
            }
            String name = raw.substring(idx + 1);
            if (name.isEmpty() || ".".equals(name) || "..".equals(name)
                    || name.indexOf('\0') >= 0) {
                throw new IllegalArgumentException("文件名不合法：" + name);
            }
            names.add(name);
        }
        if (names.isEmpty()) {
            throw new IllegalArgumentException("请选择要下载的文件或文件夹");
        }
        if (maxSources > 0 && names.size() > maxSources) {
            throw new IllegalArgumentException("一次最多下载 " + maxSources + " 项");
        }
        return new BundleSelection(d, new ArrayList<>(names));
    }

    private static final class BundleSelection {
        final String dir;
        final List<String> names;

        BundleSelection(String dir, List<String> names) {
            this.dir = dir;
            this.names = names;
        }

        String path(String name) {
            return join(dir, name);
        }
    }

    private static final class DownloadAbortedException extends RuntimeException {
        DownloadAbortedException(Throwable cause) {
            super(cause);
        }
    }

    /** 本机直写下载计划中的单个条目 */
    public static final class LocalDownloadEntry {
        public final String remotePath;
        public final String relativePath;
        public final boolean dir;
        public final long size;
        public final long mtime;

        LocalDownloadEntry(String remotePath, String relativePath, boolean dir, long size, long mtime) {
            this.remotePath = remotePath;
            this.relativePath = relativePath;
            this.dir = dir;
            this.size = size;
            this.mtime = mtime;
        }
    }

    /** 扫描结果：目录树、文件数与总字节数 */
    public static final class LocalDownloadPlan {
        public final List<LocalDownloadEntry> entries;
        public final int totalFiles;
        public final int totalDirs;
        public final long totalBytes;
        public final List<String> warnings;

        LocalDownloadPlan(List<LocalDownloadEntry> entries, int totalFiles, int totalDirs,
                          long totalBytes, List<String> warnings) {
            this.entries = entries;
            this.totalFiles = totalFiles;
            this.totalDirs = totalDirs;
            this.totalBytes = totalBytes;
            this.warnings = warnings;
        }
    }

    public interface LocalDownloadProgress {
        void onEntryStarted(String relativePath, long size);

        void onBytes(long delta);

        void onFileDone(String relativePath, String localPath, long size);

        void onFileFailed(String relativePath, String message);

        void onDirCreated(String relativePath, String localPath);

        void onDirFailed(String relativePath, String message);

        void onRenamed(String relativePath, String localName);

        /** 用户取消时为 true，下载循环据此尽快停止 */
        default boolean isCancelled() {
            return false;
        }
    }

    /** 扫描选中目录树，供本机直写下载使用 */
    public LocalDownloadPlan planLocalDownload(String sessionId, String dir, List<String> paths) throws Exception {
        return withSftp(sessionId, c -> planLocalDownloadTo(c, dir, paths));
    }

    static LocalDownloadPlan planLocalDownloadTo(ChannelSftp c, String dir, List<String> paths) {
        BundleSelection sel = validateBundle(dir, paths, 0);
        List<LocalDownloadEntry> entries = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        Set<String> visitedDirs = new HashSet<>();
        int[] counts = new int[2];
        long[] totalBytes = new long[1];
        for (String name : sel.names) {
            scanLocalEntry(c, sel.path(name), name, 0, visitedDirs, entries, warnings, counts, totalBytes);
        }
        return new LocalDownloadPlan(entries, counts[0], counts[1], totalBytes[0], warnings);
    }

    private static void scanLocalEntry(ChannelSftp c, String path, String relative, int depth,
                                       Set<String> visitedDirs, List<LocalDownloadEntry> entries,
                                       List<String> warnings, int[] counts, long[] totalBytes) {
        if (depth > MAX_RECURSION) {
            warnings.add(relative + "：目录层级过深，已跳过");
            return;
        }
        if (entries.size() >= MAX_LOCAL_DOWNLOAD_ENTRIES) {
            throw new IllegalArgumentException("选中内容超过 " + MAX_LOCAL_DOWNLOAD_ENTRIES
                    + " 项，请分批下载到本机");
        }
        SftpATTRS attrs;
        try {
            attrs = c.stat(path);
        } catch (Exception e) {
            warnings.add(relative + "：" + errorText(e));
            return;
        }
        if (attrs.isDir()) {
            String realPath;
            try {
                realPath = c.realpath(path);
            } catch (Exception e) {
                realPath = path;
            }
            if (!visitedDirs.add(realPath)) {
                warnings.add(relative + "：重复目录（符号链接），已跳过");
                return;
            }
            entries.add(new LocalDownloadEntry(path, relative, true, 0L, attrs.getMTime() * 1000L));
            counts[1]++;
            Vector<ChannelSftp.LsEntry> children;
            try {
                children = c.ls(path);
            } catch (Exception e) {
                warnings.add(relative + "：" + errorText(e));
                return;
            }
            List<ChannelSftp.LsEntry> sorted = new ArrayList<>(children);
            sorted.sort(Comparator.comparing(ChannelSftp.LsEntry::getFilename));
            for (ChannelSftp.LsEntry child : sorted) {
                String childName = child.getFilename();
                if (".".equals(childName) || "..".equals(childName)) {
                    continue;
                }
                scanLocalEntry(c, join(path, childName), relative + "/" + childName,
                        depth + 1, visitedDirs, entries, warnings, counts, totalBytes);
            }
        } else {
            long size = attrs.getSize();
            entries.add(new LocalDownloadEntry(path, relative, false, size, attrs.getMTime() * 1000L));
            counts[0]++;
            totalBytes[0] += size;
        }
    }

    /** 按计划把远端文件逐个 SFTP 读取并写入本机目录（调用方需保证 targetRoot 是新建的空目录） */
    public void downloadLocalPlan(String sessionId, LocalDownloadPlan plan,
                                  Path targetRoot, LocalDownloadProgress progress) throws Exception {
        withSftp(sessionId, c -> {
            downloadLocalPlanTo(c, plan, targetRoot, progress);
            return null;
        });
    }

    static void downloadLocalPlanTo(ChannelSftp c, LocalDownloadPlan plan,
                                    Path targetRoot, LocalDownloadProgress progress) throws Exception {
        if (plan == null || plan.entries == null) {
            throw new IllegalArgumentException("下载计划为空");
        }
        Files.createDirectories(targetRoot);
        Map<String, Path> localDirs = new HashMap<>();
        localDirs.put("", targetRoot);
        int consecutiveFailures = 0;
        for (LocalDownloadEntry entry : plan.entries) {
            if (progress.isCancelled()) {
                throw new InterruptedException("下载已取消");
            }
            String parentRelative = parentRelative(entry.relativePath);
            Path localParent = localDirs.get(parentRelative);
            if (localParent == null) {
                progress.onFileFailed(entry.relativePath, "上级目录未能创建，已跳过");
                consecutiveFailures++;
                if (consecutiveFailures > 20) {
                    throw new IllegalStateException("连续失败过多，已中止下载");
                }
                continue;
            }
            String remoteName = baseRelative(entry.relativePath);
            String expectedName = safeLocalName(remoteName);
            Path localPath = uniqueLocalPath(localParent, expectedName, entry.dir);
            String localName = localPath.getFileName().toString();
            if (!localName.equals(remoteName)) {
                progress.onRenamed(entry.relativePath, localName);
            }
            if (entry.dir) {
                try {
                    Files.createDirectories(localPath);
                    localDirs.put(entry.relativePath, localPath);
                    progress.onDirCreated(entry.relativePath, localPath.toString());
                } catch (Exception e) {
                    progress.onDirFailed(entry.relativePath, errorText(e));
                    consecutiveFailures++;
                }
            } else {
                progress.onEntryStarted(entry.relativePath, entry.size);
                Path temp = null;
                try {
                    Files.createDirectories(localParent);
                    temp = Files.createTempFile(localParent, ".deepshell-", ".part");
                    try (InputStream in = c.get(entry.remotePath);
                         OutputStream out = new BufferedOutputStream(
                                 Files.newOutputStream(temp, StandardOpenOption.TRUNCATE_EXISTING,
                                         StandardOpenOption.WRITE), 64 * 1024)) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            if (progress.isCancelled()) {
                                throw new InterruptedException("下载已取消");
                            }
                            out.write(buf, 0, n);
                            progress.onBytes(n);
                        }
                    }
                    Files.move(temp, localPath, StandardCopyOption.REPLACE_EXISTING);
                    temp = null;
                    try {
                        Files.setLastModifiedTime(localPath, FileTime.fromMillis(entry.mtime));
                    } catch (Exception ignore) {
                        // 修改时间设置失败不影响文件内容
                    }
                    progress.onFileDone(entry.relativePath, localPath.toString(), entry.size);
                    consecutiveFailures = 0;
                } catch (Exception e) {
                    if (temp != null) {
                        try {
                            Files.deleteIfExists(temp);
                        } catch (Exception ignore) {
                            // 忽略临时文件清理失败
                        }
                    }
                    if (progress.isCancelled()) {
                        throw new InterruptedException("下载已取消");
                    }
                    progress.onFileFailed(entry.relativePath, errorText(e));
                    consecutiveFailures++;
                }
            }
            if (consecutiveFailures > 20) {
                throw new IllegalStateException("连续失败过多，已中止下载（可能是磁盘空间不足或会话已断开）");
            }
        }
    }

    private static String parentRelative(String relative) {
        int idx = relative.lastIndexOf('/');
        return idx < 0 ? "" : relative.substring(0, idx);
    }

    private static String baseRelative(String relative) {
        int idx = relative.lastIndexOf('/');
        return idx < 0 ? relative : relative.substring(idx + 1);
    }

    private static final Pattern WINDOWS_INVALID_CHARS =
            Pattern.compile("[\\\\/:*?\"<>|\\x00-\\x1F]");
    private static final Set<String> WINDOWS_RESERVED_NAMES = new HashSet<>(Arrays.asList(
            "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"));

    /** 把远端文件名转成本机（尤其 Windows）可用的名字 */
    static String safeLocalName(String name) {
        String value = WINDOWS_INVALID_CHARS.matcher(name == null ? "" : name).replaceAll("_");
        String base = value;
        int dot = base.indexOf('.');
        if (dot >= 0) {
            base = base.substring(0, dot);
        }
        if (WINDOWS_RESERVED_NAMES.contains(base.trim().toUpperCase(Locale.ROOT))) {
            value = "_" + value;
        }
        while (value.endsWith(".") || value.endsWith(" ")) {
            value = value.substring(0, value.length() - 1);
        }
        if (value.isEmpty()) {
            value = "_";
        }
        if (value.length() > 180) {
            value = value.substring(0, 180);
        }
        return value;
    }

    private static Path uniqueLocalPath(Path parent, String name, boolean dir) {
        Path candidate = parent.resolve(name);
        if (!Files.exists(candidate)) {
            return candidate;
        }
        String base = name;
        String ext = "";
        if (!dir) {
            int dot = name.lastIndexOf('.');
            if (dot > 0) {
                base = name.substring(0, dot);
                ext = name.substring(dot);
            }
        }
        for (int i = 2; i < 1000; i++) {
            Path next = parent.resolve(base + "-" + i + ext);
            if (!Files.exists(next)) {
                return next;
            }
        }
        return parent.resolve(base + "-" + System.nanoTime() + ext);
    }

    /** 读取完整文件到内存（缩略图生成用），超过 maxBytes 直接报错，避免超大文件拖垮内存 */
    public byte[] readBytes(String sessionId, String path, int maxBytes) throws Exception {
        return withSftp(sessionId, c -> {
            try (InputStream in = c.get(path)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16 * 1024];
                int n;
                int total = 0;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > maxBytes) {
                        throw new IllegalArgumentException("文件过大，无法生成缩略图");
                    }
                    out.write(buf, 0, n);
                }
                return out.toByteArray();
            }
        });
    }

    public String readText(String sessionId, String path) throws Exception {
        return withSftp(sessionId, c -> {
            try (InputStream in = c.get(path)) {
                byte[] data = readLimited(in, MAX_EDIT_SIZE);
                for (byte b : data) {
                    if (b == 0) {
                        throw new IllegalArgumentException("二进制文件不支持在线编辑");
                    }
                }
                return new String(data, StandardCharsets.UTF_8);
            }
        });
    }

    public void writeText(String sessionId, String path, String content) throws Exception {
        withSftp(sessionId, c -> {
            c.put(new ByteArrayInputStream(content.getBytes(StandardCharsets.UTF_8)), path);
            return null;
        });
    }

    /** 二进制安全的整体覆盖写入（VSCode 保存同步等场景） */
    public void putBytes(String sessionId, String path, byte[] data) throws Exception {
        withSftp(sessionId, c -> {
            c.put(new ByteArrayInputStream(data), path, ChannelSftp.OVERWRITE);
            return null;
        });
    }

    private static byte[] readLimited(InputStream in, int max) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        int total = 0;
        while ((n = in.read(buf)) != -1) {
            total += n;
            if (total > max) {
                throw new IllegalArgumentException("文件过大（超过 " + (max / 1024) + "KB），不支持在线编辑");
            }
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }

    static String join(String dir, String name) {
        if (dir == null || dir.isEmpty()) {
            return name;
        }
        return dir.endsWith("/") ? dir + name : dir + "/" + name;
    }

    static String parentOf(String path) {
        int idx = path.lastIndexOf('/');
        return idx <= 0 ? "/" : path.substring(0, idx);
    }
}
