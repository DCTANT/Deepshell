package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.FileSearchEntry;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
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

    /** shell 单引号转义 */
    private static String shq(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }
}
