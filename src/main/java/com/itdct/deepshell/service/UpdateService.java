package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.common.AppRestartSupport;
import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.common.RuntimeSupport;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 绿色版自动更新：读取 Gitee Releases 最新版本 → 下载绿色版 ZIP → 校验发布方提供的 SHA256 →
 * 退出后用 PowerShell / sh 助手替换程序文件并重新启动；data 与 application.yml 始终保留。
 */
@Slf4j
@Service
public class UpdateService implements ApplicationListener<ApplicationReadyEvent> {

    private static final Pattern SHA256_PATTERN = Pattern.compile("[a-fA-F0-9]{64}");
    private static final long AUTO_CHECK_DELAY_MS = 15_000L;

    @Value("${deepshell.version:1.6.0}")
    private String currentVersion;

    @Value("${deepshell.update.enabled:true}")
    private boolean enabled;

    @Value("${deepshell.update.gitee-owner:decentant}")
    private String giteeOwner;

    @Value("${deepshell.update.gitee-repo:deepshell}")
    private String giteeRepo;

    @Value("${deepshell.update.check-interval-hours:24}")
    private int checkIntervalHours;

    private final AppPrefsService prefs;
    private final WorkspaceEventService events;
    private final RestTemplate rest;
    private final ObjectMapper om = new ObjectMapper();
    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "deepshell-update");
        t.setDaemon(true);
        return t;
    });

    private volatile Map<String, Object> lastCheck;
    private volatile DownloadState download = new DownloadState();
    private volatile long lastAutoCheckStart;

    public UpdateService(AppPrefsService prefs, WorkspaceEventService events) {
        this.prefs = prefs;
        this.events = events;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(25_000);
        this.rest = new RestTemplate(factory);
    }

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        Thread t = new Thread(() -> {
            try {
                Thread.sleep(AUTO_CHECK_DELAY_MS);
                autoCheckIfDue();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                log.debug("自动检查更新失败: {}", e.getMessage());
            }
        }, "update-auto-check");
        t.setDaemon(true);
        t.start();
    }

    public void autoCheckIfDue() {
        if (!enabled || !prefs.autoUpdateCheck()) {
            return;
        }
        long interval = Math.max(1, checkIntervalHours) * 3600_000L;
        if (System.currentTimeMillis() - prefs.lastUpdateCheck() < interval) {
            return;
        }
        synchronized (this) {
            if (System.currentTimeMillis() - lastAutoCheckStart < interval) {
                return;
            }
            lastAutoCheckStart = System.currentTimeMillis();
        }
        Map<String, Object> result = check();
        if (Boolean.TRUE.equals(result.get("updateAvailable"))) {
            events.broadcastUpdate(result);
        }
    }

    public synchronized Map<String, Object> check() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("currentVersion", currentVersion);
        result.put("autoUpdateSupported", RuntimeSupport.isPackaged());
        if (!enabled) {
            result.put("ok", false);
            result.put("message", "自动更新已在配置中关闭");
            return result;
        }
        String api = "https://gitee.com/api/v5/repos/" + giteeOwner + "/" + giteeRepo
                + "/releases/latest";
        String json;
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("User-Agent", "DeepShell-" + currentVersion);
            json = rest.exchange(URI.create(api), HttpMethod.GET, new HttpEntity<>(headers),
                    String.class).getBody();
        } catch (HttpStatusCodeException e) {
            result.put("ok", false);
            result.put("message", "读取 Gitee 发布信息失败（HTTP " + e.getStatusCode().value() + "）");
            return result;
        } catch (Exception e) {
            result.put("ok", false);
            result.put("message", "检查更新失败：" + shortMessage(e));
            return result;
        }
        try {
            JsonNode root = om.readTree(json == null ? "{}" : json);
            String tag = text(root, "tag_name");
            String latest = normalizeVersion(tag);
            if (latest.isEmpty()) {
                result.put("ok", false);
                result.put("message", "Gitee 最新发布没有版本号");
                return result;
            }
            boolean available = compareVersion(latest, currentVersion) > 0;
            String releaseName = text(root, "name");
            String notes = text(root, "body");
            String publishedAt = text(root, "created_at");
            JsonNode assets = root.path("assets");
            Asset chosen = chooseAsset(assets, latest);
            Asset checksum = chooseChecksum(assets, chosen);
            result.put("ok", true);
            result.put("latestVersion", latest);
            result.put("tag", tag);
            result.put("releaseName", releaseName);
            result.put("notes", notes);
            result.put("publishedAt", publishedAt);
            result.put("updateAvailable", available);
            result.put("releasePage", "https://gitee.com/" + giteeOwner + "/" + giteeRepo
                    + "/releases/tag/" + tag);
            if (chosen != null) {
                Map<String, Object> asset = new LinkedHashMap<>();
                asset.put("name", chosen.name);
                asset.put("size", chosen.size);
                asset.put("url", chosen.url);
                asset.put("autoInstallable", chosen.portable);
                result.put("asset", asset);
                result.put("manualUrl", chosen.url);
                result.put("autoInstallable", chosen.portable && RuntimeSupport.isPackaged());
            } else {
                result.put("autoInstallable", false);
                result.put("manualUrl", result.get("releasePage"));
            }
            result.put("checksumAvailable", checksum != null);
            if (checksum != null) {
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("name", checksum.name);
                c.put("url", checksum.url);
                result.put("checksum", c);
            }
            if (available) {
                result.put("message", "发现新版本 " + latest
                        + (chosen == null ? "（发布页暂无可下载的安装包）" : ""));
            } else {
                result.put("message", "当前已是最新版本");
            }
            result.put("checkedAt", System.currentTimeMillis());
            lastCheck = result;
            if (Boolean.TRUE.equals(result.get("ok"))) {
                prefs.set(AppPrefsService.LAST_UPDATE_CHECK, String.valueOf(System.currentTimeMillis()));
            }
            return result;
        } catch (Exception e) {
            result.put("ok", false);
            result.put("message", "解析 Gitee 发布信息失败：" + shortMessage(e));
            return result;
        }
    }

    private static class Asset {
        String name;
        String url;
        long size;
        boolean portable;
    }

    private Asset chooseAsset(JsonNode assets, String latest) {
        if (assets == null || !assets.isArray()) {
            return null;
        }
        Asset best = null;
        int bestScore = -1;
        for (JsonNode a : assets) {
            String name = text(a, "name");
            String url = text(a, "browser_download_url");
            if (name.isEmpty() || url.isEmpty() || !isGiteeUrl(url)) {
                continue;
            }
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.endsWith(".sha256") || lower.endsWith(".txt") || lower.endsWith(".md5")) {
                continue;
            }
            if (url.contains("/archive/refs/")) {
                continue;
            }
            if (!lower.endsWith(".zip")) {
                continue;
            }
            int score = 0;
            if (lower.contains("windows")) {
                score += 4;
            }
            if (lower.contains("portable") || lower.contains("green")) {
                score += 4;
            }
            if (lower.startsWith("deepshell-")) {
                score += 2;
            }
            if (lower.contains(latest.toLowerCase(Locale.ROOT))) {
                score += 1;
            }
            if (score > bestScore) {
                bestScore = score;
                best = new Asset();
                best.name = name;
                best.url = url;
                best.size = a.path("size").asLong(0);
                best.portable = lower.contains("portable") || lower.contains("green");
            }
        }
        return best;
    }

    private static Asset chooseChecksum(JsonNode assets, Asset asset) {
        if (assets == null || !assets.isArray() || asset == null) {
            return null;
        }
        Asset best = null;
        for (JsonNode a : assets) {
            String name = text(a, "name");
            String url = text(a, "browser_download_url");
            if (name.isEmpty() || url.isEmpty() || !isGiteeUrl(url)) {
                continue;
            }
            String lower = name.toLowerCase(Locale.ROOT);
            if (!lower.contains("sha256") && !lower.endsWith(".sha256")) {
                continue;
            }
            Asset c = new Asset();
            c.name = name;
            c.url = url;
            c.size = a.path("size").asLong(0);
            String base = asset.name.toLowerCase(Locale.ROOT);
            if (lower.startsWith(base) || base.contains(lower.replace(".sha256", ""))) {
                return c;
            }
            if (best == null) {
                best = c;
            }
        }
        return best;
    }

    /* ---------------- 下载 ---------------- */

    public synchronized Map<String, Object> startDownload() {
        Map<String, Object> last = lastCheck;
        if (last == null) {
            last = check();
        }
        if (!Boolean.TRUE.equals(last.get("updateAvailable"))) {
            throw new IllegalStateException("当前没有可用的新版本");
        }
        if (!Boolean.TRUE.equals(last.get("autoInstallable"))) {
            throw new IllegalStateException("这个发布包不是绿色版，无法自动安装；请打开下载页手动更新");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> asset = (Map<String, Object>) last.get("asset");
        if (asset == null || asset.get("url") == null) {
            throw new IllegalStateException("发布页没有可下载的绿色版安装包");
        }
        String state = String.valueOf(download.status);
        if ("downloading".equals(state)) {
            return downloadView();
        }
        String version = safeVersion(String.valueOf(last.get("latestVersion")));
        String url = String.valueOf(asset.get("url"));
        String name = safeAssetName(String.valueOf(asset.get("name")));
        long expectedSize = asset.get("size") instanceof Number
                ? ((Number) asset.get("size")).longValue() : 0L;
        lastCheck = last;
        DownloadState st = new DownloadState();
        st.status = "downloading";
        st.version = version;
        st.fileName = name;
        st.total = expectedSize;
        st.message = "开始下载";
        download = st;
        downloadExecutor.submit(() -> doDownload(url, name, version, st));
        return downloadView();
    }

    public Map<String, Object> downloadView() {
        DownloadState st = download;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", st.status);
        m.put("version", st.version);
        m.put("fileName", st.fileName);
        m.put("downloaded", st.downloaded);
        m.put("total", st.total);
        m.put("percent", st.total > 0 ? Math.min(100, st.downloaded * 100.0 / st.total) : -1);
        m.put("verified", st.verified);
        m.put("hasChecksum", st.hasChecksum);
        m.put("message", st.message);
        m.put("autoUpdateSupported", RuntimeSupport.isPackaged());
        return m;
    }

    private void doDownload(String url, String name, String version, DownloadState st) {
        Path updatesRoot = DataDir.root().resolve("updates").toAbsolutePath().normalize();
        Path dir = updatesRoot.resolve(version).normalize();
        Path part = dir.resolve(name + ".part").normalize();
        Path target = dir.resolve(name).normalize();
        try {
            if (!isGiteeUrl(url)) {
                throw new IOException("下载地址不是 Gitee 发布资产");
            }
            if (!dir.startsWith(updatesRoot) || !part.startsWith(dir) || !target.startsWith(dir)) {
                throw new IOException("更新包路径不合法");
            }
            Files.createDirectories(dir);
            HttpURLConnection conn = openConnection(url);
            int code = conn.getResponseCode();
            if (code >= 400) {
                throw new IOException("下载失败（HTTP " + code + "）");
            }
            if (!isGiteeUrl(conn.getURL().toString())) {
                throw new IOException("下载被重定向到非 Gitee 地址");
            }
            long total = conn.getContentLengthLong();
            if (total > 0) {
                st.total = total;
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream raw = conn.getInputStream();
                 DigestInputStream in = new DigestInputStream(
                         new BufferedInputStream(raw), digest);
                 OutputStream out = new BufferedOutputStream(new FileOutputStream(part.toFile()))) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) >= 0) {
                    out.write(buf, 0, n);
                    st.downloaded += n;
                    st.message = "正在下载 " + hintSize(st.downloaded)
                            + (st.total > 0 ? " / " + hintSize(st.total) : "");
                }
            }
            String actual = hex(digest.digest());
            st.sha256 = actual;
            st.hasChecksum = false;
            String expected = fetchChecksum();
            if (expected == null || expected.isEmpty()) {
                st.message = "下载完成，但发布方没有提供 SHA256 校验文件；为安全起见不会自动安装。"
                        + "请联系发布者补充 .sha256 资产后重试，或手动下载。";
                st.verified = false;
                Files.move(part, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                st.status = "done";
                st.file = target;
                return;
            }
            st.hasChecksum = true;
            if (!actual.equalsIgnoreCase(expected)) {
                Files.deleteIfExists(part);
                throw new IOException("SHA256 校验失败：下载文件可能被篡改，已删除。");
            }
            Files.move(part, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            st.file = target;
            st.verified = true;
            st.status = "done";
            st.message = "下载完成并通过 SHA256 校验";
        } catch (Exception e) {
            try {
                Files.deleteIfExists(part);
            } catch (Exception ignore) {
                // 忽略临时文件清理失败
            }
            st.status = "failed";
            st.message = "下载失败：" + shortMessage(e);
            log.warn("更新包下载失败: {}", e.getMessage());
        }
    }

    private String fetchChecksum() {
        Map<String, Object> last = lastCheck;
        if (last == null) {
            return null;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> checksum = (Map<String, Object>) last.get("checksum");
        if (checksum == null || checksum.get("url") == null) {
            return null;
        }
        try {
            String url = String.valueOf(checksum.get("url"));
            if (!isGiteeUrl(url)) {
                return null;
            }
            HttpURLConnection conn = openConnection(url);
            if (conn.getResponseCode() >= 400 || !isGiteeUrl(conn.getURL().toString())) {
                return null;
            }
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) >= 0) {
                    out.write(buf, 0, n);
                    if (out.size() > 256 * 1024) {
                        break;
                    }
                }
                String text = new String(out.toByteArray(), StandardCharsets.UTF_8);
                Matcher matcher = SHA256_PATTERN.matcher(text);
                return matcher.find() ? matcher.group() : null;
            }
        } catch (Exception e) {
            log.warn("读取 SHA256 文件失败: {}", e.getMessage());
            return null;
        }
    }

    private static HttpURLConnection openConnection(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(20_000);
        conn.setReadTimeout(120_000);
        conn.setRequestProperty("User-Agent", "DeepShell");
        conn.setRequestProperty("Accept", "*/*");
        return conn;
    }

    /* ---------------- 安装 ---------------- */

    public synchronized Map<String, Object> installDownloaded() {
        DownloadState st = download;
        if (!"done".equals(st.status) || st.file == null || !Files.isRegularFile(st.file)) {
            throw new IllegalStateException("更新包还没有下载完成");
        }
        if (!st.verified) {
            throw new IllegalStateException("更新包未通过 SHA256 校验，不能自动安装");
        }
        if (st.sha256 == null || st.sha256.trim().isEmpty()) {
            throw new IllegalStateException("更新包缺少 SHA256 记录，不能自动安装");
        }
        Path launcher = RuntimeSupport.launcher();
        if (launcher == null) {
            throw new IllegalStateException("当前不是绿色版运行，无法自动替换程序；请手动解压覆盖");
        }
        Path updatesRoot = DataDir.root().resolve("updates").toAbsolutePath().normalize();
        Path workDir = updatesRoot.resolve(st.version).resolve("extract").normalize();
        if (!workDir.startsWith(updatesRoot)) {
            throw new IllegalStateException("更新包路径不合法");
        }
        Path installDir = launcher.toAbsolutePath().getParent();
        try {
            // 安装前重新计算一次哈希，避免下载完成后文件被替换
            String actual = sha256Of(st.file);
            if (!actual.equalsIgnoreCase(st.sha256.trim())) {
                st.verified = false;
                throw new IllegalStateException("更新包 SHA256 校验失败，文件可能已被修改，已停止安装");
            }
            deleteRecursively(workDir);
            Files.createDirectories(workDir);
            unzip(st.file, workDir);
            Path newApp = findAppRoot(workDir, launcher.getFileName().toString());
            if (newApp == null) {
                throw new IllegalStateException("更新包里没有找到 " + launcher.getFileName()
                        + "，这不是有效的绿色版");
            }
            Path helper = RuntimeSupport.isWindows()
                    ? startWindowsUpdateHelper(newApp, installDir, launcher)
                    : startLinuxUpdateHelper(newApp, installDir, launcher);
            st.status = "installing";
            st.message = "更新程序已启动，DeepShell 即将退出并完成替换";
            AppRestartSupport.exitAfter(1500);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("started", true);
            r.put("helper", helper.toString());
            r.put("message", st.message);
            return r;
        } catch (Exception e) {
            throw new IllegalStateException("准备更新失败：" + shortMessage(e));
        }
    }

    private Path startWindowsUpdateHelper(Path source, Path installDir, Path launcher) throws Exception {
        long pid = currentPid();
        String src = source.toAbsolutePath().toString();
        String dst = installDir.toAbsolutePath().toString();
        String exe = launcher.getFileName().toString();
        StringBuilder p = new StringBuilder();
        p.append("$ErrorActionPreference='Stop'\n");
        p.append("$pidToWait=").append(pid).append("\n");
        p.append("for ($i=0; $i -lt 180; $i++) {\n");
        p.append("  $p=Get-Process -Id $pidToWait -ErrorAction SilentlyContinue\n");
        p.append("  if ($null -eq $p) { break }\n");
        p.append("  Start-Sleep -Seconds 1\n");
        p.append("}\n");
        p.append("Start-Sleep -Milliseconds 600\n");
        p.append("$src='").append(psLiteral(src)).append("'\n");
        p.append("$dst='").append(psLiteral(dst)).append("'\n");
        p.append("Get-ChildItem -LiteralPath $src -Force | Where-Object { $_.Name -notin @('data','application.yml') } | ForEach-Object {\n");
        p.append("  Copy-Item -LiteralPath $_.FullName -Destination $dst -Recurse -Force -ErrorAction Stop\n");
        p.append("}\n");
        p.append("Start-Process -FilePath (Join-Path $dst '").append(psLiteral(exe))
                .append("') -WorkingDirectory $dst -ArgumentList '--deepshell.open-browser=true'\n");
        p.append("Start-Sleep -Seconds 2\n");
        p.append("Remove-Item -LiteralPath $src -Recurse -Force -ErrorAction SilentlyContinue\n");
        String encoded = Base64.getEncoder().encodeToString(
                p.toString().getBytes(StandardCharsets.UTF_16LE));
        ProcessBuilder pb = new ProcessBuilder("powershell.exe", "-NoProfile",
                "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded);
        pb.redirectErrorStream(true);
        Path logFile = DataDir.root().resolve("logs").resolve("update.log");
        Files.createDirectories(logFile.getParent());
        pb.redirectOutput(ProcessBuilder.Redirect.appendTo(logFile.toFile()));
        pb.start();
        return logFile;
    }

    private Path startLinuxUpdateHelper(Path source, Path installDir, Path launcher) throws Exception {
        long pid = currentPid();
        Path helper = Files.createTempFile(DataDir.root().resolve("updates"), "apply-update-", ".sh");
        String sh = "#!/bin/sh\n"
                + "while kill -0 " + pid + " 2>/dev/null; do sleep 1; done\n"
                + "sleep 1\n"
                + "cd '" + shellLiteral(source.toAbsolutePath().toString()) + "' || exit 1\n"
                + "tar -cf - --exclude=./data --exclude=./application.yml . | "
                + "(cd '" + shellLiteral(installDir.toAbsolutePath().toString()) + "' && tar -xf -)\n"
                + "nohup '" + shellLiteral(launcher.toAbsolutePath().toString())
                + "' --deepshell.open-browser=true >/dev/null 2>&1 &\n"
                + "sleep 2\n"
                + "rm -rf '" + shellLiteral(source.toAbsolutePath().toString()) + "' '" + shellLiteral(helper.toString()) + "'\n";
        Files.write(helper, sh.getBytes(StandardCharsets.UTF_8));
        try {
            Files.setPosixFilePermissions(helper, java.util.EnumSet.of(
                    java.nio.file.attribute.PosixFilePermission.OWNER_READ,
                    java.nio.file.attribute.PosixFilePermission.OWNER_WRITE,
                    java.nio.file.attribute.PosixFilePermission.OWNER_EXECUTE));
        } catch (Exception ignore) {
            // 非 POSIX 文件系统
        }
        ProcessBuilder pb = new ProcessBuilder("sh", helper.toString());
        pb.redirectErrorStream(true);
        Path logFile = DataDir.root().resolve("logs").resolve("update.log");
        Files.createDirectories(logFile.getParent());
        pb.redirectOutput(ProcessBuilder.Redirect.appendTo(logFile.toFile()));
        pb.start();
        return helper;
    }

    private static void unzip(Path zip, Path target) throws Exception {
        try (ZipInputStream in = new ZipInputStream(Files.newInputStream(zip))) {
            ZipEntry entry;
            while ((entry = in.getNextEntry()) != null) {
                String name = entry.getName().replace('\\', '/');
                if (name.isEmpty()) {
                    continue;
                }
                Path out = target.resolve(name).normalize();
                if (!out.startsWith(target)) {
                    throw new IOException("更新包包含非法路径: " + name);
                }
                if (entry.isDirectory()) {
                    Files.createDirectories(out);
                    continue;
                }
                Files.createDirectories(out.getParent());
                try (OutputStream os = Files.newOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) >= 0) {
                        os.write(buf, 0, n);
                    }
                }
            }
        }
    }

    private static Path findAppRoot(Path dir, String launcherName) throws IOException {
        final Path[] result = {null};
        try (java.util.stream.Stream<Path> stream = Files.walk(dir, 4)) {
            stream.sorted(Comparator.comparingInt(Path::getNameCount))
                    .forEach(p -> {
                        if (result[0] != null) {
                            return;
                        }
                        if (Files.isRegularFile(p)
                                && p.getFileName().toString().equalsIgnoreCase(launcherName)) {
                            Path parent = p.getParent();
                            if (parent != null && Files.isDirectory(parent.resolve("app"))
                                    && Files.isDirectory(parent.resolve("runtime"))) {
                                result[0] = parent;
                            }
                        }
                    });
        }
        return result[0];
    }

    private static void deleteRecursively(Path dir) throws IOException {
        if (dir == null || !Files.exists(dir)) {
            return;
        }
        try (java.util.stream.Stream<Path> stream = Files.walk(dir)) {
            stream.sorted(Comparator.reverseOrder())
                    .forEach(p -> {
                        try {
                            Files.deleteIfExists(p);
                        } catch (IOException ignore) {
                            // 忽略单个文件删除失败
                        }
                    });
        }
    }

    /* ---------------- helpers ---------------- */

    private static String normalizeVersion(String tag) {
        String v = tag == null ? "" : tag.trim();
        while (v.startsWith("v") || v.startsWith("V")) {
            v = v.substring(1);
        }
        return v;
    }

    /** 版本号会拼进本机目录：只接受字母数字和 . _ -，避免 tag 中带路径分隔符 */
    private static String safeVersion(String tag) {
        String v = normalizeVersion(tag);
        if (!v.matches("[0-9A-Za-z][0-9A-Za-z._-]{0,63}") || v.contains("..")) {
            throw new IllegalArgumentException("更新版本号不合法: " + tag);
        }
        return v;
    }

    /** 资产名只保留文件名本身，且只允许安全字符，避免写到 updates 目录之外 */
    private static String safeAssetName(String assetName) {
        String name = assetName == null ? "" : assetName.replace('\\', '/').trim();
        int slash = name.lastIndexOf('/');
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        if (!name.matches("[0-9A-Za-z][0-9A-Za-z._-]{0,159}")
                || name.contains("..") || name.endsWith(".")) {
            throw new IllegalArgumentException("更新包文件名不合法: " + assetName);
        }
        return name;
    }

    private static String sha256Of(Path file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = Files.newInputStream(file)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) >= 0) {
                digest.update(buf, 0, n);
            }
        }
        return hex(digest.digest());
    }

    static int compareVersion(String a, String b) {
        String[] aa = normalizeVersion(a).split("[^0-9]");
        String[] bb = normalizeVersion(b).split("[^0-9]");
        int n = Math.max(aa.length, bb.length);
        for (int i = 0; i < n; i++) {
            int x = i < aa.length ? parseInt(aa[i]) : 0;
            int y = i < bb.length ? parseInt(bb[i]) : 0;
            if (x != y) {
                return Integer.compare(x, y);
            }
        }
        return 0;
    }

    private static int parseInt(String s) {
        try {
            return Integer.parseInt(s);
        } catch (Exception e) {
            return 0;
        }
    }

    private static boolean isGiteeUrl(String url) {
        try {
            URI uri = URI.create(url);
            if (!"https".equalsIgnoreCase(uri.getScheme())) {
                return false;
            }
            String host = uri.getHost();
            return host != null && (host.equalsIgnoreCase("gitee.com")
                    || host.toLowerCase(Locale.ROOT).endsWith(".gitee.com"));
        } catch (Exception e) {
            return false;
        }
    }

    private static String text(JsonNode n, String key) {
        JsonNode v = n.get(key);
        return v == null || v.isNull() ? "" : v.asText("");
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.ROOT, "%02x", b));
        }
        return sb.toString();
    }

    private static String hintSize(long bytes) {
        if (bytes >= 1024L * 1024 * 1024) {
            return String.format(Locale.ROOT, "%.2f GB", bytes / 1024.0 / 1024 / 1024);
        }
        if (bytes >= 1024L * 1024) {
            return String.format(Locale.ROOT, "%.1f MB", bytes / 1024.0 / 1024);
        }
        return String.format(Locale.ROOT, "%.0f KB", bytes / 1024.0);
    }

    private static String shortMessage(Throwable e) {
        if (e == null) {
            return "未知错误";
        }
        String m = e.getMessage();
        if (m == null || m.trim().isEmpty()) {
            m = e.getClass().getSimpleName();
        }
        m = m.replace('\r', ' ').replace('\n', ' ').trim();
        return m.length() > 300 ? m.substring(0, 300) + "…" : m;
    }

    private static String psLiteral(String value) {
        return value.replace("'", "''");
    }

    private static String shellLiteral(String value) {
        return value.replace("'", "'\\''");
    }

    private static long currentPid() {
        try {
            String name = java.lang.management.ManagementFactory.getRuntimeMXBean().getName();
            int at = name.indexOf('@');
            return Long.parseLong(at > 0 ? name.substring(0, at) : name);
        } catch (Exception e) {
            return -1L;
        }
    }

    static class DownloadState {
        volatile String status = "idle";
        volatile String version = "";
        volatile String fileName = "";
        volatile long downloaded;
        volatile long total;
        volatile boolean verified;
        volatile boolean hasChecksum;
        volatile String message = "";
        volatile String sha256 = "";
        volatile Path file;
    }
}
