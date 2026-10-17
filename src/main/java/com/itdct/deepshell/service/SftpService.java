package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.SftpEntry;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.SftpATTRS;
import com.jcraft.jsch.SftpException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Vector;

/**
 * SFTP 文件操作：每个 SSH 会话复用一个 SFTP 通道，所有操作在会话锁内串行执行
 */
@Slf4j
@Service
public class SftpService {

    private static final int MAX_EDIT_SIZE = 512 * 1024;
    private static final int MAX_RECURSION = 64;

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
