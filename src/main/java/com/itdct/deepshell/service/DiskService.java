package com.itdct.deepshell.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 目录磁盘占用分析（WizTree 式下钻）：对指定目录跑一次
 * `du -x -k --max-depth=1` 得到每个直接子项的递归大小（目录与文件都会列出），
 * 再用 find 标记哪些子项是目录，Java 侧排序并计算占比。
 * 不跨文件系统挂载点（-x）；
 */
@Service
public class DiskService {

    private static final int MAX_ENTRIES = 500;

    private final SshSessionManager sessions;

    public DiskService(SshSessionManager sessions) {
        this.sessions = sessions;
    }

    public Map<String, Object> analyze(String sessionId, String path) throws Exception {
        if (path == null || path.trim().isEmpty()) {
            throw new IllegalArgumentException("请输入要分析的目录");
        }
        String p = path.trim();
        if (p.contains("\n") || p.contains("\r")) {
            throw new IllegalArgumentException("路径不合法");
        }
        SshSessionManager.SshSession s = sessions.get(sessionId);
        String script = "export LC_ALL=C 2>/dev/null; export LANG=C 2>/dev/null; "
                + "echo __DU__; du -a -x -k --max-depth=1 " + shq(p) + " 2>/dev/null; "
                + "echo __DIRS__; find " + shq(p) + " -maxdepth 1 -mindepth 1 -type d 2>/dev/null";
        String raw = sessions.execCapture(s, script, 180000);
        return parse(raw, p);
    }

    /** 供单元测试：解析脚本输出 */
    public static Map<String, Object> parse(String raw, String rawPath) {
        if (raw == null || !raw.contains("__DU__") || !raw.contains("__DIRS__")) {
            throw new IllegalStateException("目录分析失败（路径不存在或无权限）");
        }
        String duPart = raw.substring(raw.indexOf("__DU__") + "__DU__".length(), raw.indexOf("__DIRS__"));
        String dirsPart = raw.substring(raw.indexOf("__DIRS__") + "__DIRS__".length());
        String parent = normalize(rawPath);

        Set<String> dirs = new HashSet<>();
        for (String line : dirsPart.split("\n")) {
            String t = line.trim();
            if (!t.isEmpty()) {
                dirs.add(t);
            }
        }

        long total = 0;
        long sumChildren = 0;
        List<Map<String, Object>> entries = new ArrayList<>();
        Pattern linePat = Pattern.compile("^(\\d+)\\s+(.+)$");
        for (String line : duPart.split("\n")) {
            String t = line.trim();
            if (t.isEmpty()) {
                continue;
            }
            Matcher m = linePat.matcher(t);
            if (!m.matches()) {
                continue;
            }
            long sizeKb;
            try {
                sizeKb = Long.parseLong(m.group(1));
            } catch (NumberFormatException e) {
                continue;
            }
            String childPath = m.group(2).trim();
            if (normalize(childPath).equals(parent)) {
                total = sizeKb;
                continue;
            }
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("name", childName(parent, childPath));
            e.put("path", childPath);
            e.put("dir", dirs.contains(childPath));
            e.put("sizeKb", sizeKb);
            entries.add(e);
            sumChildren += sizeKb;
        }
        if (total <= 0) {
            total = sumChildren;
        }
        entries.sort(Comparator.comparingLong((Map<String, Object> e) -> (Long) e.get("sizeKb")).reversed());
        boolean truncated = entries.size() > MAX_ENTRIES;
        if (truncated) {
            entries = new ArrayList<>(entries.subList(0, MAX_ENTRIES));
        }
        for (Map<String, Object> e : entries) {
            long kb = (Long) e.get("sizeKb");
            double pct = total > 0 ? Math.round(kb * 1000.0 / total) / 10.0 : 0;
            e.put("pct", pct);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("path", rawPath);
        result.put("totalKb", total);
        result.put("truncated", truncated);
        result.put("entries", entries);
        return result;
    }

    /** 去掉末尾斜杠（根目录保留为 "/"） */
    static String normalize(String p) {
        String t = p == null ? "" : p.trim();
        while (t.length() > 1 && t.endsWith("/")) {
            t = t.substring(0, t.length() - 1);
        }
        return t;
    }

    static String childName(String parent, String childPath) {
        String p = normalize(childPath);
        if ("/".equals(parent)) {
            return p.length() > 1 ? p.substring(1) : p;
        }
        if (p.startsWith(parent + "/")) {
            return p.substring(parent.length() + 1);
        }
        int idx = p.lastIndexOf('/');
        return idx >= 0 ? p.substring(idx + 1) : p;
    }

    /** shell 单引号转义，路径可含空格等特殊字符 */
    static String shq(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }
}
