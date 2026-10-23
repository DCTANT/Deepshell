package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.FileChecksumResult;
import com.itdct.deepshell.dto.FileContentMatch;
import com.itdct.deepshell.dto.FileSearchEntry;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 开始菜单的服务器文件搜索：在指定目录下有限深度查找名称匹配的文件 / 文件夹。
 * 使用独立 exec 通道，不影响终端与 SFTP；结果与搜索深度都有上限，避免大目录拖垮连接。
 */
@Service
public class FileSearchService {

    private static final int MAX_DEPTH = 6;
    private static final int MAX_KEYWORD = 100;
    private static final int MAX_LIMIT = 200;
    private static final long TIMEOUT_MS = 15000;
    private static final int MAX_CONTENT_KEYWORD = 200;
    private static final int MAX_CONTENT_LIMIT = 300;
    private static final long CONTENT_TIMEOUT_MS = 30000;
    private static final long CHECKSUM_TIMEOUT_MS = 120000;
    private static final int MAX_MATCH_TEXT = 600;
    private static final String MISSING_MARK = "__DS_MISSING_CMD__";

    private static final String DIRS_MARK = "__DS_DIRS__";
    private static final String FILES_MARK = "__DS_FILES__";
    private static final String END_MARK = "__DS_END__";

    private final SshSessionManager sessions;

    public FileSearchService(SshSessionManager sessions) {
        this.sessions = sessions;
    }

    public List<FileSearchEntry> search(String sessionId, String root, String keyword, int limit) throws Exception {
        if (keyword == null || keyword.trim().isEmpty()) {
            return new ArrayList<>();
        }
        String kw = keyword.trim();
        if (kw.length() > MAX_KEYWORD) {
            throw new IllegalArgumentException("搜索关键字过长（最多 " + MAX_KEYWORD + " 个字符）");
        }
        if (kw.contains("\n") || kw.contains("\r")) {
            throw new IllegalArgumentException("搜索关键字不合法");
        }
        String base = root == null || root.trim().isEmpty() ? "/" : root.trim();
        if (!base.startsWith("/") || base.contains("\n") || base.contains("\r")) {
            throw new IllegalArgumentException("搜索目录不合法");
        }
        int max = limit <= 0 ? 100 : Math.min(limit, MAX_LIMIT);
        String pattern = "*" + kw + "*";
        String script = "export LC_ALL=C 2>/dev/null; export LANG=C 2>/dev/null; "
                + "echo " + DIRS_MARK + "; "
                + "find " + shq(base) + " -mindepth 1 -maxdepth " + MAX_DEPTH
                + " -type d -iname " + shq(pattern) + " 2>/dev/null | head -n " + max + "; "
                + "echo " + FILES_MARK + "; "
                + "find " + shq(base) + " -mindepth 1 -maxdepth " + MAX_DEPTH
                + " -type f -iname " + shq(pattern) + " 2>/dev/null | head -n " + max + "; "
                + "echo " + END_MARK;
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String raw = sessions.execCapture(s, script, TIMEOUT_MS);
        return parse(raw, max);
    }

    /** 供单元测试 / 调试：解析 find 输出 */
    static List<FileSearchEntry> parse(String raw, int max) {
        List<FileSearchEntry> out = new ArrayList<>();
        if (raw == null || raw.isEmpty()) {
            return out;
        }
        int d = raw.indexOf(DIRS_MARK);
        int f = raw.indexOf(FILES_MARK);
        int e = raw.indexOf(END_MARK);
        if (d < 0 || f < 0) {
            return out;
        }
        String dirs = raw.substring(d + DIRS_MARK.length(), f);
        String files = raw.substring(f + FILES_MARK.length(), e > f ? e : raw.length());
        Set<String> seen = new LinkedHashSet<>();
        addLines(out, seen, dirs, true, max);
        addLines(out, seen, files, false, max);
        return out;
    }

    private static void addLines(List<FileSearchEntry> out, Set<String> seen,
                                 String text, boolean dir, int max) {
        String[] lines = text.split("\n");
        for (String line : lines) {
            if (out.size() >= max) {
                return;
            }
            String p = line.replace("\r", "");
            if (p.isEmpty() || !p.startsWith("/") || seen.contains(p)) {
                continue;
            }
            int idx = p.lastIndexOf('/');
            String name = idx >= 0 ? p.substring(idx + 1) : p;
            if (name.isEmpty()) {
                continue;
            }
            seen.add(p);
            out.add(new FileSearchEntry(name, p, dir));
        }
    }

