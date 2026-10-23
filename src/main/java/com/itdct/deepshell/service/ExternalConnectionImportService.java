package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.common.RuntimeSupport;
import com.itdct.deepshell.entity.SshConnection;
import com.itdct.deepshell.repo.SshConnectionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 从本机 OpenSSH ~/.ssh/config 与 Windows PuTTY 会话扫描连接。
 * 只读本机配置、不读取密码；扫描和导入接口都只允许回环访问。
 * 私钥路径按运行 DeepShell 的这台机器解析；PuTTY 的 .ppk 会标记需要转换。
 */
@Slf4j
@Service
public class ExternalConnectionImportService {

    private final SshConnectionRepository repo;
    private final ObjectMapper om = new ObjectMapper();

    public ExternalConnectionImportService(SshConnectionRepository repo) {
        this.repo = repo;
    }

    public Map<String, Object> scan() {
        ScanData data = scanData();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ssh", sourceResult("ssh", sshConfigPath().toString(), true, data.ssh,
                data.sshMessage));
        result.put("putty", sourceResult("putty", "HKCU\\Software\\SimonTatham\\PuTTY\\Sessions",
                RuntimeSupport.isWindows(), data.putty, data.puttyMessage));
        return result;
    }

    /** 按扫描结果里的稳定 id 导入；服务端重新扫描，避免直接信任前端传入的地址 / 路径。 */
    public Map<String, Object> importSelected(List<String> ids, boolean skipDuplicates) {
        if (ids == null || ids.isEmpty()) {
            throw new IllegalArgumentException("请至少选择一条要导入的连接");
        }
        ScanData data = scanData();
        Map<String, Entry> byId = new LinkedHashMap<>();
        for (Entry e : data.ssh) {
            byId.put(e.id, e);
        }
        for (Entry e : data.putty) {
            byId.put(e.id, e);
        }
        int imported = 0;
        int skipped = 0;
        int failed = 0;
        Set<String> importedEndpoints = new LinkedHashSet<>();
        for (String id : ids) {
            Entry entry = byId.get(id);
            if (entry == null) {
                failed++;
                continue;
            }
            if (skipDuplicates && entry.duplicate) {
                skipped++;
                continue;
            }
            String endpoint = endpointKey(entry.host, entry.port, entry.username);
            if (skipDuplicates && importedEndpoints.contains(endpoint)) {
                skipped++;
                continue;
            }
            try {
                SshConnection c = toConnection(entry);
                repo.save(c);
                importedEndpoints.add(endpoint);
                imported++;
            } catch (Exception e) {
                failed++;
                log.warn("从 {} 导入连接失败: {}", entry.source, e.getMessage());
            }
        }
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("total", ids.size());
        r.put("imported", imported);
        r.put("skipped", skipped);
        r.put("failed", failed);
        StringBuilder msg = new StringBuilder("导入完成：成功 " + imported + " 条");
        if (skipped > 0) {
            msg.append("，跳过重复 ").append(skipped).append(" 条");
        }
        if (failed > 0) {
            msg.append("，失败 ").append(failed).append(" 条");
        }
        r.put("message", msg.toString());
        return r;
    }

    /* ---------------- 扫描数据 ---------------- */

    private static class ScanData {
        List<Entry> ssh = new ArrayList<>();
        List<Entry> putty = new ArrayList<>();
        String sshMessage = "";
        String puttyMessage = "";
    }

    private ScanData scanData() {
        ScanData data = new ScanData();
        List<SshConnection> existing = repo.findAllByOrderBySortOrderAscIdAsc();
        Path sshConfig = sshConfigPath();
        if (Files.isRegularFile(sshConfig)) {
            try {
                data.ssh = parseSshConfig(sshConfig);
                data.sshMessage = data.ssh.isEmpty()
                        ? "配置文件里没有找到可导入的 Host（通配符 * 规则不会导入）"
                        : "读取到 " + data.ssh.size() + " 个主机";
            } catch (Exception e) {
                data.sshMessage = "解析失败：" + e.getMessage();
            }
        } else {
            data.sshMessage = "未找到 " + sshConfig + "；先用 ssh 命令连接过一次服务器，或手动创建该文件";
        }
        if (RuntimeSupport.isWindows()) {
            try {
                data.putty = parsePutty();
                data.puttyMessage = data.putty.isEmpty()
                        ? "没有找到带 HostName 的 PuTTY 会话"
                        : "读取到 " + data.putty.size() + " 个会话";
            } catch (Exception e) {
                data.puttyMessage = "读取 PuTTY 会话失败：" + e.getMessage();
            }
        } else {
            data.puttyMessage = "PuTTY 导入仅支持 Windows";
        }
        markDuplicates(data.ssh, existing);
        markDuplicates(data.putty, existing);
        return data;
    }

    private static void markDuplicates(List<Entry> entries, List<SshConnection> existing) {
        Set<String> seen = new LinkedHashSet<>();
        for (Entry e : entries) {
            String key = endpointKey(e.host, e.port, e.username);
            if (!seen.add(key)) {
                e.duplicate = true;
                e.warnings.add("本次扫描里还有一台相同地址 / 用户的连接");
                continue;
            }
            for (SshConnection c : existing) {
                if (endpointKey(c.getHost(), c.getPort() == null ? 22 : c.getPort(),
                        c.getUsername()).equals(key)) {
                    e.duplicate = true;
                    e.existingId = c.getId();
                    e.existingName = c.getName();
                    break;
                }
            }
        }
    }

    private static String endpointKey(String host, int port, String username) {
        return String.valueOf(host == null ? "" : host.trim().toLowerCase(Locale.ROOT))
                + "|" + port + "|" + (username == null ? "" : username.trim().toLowerCase(Locale.ROOT));
    }

    private static Map<String, Object> sourceResult(String source, String path, boolean supported,
                                                    List<Entry> entries, String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("source", source);
        m.put("path", path);
        m.put("supported", supported);
        m.put("entries", entries);
        m.put("message", message);
        return m;
    }

    /* ---------------- OpenSSH config ---------------- */

    public static Path sshConfigPath() {
        return Paths.get(System.getProperty("user.home"), ".ssh", "config")
                .toAbsolutePath().normalize();
    }

    private List<Entry> parseSshConfig(Path root) throws Exception {
        List<SshBlock> blocks = new ArrayList<>();
        parseSshFile(root, blocks, new LinkedHashSet<Path>(), 0);
        List<Entry> entries = new ArrayList<>();
        for (SshBlock block : blocks) {
            Entry e = toEntry(block, root);
            if (e != null) {
                entries.add(e);
            }
        }
        return entries;
    }

    private static class SshBlock {
        List<String> patterns = new ArrayList<>();
        Map<String, List<String>> options = new LinkedHashMap<>();
        Map<String, List<String>> defaults = new LinkedHashMap<>();
        boolean match;

        String first(String key) {
            List<String> v = options.get(key);
            if (v == null || v.isEmpty()) {
                v = defaults.get(key);
            }
            return v == null || v.isEmpty() ? "" : v.get(0).trim();
        }

        List<String> all(String key) {
            List<String> out = new ArrayList<>();
            List<String> v = options.get(key);
            if (v != null) {
                out.addAll(v);
            }
            if (out.isEmpty()) {
                List<String> d = defaults.get(key);
                if (d != null) {
                    out.addAll(d);
                }
            }
            return out;
        }
    }

    private void parseSshFile(Path file, List<SshBlock> blocks, Set<Path> visited, int depth)
            throws Exception {
        if (depth > 5) {
            return;
        }
        Path real = file.toAbsolutePath().normalize();
        if (!visited.add(real) || !Files.isRegularFile(real)) {
            return;
        }
        List<String> lines;
        try {
            lines = Files.readAllLines(real, StandardCharsets.UTF_8);
        } catch (Exception e) {
            lines = Files.readAllLines(real, Charset.defaultCharset());
        }
        Map<String, List<String>> defaults = new LinkedHashMap<>();
        SshBlock current = null;
        boolean inMatch = false;
        for (String raw : lines) {
            String line = raw == null ? "" : raw;
            if (!line.isEmpty() && line.charAt(0) == '\uFEFF') {
                line = line.substring(1);
            }
            List<String> tokens = splitConfigLine(line);
            if (tokens.isEmpty()) {
                continue;
            }
            String key = tokens.get(0).toLowerCase(Locale.ROOT);
            List<String> values = new ArrayList<>(tokens.subList(1, tokens.size()));
            if ("host".equals(key)) {
                flushBlock(current, blocks);
                current = new SshBlock();
                current.patterns.addAll(values);
                current.defaults.putAll(defaults);
                current.match = false;
                inMatch = false;
                continue;
            }
            if ("match".equals(key)) {
                flushBlock(current, blocks);
                current = null;
                inMatch = true;
                continue;
            }
            if ("include".equals(key)) {
                if (current == null && !inMatch) {
                    for (String pattern : values) {
                        for (Path included : expandInclude(real.getParent(), pattern)) {
                            parseSshFile(included, blocks, visited, depth + 1);
                        }
                    }
                }
                continue;
            }
            if (inMatch) {
                continue;
            }
            if (current == null) {
                addOption(defaults, key, values);
            } else {
                addOption(current.options, key, values);
            }
        }
        flushBlock(current, blocks);
    }

    /** OpenSSH 配置分词：支持引号、行尾注释与 Key=Value 写法。 */
    static List<String> splitConfigLine(String line) {
        List<String> tokens = new ArrayList<>();
        if (line == null) {
            return tokens;
        }
        StringBuilder cur = new StringBuilder();
        char quote = 0;
        for (int i = 0; i < line.length(); i++) {
            char ch = line.charAt(i);
            if (quote != 0) {
                if (ch == quote) {
                    quote = 0;
                } else if (ch == '\\' && i + 1 < line.length()) {
                    cur.append(line.charAt(++i));
                } else {
                    cur.append(ch);
                }
                continue;
            }
            if (ch == '\'' || ch == '"') {
                quote = ch;
                continue;
            }
            if (ch == '#') {
                // 只有出现在行首或空白之后的 # 才是注释
                if (cur.length() == 0) {
                    break;
                }
                cur.append(ch);
                continue;
            }
            if (Character.isWhitespace(ch)) {
                if (cur.length() > 0) {
                    tokens.add(cur.toString());
                    cur.setLength(0);
                }
                continue;
            }
            cur.append(ch);
        }
        if (cur.length() > 0) {
            tokens.add(cur.toString());
        }
        if (!tokens.isEmpty() && tokens.get(0).indexOf('=') > 0) {
            String first = tokens.get(0);
            int eq = first.indexOf('=');
            String key = first.substring(0, eq);
            String value = first.substring(eq + 1);
            tokens.set(0, key);
            if (!value.isEmpty()) {
                tokens.add(1, value);
            }
        }
        return tokens;
    }

    private static void addOption(Map<String, List<String>> map, String key, List<String> values) {
        List<String> list = map.get(key);
        if (list == null) {
            list = new ArrayList<>();
            map.put(key, list);
        }
        list.addAll(values);
    }

    private static void flushBlock(SshBlock block, List<SshBlock> blocks) {
        if (block != null && !block.patterns.isEmpty()) {
            blocks.add(block);
        }
    }

    private static Entry toEntry(SshBlock block, Path configFile) {
        String alias = null;
        for (String pattern : block.patterns) {
            String p = pattern == null ? "" : pattern.trim();
            if (p.isEmpty()) {
                continue;
            }
            if (p.startsWith("!")) {
                continue;
            }
            if (p.indexOf('*') >= 0 || p.indexOf('?') >= 0 || p.indexOf('[') >= 0) {
                continue;
            }
            alias = p;
            break;
        }
        if (alias == null) {
            return null;
        }
        String host = block.first("hostname");
        if (host.isEmpty()) {
            host = alias;
        }
        String username = block.first("user");
        if (username.isEmpty()) {
            username = System.getProperty("user.name", "");
        }
        int port = parseInt(block.first("port"), 22);
        if (host.indexOf('%') >= 0) {
            host = host.replace("%h", alias).replace("%p", String.valueOf(port))
                    .replace("%r", username).replace("%d", System.getProperty("user.home"));
        }
        String keyPath = "";
        boolean keyFound = false;
        List<String> identityFiles = block.all("identityfile");
        List<String> warnings = new ArrayList<>();
        for (String identity : identityFiles) {
            String expanded = expandHome(identity.trim()
                    .replace("%h", alias).replace("%p", String.valueOf(port))
                    .replace("%r", username));
            if (expanded.isEmpty() || "none".equalsIgnoreCase(expanded)) {
                continue;
            }
            Path key = Paths.get(expanded);
            if (!keyFound) {
                keyPath = key.toAbsolutePath().normalize().toString();
                keyFound = true;
            }
            if (!Files.isRegularFile(key)) {
                warnings.add("私钥文件不存在：" + key);
            }
        }
        String proxyJump = block.first("proxyjump");
        if (!proxyJump.isEmpty() && !"none".equalsIgnoreCase(proxyJump)) {
            warnings.add("配置里的 ProxyJump（" + proxyJump + "）暂未导入，请在 DeepShell 里选择跳板机");
        }
        String proxyCommand = block.first("proxycommand");
        if (!proxyCommand.isEmpty() && !"none".equalsIgnoreCase(proxyCommand)) {
            warnings.add("配置里的 ProxyCommand 暂未导入");
        }
        String authType = keyFound ? "KEY" : "PASSWORD";
        if (!keyFound) {
            warnings.add("配置里没有 IdentityFile，导入后需要填写密码或补私钥");
        }
        Entry e = new Entry();
        e.source = "ssh";
        e.name = alias;
        e.host = host;
        e.port = port;
        e.username = username;
        e.authType = authType;
        e.keyPath = keyPath;
        e.proxyType = "NONE";
        e.remark = "从 ~/.ssh/config 导入（Host " + alias + "）";
        e.warnings.addAll(warnings);
        e.id = entryId(e);
        return e;
    }

    private static List<Path> expandInclude(Path baseDir, String pattern) throws Exception {
        String p = pattern == null ? "" : pattern.trim();
        if (p.isEmpty()) {
            return new ArrayList<>();
        }
        p = expandHome(p);
        Path path = Paths.get(p);
        if (!path.isAbsolute() && baseDir != null) {
            path = baseDir.resolve(path);
        }
        String text = path.toString();
        if (text.indexOf('*') < 0 && text.indexOf('?') < 0 && text.indexOf('[') < 0) {
            List<Path> one = new ArrayList<>();
            if (Files.isRegularFile(path)) {
                one.add(path);
            }
            return one;
        }
        Path parent = path.getParent();
        if (parent == null || !Files.isDirectory(parent)) {
            return new ArrayList<>();
        }
        String namePattern = path.getFileName().toString();
        PathMatcher matcher = FileSystems.getDefault().getPathMatcher("glob:" + namePattern);
        List<Path> files = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(parent)) {
            for (Path file : stream) {
                if (Files.isRegularFile(file) && matcher.matches(file.getFileName())) {
                    files.add(file);
                }
            }
        }
        files.sort((a, b) -> a.toString().compareToIgnoreCase(b.toString()));
        return files;
    }

    private static String expandHome(String value) {
        String v = value == null ? "" : value.trim();
        if (v.startsWith("~/") || v.equals("~")) {
            return Paths.get(System.getProperty("user.home"),
                    v.length() > 2 ? v.substring(2) : "").toString();
        }
        return v.replace("%d", System.getProperty("user.home"));
    }

    /* ---------------- PuTTY ---------------- */

    private List<Entry> parsePutty() throws Exception {
        if (!RuntimeSupport.isWindows()) {
            return new ArrayList<>();
        }
        String script = "$ErrorActionPreference='SilentlyContinue'\n"
                + "$ProgressPreference='SilentlyContinue'\n"
                + "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n"
                + "$base='HKCU:\\Software\\SimonTatham\\PuTTY\\Sessions'\n"
                + "$items=@()\n"
                + "Get-ChildItem $base | ForEach-Object {\n"
                + "  $p=Get-ItemProperty $_.PSPath\n"
                + "  $items += [pscustomobject]@{ name=$_.PSChildName; HostName=$p.HostName;"
                + " UserName=$p.UserName; PortNumber=$p.PortNumber; PublicKeyFile=$p.PublicKeyFile;"
                + " ProxyHost=$p.ProxyHost; ProxyPort=$p.ProxyPort; ProxyMethod=$p.ProxyMethod;"
                + " ProxyUsername=$p.ProxyUsername }\n"
                + "}\n"
                + "@($items) | ConvertTo-Json -Compress\n";
        String json = execPutty(script);
        if (json == null || json.trim().isEmpty()) {
            return new ArrayList<>();
        }
        JsonNode root = om.readTree(json);
        if (root.isObject()) {
            // ConvertTo-Json 对单个对象不会输出数组
            JsonNode tmp = om.createArrayNode().add(root);
            root = tmp;
        }
        List<Entry> entries = new ArrayList<>();
        if (!root.isArray()) {
            return entries;
        }
        for (JsonNode n : root) {
            String name = decodePuttyName(text(n, "name"));
            String host = text(n, "HostName");
            if (host.trim().isEmpty()) {
                continue;
            }
            String username = text(n, "UserName");
            if (username.trim().isEmpty()) {
                username = System.getProperty("user.name", "");
            }
            int port = n.path("PortNumber").isNumber()
                    ? n.path("PortNumber").asInt(22) : parseInt(text(n, "PortNumber"), 22);
            String keyPath = text(n, "PublicKeyFile").trim();
            List<String> warnings = new ArrayList<>();
            String authType = keyPath.isEmpty() ? "PASSWORD" : "KEY";
            if (keyPath.toLowerCase(Locale.ROOT).endsWith(".ppk")) {
                warnings.add("PuTTY 的 .ppk 私钥不能直接使用：请用 PuTTYgen 转成 OpenSSH，或改填 OpenSSH 私钥路径");
            }
            if (keyPath.isEmpty()) {
                warnings.add("PuTTY 不保存密码；导入后请编辑连接补全密码");
            }
            int proxyMethod = n.path("ProxyMethod").isNumber()
                    ? n.path("ProxyMethod").asInt(0) : parseInt(text(n, "ProxyMethod"), 0);
            String proxyType = "NONE";
            String proxyHost = text(n, "ProxyHost").trim();
            int proxyPort = n.path("ProxyPort").isNumber()
                    ? n.path("ProxyPort").asInt(0) : parseInt(text(n, "ProxyPort"), 0);
            if (proxyMethod == 2) {
                proxyType = "SOCKS5";
            } else if (proxyMethod == 3) {
                proxyType = "HTTP";
            } else if (proxyMethod != 0 && !proxyHost.isEmpty()) {
                warnings.add("PuTTY 的代理类型 " + proxyMethod + " 暂不支持，已按直连导入");
            }
            if (!proxyHost.isEmpty() && !"NONE".equals(proxyType)) {
                warnings.add("代理密码不会从 PuTTY 读取，导入后请按需补填");
            }
            Entry e = new Entry();
            e.source = "putty";
            e.name = name.isEmpty() ? host : name;
            e.host = host;
            e.port = port;
            e.username = username;
            e.authType = authType;
            e.keyPath = keyPath;
            e.proxyType = proxyType;
            e.proxyHost = proxyHost;
            e.proxyPort = proxyPort > 0 ? proxyPort : ("SOCKS5".equals(proxyType) ? 1080 : 8080);
            e.proxyUsername = text(n, "ProxyUsername").trim();
            e.remark = "从 PuTTY 会话「" + e.name + "」导入";
            e.warnings.addAll(warnings);
            e.id = entryId(e);
            entries.add(e);
        }
        return entries;
    }

    private static String execPutty(String script) throws Exception {
        String encoded = java.util.Base64.getEncoder().encodeToString(
                script.getBytes(StandardCharsets.UTF_16LE));
        Path errFile = Files.createTempFile("deepshell-putty-", ".err");
        try {
            ProcessBuilder pb = new ProcessBuilder("powershell.exe", "-NoProfile",
                    "-NonInteractive", "-ExecutionPolicy", "Bypass",
                    "-EncodedCommand", encoded);
            // PowerShell 的进度流会输出 CLIXML 到 stderr，不能混进 JSON
            pb.redirectError(errFile.toFile());
            Process process = pb.start();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = process.getInputStream()) {
                byte[] buf = new byte[2048];
                int n;
                while ((n = in.read(buf)) >= 0) {
                    out.write(buf, 0, n);
                }
            }
            int code = process.waitFor();
            String text = new String(out.toByteArray(), StandardCharsets.UTF_8).trim();
            if (code != 0 && text.isEmpty()) {
                String err = "";
                try {
                    err = new String(Files.readAllBytes(errFile), StandardCharsets.UTF_8).trim();
                } catch (Exception ignore) {
                    // 只返回退出码
                }
                throw new IOException("PowerShell 返回 " + code
                        + (err.isEmpty() ? "" : "：" + err.replace('\r', ' ').replace('\n', ' ')));
            }
            return text;
        } finally {
            try {
                Files.deleteIfExists(errFile);
            } catch (Exception ignore) {
                // 临时文件残留不影响功能
            }
        }
    }

    private static String decodePuttyName(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        try {
            return URLDecoder.decode(value.replace("+", "%2B"), "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }

    private static String text(JsonNode n, String key) {
        JsonNode v = n.get(key);
        if (v == null || v.isNull()) {
            return "";
        }
        return v.asText("");
    }

    /* ---------------- 通用 ---------------- */

    private static SshConnection toConnection(Entry e) {
        SshConnection c = new SshConnection();
        c.setName(trimTo(e.name, e.host));
        c.setHost(e.host);
        c.setPort(e.port <= 0 ? 22 : e.port);
        c.setUsername(e.username);
        c.setAuthType("KEY".equalsIgnoreCase(e.authType) ? "KEY" : "PASSWORD");
        c.setKeyPath(e.keyPath);
        c.setProxyType(e.proxyType == null ? "NONE" : e.proxyType);
        c.setProxyHost(e.proxyHost);
        c.setProxyPort(e.proxyPort);
        c.setProxyUsername(e.proxyUsername);
        c.setPersistSession(Boolean.TRUE);
        c.setRemark(e.remark);
        return c;
    }

    private static String trimTo(String value, String fallback) {
        String v = value == null ? "" : value.trim();
        if (v.isEmpty()) {
            return fallback;
        }
        return v.length() > 100 ? v.substring(0, 100) : v;
    }

    private static int parseInt(String value, int def) {
        try {
            return Integer.parseInt(value == null ? "" : value.trim());
        } catch (Exception e) {
            return def;
        }
    }

    private static String entryId(Entry e) {
        String raw = e.source + "|" + e.name + "|" + e.host + "|" + e.port + "|"
                + e.username + "|" + (e.keyPath == null ? "" : e.keyPath);
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(e.source).append(':');
            for (int i = 0; i < 8; i++) {
                sb.append(String.format(Locale.ROOT, "%02x", digest[i]));
            }
            return sb.toString();
        } catch (Exception ex) {
            return e.source + ":" + Integer.toHexString(raw.hashCode());
        }
    }

    public static class Entry {
        public String id;
        public String source;
        public String name;
        public String host;
        public int port = 22;
        public String username;
        public String authType = "PASSWORD";
        public String keyPath = "";
        public String proxyType = "NONE";
        public String proxyHost = "";
        public int proxyPort;
        public String proxyUsername = "";
        public String remark = "";
        public List<String> warnings = new ArrayList<>();
        public boolean duplicate;
        public Long existingId;
        public String existingName;
    }
}
