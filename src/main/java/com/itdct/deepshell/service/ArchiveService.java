package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.ArchiveReq;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 远程压缩：调用服务器自带的 zip / tar / gzip / bzip2 / xz / 7z。
 * 命令经独立 exec 通道执行，不占用交互终端和 SFTP 通道。
 */
@Service
public class ArchiveService {

    private static final long TIMEOUT_MS = 600_000;
    private static final int MAX_OUTPUT_BYTES = 64 * 1024;
    private static final int MAX_SOURCES = 200;
    private static final int MAX_PATH_CHARS = 50_000;

    private final SshSessionManager sessions;

    public ArchiveService(SshSessionManager sessions) {
        this.sessions = sessions;
    }

    public Map<String, Object> compress(ArchiveReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        if (req.getSessionId() == null || req.getSessionId().trim().isEmpty()) {
            throw new IllegalArgumentException("会话未就绪");
        }
        String destDir = normalizeDir(req.getDestDir());
        String format = normalizeFormat(req.getFormat());
        String level = normalizeLevel(req.getLevel());
        String archiveName = normalizeArchiveName(req.getName(), format);

        List<String> rawPaths = req.getPaths();
        if (rawPaths == null || rawPaths.isEmpty()) {
            throw new IllegalArgumentException("请选择要压缩的文件或文件夹");
        }
        if (rawPaths.size() > MAX_SOURCES) {
            throw new IllegalArgumentException("一次最多压缩 " + MAX_SOURCES + " 项");
        }
        Set<String> names = new LinkedHashSet<>();
        int totalPathChars = 0;
        for (String raw : rawPaths) {
            if (raw == null) {
                continue;
            }
            String p = raw.trim();
            if (!p.startsWith("/") || p.contains("\n") || p.contains("\r")) {
                throw new IllegalArgumentException("源文件路径不合法");
            }
            if (!parentOf(p).equals(destDir)) {
                throw new IllegalArgumentException("只能压缩当前目录下的文件或文件夹");
            }
            String name = p.substring(p.lastIndexOf('/') + 1);
            if (name.isEmpty() || ".".equals(name) || "..".equals(name)
                    || name.startsWith("-") || name.startsWith("@")
                    || name.contains("\n") || name.contains("\r")) {
                throw new IllegalArgumentException("源文件名不合法：" + name);
            }
            totalPathChars += name.length();
            if (totalPathChars > MAX_PATH_CHARS) {
                throw new IllegalArgumentException("选中的文件过多或名称过长");
            }
            names.add(name);
        }
        if (names.isEmpty()) {
            throw new IllegalArgumentException("请选择要压缩的文件或文件夹");
        }
        if (names.contains(archiveName)) {
            throw new IllegalArgumentException("压缩包名称不能与要压缩的文件相同");
        }

        SshSessionManager.SshSession s = sessions.get(req.getSessionId());
        String script = buildScript(archiveName, names, format, level, req.isOverwrite());
        SshSessionManager.ExecResult res = sessions.execInShell(
                s, script, destDir, TIMEOUT_MS, MAX_OUTPUT_BYTES);
        if (res.timedOut) {
            throw new IllegalStateException("压缩超时（超过 10 分钟），建议减少文件数量或选择更快级别");
        }
        String out = res.output == null ? "" : res.output.trim();
        int code = res.exitCode == null ? -1 : res.exitCode;
        if (code != 0) {
            if (out.contains("__ARCHIVE_EXISTS__")) {
                throw new IllegalArgumentException("目标压缩包已存在，请勾选覆盖或修改名称");
            }
            if (out.contains("__NO_ZIP__")) {
                throw new IllegalStateException("服务器未安装 zip 命令，请改用 TAR 或 7Z 格式");
            }
            if (out.contains("__NO_7Z__")) {
                throw new IllegalStateException("服务器未安装 7z / 7za 命令，请改用 ZIP 或 TAR 格式");
            }
            String detail = out.length() > 800 ? out.substring(0, 800) + "…" : out;
            throw new IllegalStateException("压缩失败" + (detail.isEmpty() ? "" : "：" + detail));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("name", archiveName);
        result.put("path", join(destDir, archiveName));
        result.put("format", format);
        result.put("count", names.size());
        return result;
    }

    /** 供单元测试：生成实际执行在服务器上的压缩脚本（cwd 为压缩输出目录） */
    static String buildScript(String archiveName, Collection<String> names, String format,
                              String level, boolean overwrite) {
        String qName = shq(archiveName);
        String tmp = shq(".deepshell_tmp_" + System.nanoTime() + "." + extension(format));
        StringBuilder sb = new StringBuilder();
        sb.append("if [ -e ").append(qName).append(" ]; then ");
        if (overwrite) {
            sb.append("rm -f ").append(qName).append("; ");
        } else {
            sb.append("echo __ARCHIVE_EXISTS__; exit 3; ");
        }
        sb.append("fi\n");

        if ("zip".equals(format)) {
            sb.append("command -v zip >/dev/null 2>&1 || { echo __NO_ZIP__; exit 4; }\n");
            sb.append("zip -r -q -").append(zipLevel(level)).append(" ").append(tmp);
            appendNames(sb, names);
            sb.append(" || { rm -f ").append(tmp).append("; echo __COMPRESS_FAILED__; exit 1; }\n");
        } else if ("7z".equals(format)) {
            sb.append("__ds7z=$(command -v 7z || command -v 7za) || { echo __NO_7Z__; exit 4; }\n");
            sb.append("\"$__ds7z\" a -t7z -mx=").append(sevenLevel(level))
                    .append(" -y ").append(tmp).append(" --");
            appendNames(sb, names);
            sb.append(" || { rm -f ").append(tmp).append("; echo __COMPRESS_FAILED__; exit 1; }\n");
        } else if ("tar".equals(format)) {
            sb.append("tar -cf ").append(tmp);
            appendNames(sb, names);
            sb.append(" || { rm -f ").append(tmp).append("; echo __COMPRESS_FAILED__; exit 1; }\n");
        } else if ("tar.gz".equals(format)) {
            sb.append("GZIP=-").append(gzipLevel(level)).append(" tar -czf ").append(tmp);
            appendNames(sb, names);
            sb.append(" || { rm -f ").append(tmp).append("; echo __COMPRESS_FAILED__; exit 1; }\n");
        } else if ("tar.bz2".equals(format)) {
            sb.append("BZIP2=-").append(bzip2Level(level)).append(" tar -cjf ").append(tmp);
            appendNames(sb, names);
            sb.append(" || { rm -f ").append(tmp).append("; echo __COMPRESS_FAILED__; exit 1; }\n");
        } else if ("tar.xz".equals(format)) {
            sb.append("XZ_OPT=-").append(xzLevel(level)).append(" tar -cJf ").append(tmp);
            appendNames(sb, names);
            sb.append(" || { rm -f ").append(tmp).append("; echo __COMPRESS_FAILED__; exit 1; }\n");
        } else {
            throw new IllegalArgumentException("不支持的压缩格式");
        }
        sb.append("mv -f ").append(tmp).append(" ").append(qName)
                .append(" || { rm -f ").append(tmp).append("; echo __MOVE_FAILED__; exit 2; }\n");
        return sb.toString();
    }

    private static void appendNames(StringBuilder sb, Collection<String> names) {
        for (String name : names) {
            sb.append(' ').append(shq(name));
        }
    }

    static String normalizeArchiveName(String name, String format) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty()) {
            n = "archive";
        }
        if (n.length() > 200) {
            throw new IllegalArgumentException("压缩包名称过长");
        }
        if (n.contains("/") || n.contains("\\") || n.contains("\n") || n.contains("\r")
                || n.indexOf('\0') >= 0 || n.startsWith("-") || n.startsWith("@")
                || ".".equals(n) || "..".equals(n)) {
            throw new IllegalArgumentException("压缩包名称不合法");
        }
        String suffix = "." + extension(format);
        if (!n.toLowerCase().endsWith(suffix.toLowerCase())) {
            n = n + suffix;
        }
        return n;
    }

    private static String normalizeDir(String dir) {
        String d = dir == null ? "" : dir.trim();
        while (d.length() > 1 && d.endsWith("/")) {
            d = d.substring(0, d.length() - 1);
        }
        if (!d.startsWith("/") || d.contains("\n") || d.contains("\r") || d.length() > 4096) {
            throw new IllegalArgumentException("输出目录不合法");
        }
        return d;
    }

    private static String normalizeFormat(String format) {
        String f = format == null ? "zip" : format.trim().toLowerCase();
        if (!"zip".equals(f) && !"tar".equals(f) && !"tar.gz".equals(f)
                && !"tar.bz2".equals(f) && !"tar.xz".equals(f) && !"7z".equals(f)) {
            throw new IllegalArgumentException("不支持的压缩格式：" + format);
        }
        return f;
    }

    private static String normalizeLevel(String level) {
        String l = level == null ? "normal" : level.trim().toLowerCase();
        if (!"store".equals(l) && !"fastest".equals(l) && !"normal".equals(l) && !"max".equals(l)) {
            throw new IllegalArgumentException("不支持的压缩级别：" + level);
        }
        return l;
    }

    private static int zipLevel(String level) {
        if ("store".equals(level)) {
            return 0;
        }
        if ("fastest".equals(level)) {
            return 1;
        }
        return "max".equals(level) ? 9 : 6;
    }

    private static int gzipLevel(String level) {
        if ("store".equals(level) || "fastest".equals(level)) {
            return 1;
        }
        return "max".equals(level) ? 9 : 6;
    }

    private static int bzip2Level(String level) {
        return gzipLevel(level);
    }

    private static int xzLevel(String level) {
        if ("store".equals(level)) {
            return 0;
        }
        if ("fastest".equals(level)) {
            return 1;
        }
        return "max".equals(level) ? 9 : 6;
    }

    private static int sevenLevel(String level) {
        if ("store".equals(level)) {
            return 0;
        }
        if ("fastest".equals(level)) {
            return 1;
        }
        return "max".equals(level) ? 9 : 5;
    }

    private static String extension(String format) {
        if ("tar.gz".equals(format)) {
            return "tar.gz";
        }
        if ("tar.bz2".equals(format)) {
            return "tar.bz2";
        }
        if ("tar.xz".equals(format)) {
            return "tar.xz";
        }
        if ("7z".equals(format)) {
            return "7z";
        }
        if ("tar".equals(format)) {
            return "tar";
        }
        return "zip";
    }

    private static String parentOf(String path) {
        int idx = path.lastIndexOf('/');
        return idx <= 0 ? "/" : path.substring(0, idx);
    }

    private static String join(String dir, String name) {
        return "/".equals(dir) ? "/" + name : dir + "/" + name;
    }

    private static String shq(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }
}