    /**
     * 在目录子树中搜索文件内容（grep -r）。只返回文本文件的命中行，
     * 使用 NUL 分隔文件名，避免路径中包含冒号时解析错误。
     */
    public List<FileContentMatch> contentSearch(String sessionId, String root, String keyword,
                                                String include, boolean caseSensitive, int limit)
            throws Exception {
        if (keyword == null || keyword.trim().isEmpty()) {
            return new ArrayList<>();
        }
        String kw = keyword.trim();
        if (kw.length() > MAX_CONTENT_KEYWORD) {
            throw new IllegalArgumentException("搜索关键字过长（最多 " + MAX_CONTENT_KEYWORD + " 个字符）");
        }
        if (kw.contains("\n") || kw.contains("\r") || kw.contains("\0")) {
            throw new IllegalArgumentException("搜索关键字不合法");
        }
        String base = root == null || root.trim().isEmpty() ? "/" : root.trim();
        if (!base.startsWith("/") || base.contains("\n") || base.contains("\r")) {
            throw new IllegalArgumentException("搜索目录不合法");
        }
        int max = limit <= 0 ? 100 : Math.min(limit, MAX_CONTENT_LIMIT);
        StringBuilder cmd = new StringBuilder();
        cmd.append("export LC_ALL=C 2>/dev/null; export LANG=C 2>/dev/null; ");
        cmd.append("grep -rInZF --binary-files=without-match");
        cmd.append(" --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg");
        cmd.append(" --exclude-dir=node_modules --exclude-dir=target --exclude-dir=dist");
        cmd.append(" --exclude-dir=.idea --exclude-dir=__pycache__");
        if (!caseSensitive) {
            cmd.append(" -i");
        }
        for (String pattern : includePatterns(include)) {
            cmd.append(" --include=").append(shq(pattern));
        }
        cmd.append(" -e ").append(shq(kw)).append(" -- ").append(shq(base));
        cmd.append(" 2>/dev/null | head -n ").append(max);
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String raw = sessions.execCapture(s, cmd.toString(), CONTENT_TIMEOUT_MS);
        return parseGrep(raw, max);
    }

    /** 远程文件校验和：优先使用系统自带命令，缺少命令时返回明确错误。 */
    public FileChecksumResult checksum(String sessionId, String path, String algorithm) throws Exception {
        String alg = normalizeAlgorithm(algorithm);
        if (path == null || path.trim().isEmpty() || !path.startsWith("/")
                || path.contains("\n") || path.contains("\r")) {
            throw new IllegalArgumentException("文件路径不合法");
        }
        String tool = "md5".equals(alg) ? "md5sum" : ("sha1".equals(alg) ? "sha1sum" : "sha256sum");
        String command = "if command -v " + tool + " >/dev/null 2>&1; then "
                + tool + " -- " + shq(path) + " 2>/dev/null; else echo " + MISSING_MARK + "; fi";
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String raw = sessions.execCapture(s, command, CHECKSUM_TIMEOUT_MS);
        String out = raw == null ? "" : raw.trim();
        if (out.contains(MISSING_MARK)) {
            throw new IllegalStateException("服务器未安装 " + tool + "，无法计算校验和");
        }
        String value = "";
        for (String token : out.split("\\s+")) {
            if (token.matches("(?i)[0-9a-f]{" + ("md5".equals(alg) ? 32 : ("sha1".equals(alg) ? 40 : 64)) + "}")) {
                value = token.toLowerCase(Locale.ROOT);
                break;
            }
        }
        if (value.isEmpty()) {
            throw new IllegalStateException("无法读取文件或计算校验和失败");
        }
        return new FileChecksumResult(path, alg, value);
    }

    static String normalizeAlgorithm(String algorithm) {
        String alg = algorithm == null ? "" : algorithm.trim().toLowerCase(Locale.ROOT);
        if ("md5".equals(alg) || "sha1".equals(alg) || "sha256".equals(alg)) {
            return alg;
        }
        throw new IllegalArgumentException("不支持的校验算法");
    }

    private static List<String> includePatterns(String include) {
        List<String> out = new ArrayList<>();
        if (include == null) {
            return out;
        }
        String[] parts = include.split("[,;\\s]+");
        for (String part : parts) {
            String p = part.trim();
            if (!p.isEmpty() && p.length() <= 120 && !p.contains("/") && !p.contains("\\")) {
                out.add(p);
            }
            if (out.size() >= 8) {
                break;
            }
        }
        return out;
    }

    /** 供单元测试 / 调试：解析 grep -Z 输出 */
    static List<FileContentMatch> parseGrep(String raw, int max) {
        List<FileContentMatch> out = new ArrayList<>();
        if (raw == null || raw.isEmpty()) {
            return out;
        }
        int pos = 0;
        while (pos < raw.length() && out.size() < max) {
            int nul = raw.indexOf('\0', pos);
            if (nul < 0) {
                break;
            }
            String path = raw.substring(pos, nul).replace("\r", "");
            int eol = raw.indexOf('\n', nul + 1);
            String record = raw.substring(nul + 1, eol < 0 ? raw.length() : eol).replace("\r", "");
            pos = eol < 0 ? raw.length() : eol + 1;
            int colon = record.indexOf(':');
            if (path.isEmpty() || colon <= 0) {
                continue;
            }
            int line;
            try {
                line = Integer.parseInt(record.substring(0, colon));
            } catch (NumberFormatException e) {
                continue;
            }
            String text = record.substring(colon + 1);
            if (text.length() > MAX_MATCH_TEXT) {
                text = text.substring(0, MAX_MATCH_TEXT) + "…";
            }
            out.add(new FileContentMatch(path, line, text));
        }
        return out;
    }

    /** shell 单引号转义 */
    private static String shq(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }
}
