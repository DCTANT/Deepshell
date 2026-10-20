package com.itdct.deepshell.web;

import com.itdct.deepshell.common.ImageThumbnails;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.ArchiveReq;
import com.itdct.deepshell.dto.CopyReq;
import com.itdct.deepshell.dto.SftpEntry;
import com.itdct.deepshell.dto.SftpReq;
import com.itdct.deepshell.service.ArchiveService;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.DownloadTaskService;
import com.itdct.deepshell.service.SftpService;
import com.itdct.deepshell.service.TransferService;
import com.itdct.deepshell.service.VscodeEditService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.function.LongConsumer;

@RestController
@RequestMapping("/api/sftp")
public class SftpController {

    /** 缩略图原图读取上限：超过则前端回退为文件图标 */
    private static final int MAX_THUMB_SOURCE = 30 * 1024 * 1024;

    private final SftpService sftp;
    private final VscodeEditService vscodeEditService;
    private final ArchiveService archiveService;
    private final TransferService transferService;
    private final AuditService audit;
    private final DownloadTaskService downloadTasks;

    public SftpController(SftpService sftp, VscodeEditService vscodeEditService,
                          ArchiveService archiveService, TransferService transferService,
                          AuditService audit, DownloadTaskService downloadTasks) {
        this.sftp = sftp;
        this.vscodeEditService = vscodeEditService;
        this.archiveService = archiveService;
        this.transferService = transferService;
        this.audit = audit;
        this.downloadTasks = downloadTasks;
    }

    @GetMapping("/list")
    public R<List<SftpEntry>> list(@RequestParam String sessionId,
                                   @RequestParam(required = false) String path) throws Exception {
        return R.ok(sftp.list(sessionId, path));
    }

    @GetMapping("/home")
    public R<String> home(@RequestParam String sessionId) throws Exception {
        return R.ok(sftp.home(sessionId));
    }

    @PostMapping("/mkdir")
    public R<Void> mkdir(@RequestBody SftpReq req) throws Exception {
        sftp.mkdir(req.getSessionId(), req.getPath());
        audit.record("FILE_MKDIR", req.getPath(), "OK", null);
        return R.ok();
    }

    /** 新建空文件 */
    @PostMapping("/touch")
    public R<Void> touch(@RequestBody SftpReq req) throws Exception {
        sftp.createFile(req.getSessionId(), req.getPath());
        audit.record("FILE_TOUCH", req.getPath(), "OK", null);
        return R.ok();
    }

    @PostMapping("/rename")
    public R<Void> rename(@RequestBody SftpReq req) throws Exception {
        sftp.rename(req.getSessionId(), req.getPath(), req.getNewName());
        audit.record("FILE_RENAME", req.getPath(), "OK", "新名称：" + req.getNewName());
        return R.ok();
    }

    /** 拖拽移动：把 path 移动到 destDir 目录下 */
    @PostMapping("/move")
    public R<Void> move(@RequestBody SftpReq req) throws Exception {
        sftp.move(req.getSessionId(), req.getPath(), req.getDestDir());
        audit.record("FILE_MOVE", req.getPath(), "OK", "目标目录：" + req.getDestDir());
        return R.ok();
    }

    /** 复制/粘贴：把多个文件或文件夹复制到 destDir 目录下 */
    @PostMapping("/copy")
    public R<Void> copy(@RequestBody CopyReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        sftp.copy(req.getSessionId(), req.getPaths(), req.getDestDir());
        int count = req.getPaths() == null ? 0 : req.getPaths().size();
        audit.record("FILE_COPY", req.getDestDir(), "OK", "复制 " + count + " 项");
        return R.ok();
    }

    @PostMapping("/delete")
    public R<Void> delete(@RequestBody SftpReq req) throws Exception {
        sftp.delete(req.getSessionId(), req.getPath());
        audit.record("FILE_DELETE", req.getPath(), "OK", null);
        return R.ok();
    }

    @GetMapping("/read")
    public R<String> read(@RequestParam String sessionId, @RequestParam String path) throws Exception {
        return R.ok(sftp.readText(sessionId, path));
    }

    @PostMapping("/write")
    public R<Void> write(@RequestBody SftpReq req) throws Exception {
        sftp.writeText(req.getSessionId(), req.getPath(), req.getContent() == null ? "" : req.getContent());
        audit.record("FILE_EDIT", req.getPath(), "OK", null);
        return R.ok();
    }

    @GetMapping("/download")
    public void download(@RequestParam String sessionId, @RequestParam String path,
                         @RequestParam(required = false) String taskId,
                         HttpServletResponse resp) throws Exception {
        String name = path.substring(path.lastIndexOf('/') + 1);
        resp.setContentType("application/octet-stream");
        resp.setHeader("Content-Disposition", contentDisposition("attachment", name));
        audit.record("FILE_DOWNLOAD", path, "OK", null);
        if (isBlank(taskId)) {
            sftp.download(sessionId, path, resp.getOutputStream());
            return;
        }
        try {
            downloadTasks.attach(taskId, sftp.fileSize(sessionId, path));
        } catch (Exception ignore) {
            // 取不到大小时仍继续下载，前端显示已传字节
        }
        try (CountingOutputStream out = new CountingOutputStream(
                resp.getOutputStream(), n -> downloadTasks.progress(taskId, n),
                () -> downloadTasks.isCancelled(taskId))) {
            sftp.download(sessionId, path, out);
        } catch (Exception e) {
            if (!downloadTasks.isCancelled(taskId)) {
                downloadTasks.fail(taskId, e.getMessage());
            }
            throw e;
        }
        downloadTasks.finish(taskId);
    }

    /** 多选打包下载预检：校验会话、目录与选中项，返回实际下载文件名 */
    @PostMapping("/download-bundle/check")
    public R<Map<String, Object>> downloadBundleCheck(@RequestBody ArchiveReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        requireSession(req.getSessionId());
        int count = sftp.checkBundle(req.getSessionId(), req.getDestDir(), req.getPaths());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("count", count);
        result.put("downloadName", bundleDownloadName(req.getDestDir(), bundleStamp()));
        return R.ok(result);
    }

    /**
     * 多选打包下载：后端通过 SFTP 逐个读取选中文件 / 文件夹，流式写成一个 ZIP 响应。
     * 浏览器只产生一次下载，不依赖服务器 zip 命令，也不在服务器落临时文件。
     */
    @PostMapping("/download-bundle")
    public void downloadBundle(@RequestParam String sessionId,
                               @RequestParam String destDir,
                               @RequestParam("paths") List<String> paths,
                               @RequestParam(required = false) String name,
                               @RequestParam(required = false) String taskId,
                               HttpServletResponse resp) throws Exception {
        requireSession(sessionId);
        // 先校验顶层路径，避免把错误响应当成 zip 下载
        sftp.checkBundle(sessionId, destDir, paths);
        String downloadName = sanitizeBundleName(name, destDir);
        resp.setContentType("application/zip");
        resp.setHeader("Content-Disposition", contentDisposition("attachment", downloadName));
        resp.setHeader("Cache-Control", "no-store");
        audit.record("FILE_DOWNLOAD", destDir, "OK", "打包下载 " + paths.size() + " 项：" + downloadName);
        if (isBlank(taskId)) {
            sftp.writeZip(sessionId, destDir, paths, resp.getOutputStream());
            return;
        }
        // 流式 ZIP 无法预知最终大小，只按已发送字节提供进度
        try (CountingOutputStream out = new CountingOutputStream(
                resp.getOutputStream(), n -> downloadTasks.progress(taskId, n),
                () -> downloadTasks.isCancelled(taskId))) {
            sftp.writeZip(sessionId, destDir, paths, out);
        } catch (Exception e) {
            if (!downloadTasks.isCancelled(taskId)) {
                downloadTasks.fail(taskId, e.getMessage());
            }
            throw e;
        }
        downloadTasks.finish(taskId);
    }

    private static void requireSession(String sessionId) {
        if (sessionId == null || sessionId.trim().isEmpty()) {
            throw new IllegalArgumentException("会话未就绪");
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    /**
     * 下载 / 预览的 Content-Disposition：filename= 只放 ASCII 回退名，
     * 真实文件名（可能含中文）放到 RFC 5987 的 filename* 中。
     * Tomcat 收到非 ASCII 头值时会丢弃该头，导致浏览器把图片当页面内联打开。
     */
    private static String contentDisposition(String disposition, String name) {
        String raw = (name == null || name.trim().isEmpty()) ? "download" : name;
        String safe = raw.replace('\\', '_').replace('"', '_')
                .replace("\r", "_").replace("\n", "_");
        String ascii = safe.replaceAll("[^\\x20-\\x7E]", "_");
        if (ascii.trim().isEmpty()) {
            ascii = "download";
        }
        String encoded;
        try {
            encoded = URLEncoder.encode(raw, "UTF-8").replace("+", "%20");
        } catch (java.io.UnsupportedEncodingException e) {
            encoded = ascii;
        }
        return disposition + "; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded;
    }

    /** 统计已写入响应流的字节数，供下载进度轮询读取；取消时中断输出 */
    private static final class CountingOutputStream extends FilterOutputStream {
        private final LongConsumer onProgress;
        private final BooleanSupplier cancelled;
        private long count;

        CountingOutputStream(OutputStream out, LongConsumer onProgress, BooleanSupplier cancelled) {
            super(out);
            this.onProgress = onProgress;
            this.cancelled = cancelled;
        }

        @Override
        public void write(int b) throws IOException {
            checkCancelled();
            out.write(b);
            count++;
            onProgress.accept(count);
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            checkCancelled();
            out.write(b, off, len);
            count += len;
            onProgress.accept(count);
        }

        private void checkCancelled() throws IOException {
            if (cancelled != null && cancelled.getAsBoolean()) {
                throw new IOException("下载已取消");
            }
        }
    }

    private static String bundleStamp() {
        return new SimpleDateFormat("yyyyMMdd-HHmmss").format(new Date());
    }

    private static String bundleDownloadName(String destDir, String stamp) {
        String dir = destDir == null ? "" : destDir.trim();
        if (dir.length() > 1 && dir.endsWith("/")) {
            dir = dir.substring(0, dir.length() - 1);
        }
        String base = dir.substring(dir.lastIndexOf('/') + 1);
        base = base.replaceAll("[^A-Za-z0-9._-]", "_");
        if (base.isEmpty()) {
            base = "files";
        }
        return base + "-" + stamp + ".zip";
    }

    private static String sanitizeBundleName(String name, String destDir) {
        String n = name == null ? "" : name.trim()
                .replace('\\', '_').replace('"', '_')
                .replace("\r", "_").replace("\n", "_");
        if (n.isEmpty()) {
            n = bundleDownloadName(destDir, bundleStamp());
        }
        if (n.length() > 120) {
            n = n.substring(0, 120);
        }
        if (!n.toLowerCase().endsWith(".zip")) {
            n += ".zip";
        }
        return n;
    }

    /** 图片预览：以正确的图片 Content-Type 内联返回，供可视化桌面查看 */
    @GetMapping("/preview")
    public void preview(@RequestParam("sessionId") String sessionId,
                        @RequestParam("path") String path,
                        HttpServletResponse resp) throws Exception {
        String name = path.substring(path.lastIndexOf('/') + 1);
        String contentType = imageContentType(name);
        if (contentType == null) {
            throw new IllegalArgumentException("该文件类型不支持图片预览");
        }
        resp.setContentType(contentType);
        resp.setHeader("Content-Disposition", contentDisposition("inline", name));
        resp.setHeader("Cache-Control", "private, max-age=300");
        resp.setHeader("X-Content-Type-Options", "nosniff");
        sftp.download(sessionId, path, resp.getOutputStream());
    }

    /**
     * 视频预览：支持 HTTP Range，浏览器可以边下边播，并在拖动进度条时按需读取。
     * 未带 Range 时返回完整文件；带 Range 时返回 206 + Content-Range。
     */
    @GetMapping("/video")
    public void video(@RequestParam("sessionId") String sessionId,
                      @RequestParam("path") String path,
                      HttpServletRequest req,
                      HttpServletResponse resp) throws Exception {
        String name = path.substring(path.lastIndexOf('/') + 1);
        String contentType = videoContentType(name);
        if (contentType == null) {
            throw new IllegalArgumentException("该文件类型不支持视频预览");
        }
        long size = sftp.fileSize(sessionId, path);
        resp.setContentType(contentType);
        resp.setHeader("Accept-Ranges", "bytes");
        resp.setHeader("Content-Disposition", contentDisposition("inline", name));
        resp.setHeader("Cache-Control", "private, max-age=300");
        resp.setHeader("X-Content-Type-Options", "nosniff");

        long start = 0;
        long end = size > 0 ? size - 1 : 0;
        boolean partial = false;
        String rangeHeader = req.getHeader("Range");
        if (rangeHeader != null && !rangeHeader.trim().isEmpty()) {
            long[] span = parseRange(rangeHeader, size);
            if (span == null) {
                resp.setStatus(HttpServletResponse.SC_REQUESTED_RANGE_NOT_SATISFIABLE);
                resp.setHeader("Content-Range", "bytes */" + size);
                resp.setContentLengthLong(0);
                return;
            }
            start = span[0];
            end = span[1];
            partial = true;
        }

        long length = size == 0 ? 0 : end - start + 1;
        if (partial) {
            resp.setStatus(HttpServletResponse.SC_PARTIAL_CONTENT);
            resp.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + size);
        }
        resp.setContentLengthLong(length);
        if (length <= 0 || "HEAD".equalsIgnoreCase(req.getMethod())) {
            return;
        }
        try {
            sftp.streamRange(sessionId, path, start, length, resp.getOutputStream());
        } catch (IOException clientGone) {
            // 浏览器取消播放 / 快速拖动进度条时会主动断开连接
        }
    }

    /**
     * 解析单段 Range：bytes=start-end、bytes=start-、bytes=-suffix。
     * 不支持多段 Range；返回 null 表示范围非法（应回 416）。
     */
    static long[] parseRange(String header, long size) {
        if (header == null || size <= 0) {
            return null;
        }
        String value = header.trim();
        if (!value.regionMatches(true, 0, "bytes=", 0, 6)) {
            return null;
        }
        String spec = value.substring(6).trim();
        if (spec.isEmpty() || spec.indexOf(',') >= 0) {
            return null;
        }
        int dash = spec.indexOf('-');
        if (dash < 0) {
            return null;
        }
        String startText = spec.substring(0, dash).trim();
        String endText = spec.substring(dash + 1).trim();
        try {
            if (startText.isEmpty()) {
                long suffix = Long.parseLong(endText);
                if (suffix <= 0) {
                    return null;
                }
                if (suffix > size) {
                    suffix = size;
                }
                return new long[]{size - suffix, size - 1};
            }
            long start = Long.parseLong(startText);
            if (start < 0 || start >= size) {
                return null;
            }
            long end;
            if (endText.isEmpty()) {
                end = size - 1;
            } else {
                end = Long.parseLong(endText);
                if (end < start) {
                    return null;
                }
                if (end >= size) {
                    end = size - 1;
                }
            }
            return new long[]{start, end};
        } catch (NumberFormatException badNumber) {
            return null;
        }
    }

    static String videoContentType(String name) {
        int idx = name.lastIndexOf('.');
        if (idx < 0 || idx == name.length() - 1) {
            return null;
        }
        String ext = name.substring(idx + 1).toLowerCase(java.util.Locale.ROOT);
        switch (ext) {
            case "mp4":
            case "m4v":
            case "f4v":
                return "video/mp4";
            case "webm":
                return "video/webm";
            case "ogv":
            case "ogg":
                return "video/ogg";
            case "mov":
                return "video/quicktime";
            case "mkv":
                return "video/x-matroska";
            case "avi":
                return "video/x-msvideo";
            case "wmv":
            case "asf":
                return "video/x-ms-wmv";
            case "flv":
                return "video/x-flv";
            case "ts":
            case "m2ts":
            case "mts":
                return "video/mp2t";
            case "mpg":
            case "mpeg":
                return "video/mpeg";
            case "3gp":
                return "video/3gpp";
            case "rm":
            case "rmvb":
                return "application/vnd.rn-realmedia-vbr";
            default:
                return null;
        }
    }

    /**
     * 图片缩略图：服务端降采样后返回小图，供大/中图标视图使用。
     * 避免浏览器直接解码超高分辨率原图，也避免大量原图下载挤占 SFTP 通道。
     */
    @GetMapping("/thumbnail")
    public void thumbnail(@RequestParam("sessionId") String sessionId,
                          @RequestParam("path") String path,
                          @RequestParam(value = "size", defaultValue = "200") int size,
                          HttpServletResponse resp) {
        String name = path.substring(path.lastIndexOf('/') + 1);
        String contentType = imageContentType(name);
        if (contentType == null) {
            sendError(resp, HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE);
            return;
        }
        byte[] source;
        try {
            source = sftp.readBytes(sessionId, path, MAX_THUMB_SOURCE);
        } catch (IllegalArgumentException tooLargeOrInvalid) {
            sendError(resp, HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            return;
        } catch (Exception readFailed) {
            sendError(resp, HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        resp.setHeader("Cache-Control", "private, max-age=300");
        resp.setHeader("X-Content-Type-Options", "nosniff");
        if ("image/svg+xml".equals(contentType)) {
            // SVG 是矢量且通常很小，直接交给浏览器缩放
            writeImage(resp, contentType, source);
            return;
        }
        try {
            ImageThumbnails.Thumb thumb = ImageThumbnails.create(source, size);
            writeImage(resp, thumb.getContentType(), thumb.getData());
        } catch (UnsupportedOperationException unsupported) {
            sendError(resp, HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE);
        } catch (Exception decodeFailed) {
            sendError(resp, HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE);
        }
    }

    private static void writeImage(HttpServletResponse resp, String contentType, byte[] data) {
        try {
            resp.setContentType(contentType);
            resp.setContentLength(data.length);
            resp.getOutputStream().write(data);
        } catch (IOException ignore) {
            // 浏览器取消加载等情况，忽略
        }
    }

    private static void sendError(HttpServletResponse resp, int status) {
        try {
            resp.sendError(status);
        } catch (IOException ignore) {
            // ignore
        }
    }

    private static String imageContentType(String name) {
        int idx = name.lastIndexOf('.');
        if (idx < 0 || idx == name.length() - 1) {
            return null;
        }
        String ext = name.substring(idx + 1).toLowerCase(java.util.Locale.ROOT);
        if ("png".equals(ext)) {
            return "image/png";
        }
        if ("jpg".equals(ext) || "jpeg".equals(ext) || "jpe".equals(ext) || "jfif".equals(ext)) {
            return "image/jpeg";
        }
        if ("gif".equals(ext)) {
            return "image/gif";
        }
        if ("webp".equals(ext)) {
            return "image/webp";
        }
        if ("bmp".equals(ext)) {
            return "image/bmp";
        }
        if ("svg".equals(ext)) {
            return "image/svg+xml";
        }
        if ("ico".equals(ext)) {
            return "image/x-icon";
        }
        if ("avif".equals(ext)) {
            return "image/avif";
        }
        if ("tif".equals(ext) || "tiff".equals(ext)) {
            return "image/tiff";
        }
        if ("heic".equals(ext) || "heif".equals(ext)) {
            return "image/heic";
        }
        return null;
    }

    @PostMapping("/upload")
    public R<Void> upload(@RequestParam String sessionId, @RequestParam String path,
                          @RequestParam("file") MultipartFile file) throws Exception {
        sftp.upload(sessionId, path, file);
        audit.record("FILE_UPLOAD", path + "/" + file.getOriginalFilename(), "OK",
                file.getSize() + " bytes");
        return R.ok();
    }

    /** 修改权限（八进制模式） */
    @PostMapping("/chmod")
    public R<Void> chmod(@RequestBody SftpReq req) throws Exception {
        if (req.getMode() == null) {
            throw new IllegalArgumentException("缺少权限模式");
        }
        sftp.chmod(req.getSessionId(), req.getPath(), req.getMode());
        audit.record("FILE_CHMOD", req.getPath(), "OK",
                String.format("%04o", req.getMode()));
        return R.ok();
    }

    /** 分片上传：初始化/恢复任务 */
    @PostMapping("/upload/init")
    public R<Map<String, Object>> uploadInit(@RequestBody Map<String, Object> body) throws Exception {
        long size = longValue(body.get("size"));
        return R.ok(transferService.init(
                text(body, "sessionId"), text(body, "dir"), text(body, "name"),
                text(body, "relativePath"), size, text(body, "uploadId")));
    }

    /** 分片上传：写入一片 */
    @PostMapping("/upload/chunk")
    public R<Map<String, Object>> uploadChunk(@RequestParam("uploadId") String uploadId,
                                              @RequestParam("offset") long offset,
                                              @RequestParam("chunk") MultipartFile chunk) throws Exception {
        return R.ok(transferService.append(uploadId, offset, chunk));
    }

    /** 分片上传：全部完成后写入远端 */
    @PostMapping("/upload/complete")
    public R<Map<String, Object>> uploadComplete(@RequestBody Map<String, Object> body) throws Exception {
        return R.ok(transferService.complete(text(body, "uploadId")));
    }

    /** 分片上传：取消并删除临时文件 */
    @PostMapping("/upload/abort")
    public R<Void> uploadAbort(@RequestBody Map<String, Object> body) {
        transferService.abort(text(body, "uploadId"));
        return R.ok();
    }

    private static String text(Map<String, Object> body, String key) {
        Object value = body == null ? null : body.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private static long longValue(Object value) {
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        if (value != null) {
            try {
                return Long.parseLong(String.valueOf(value).trim());
            } catch (NumberFormatException ignore) {
                // 继续抛统一参数错误
            }
        }
        throw new IllegalArgumentException("文件大小不合法");
    }

    /** 下载到本地并用 VSCode 打开，保存后自动同步回服务器 */
    @PostMapping("/vscode")
    public R<Map<String, Object>> vscode(@RequestBody SftpReq req) throws Exception {
        return R.ok(vscodeEditService.open(req.getSessionId(), req.getPath()));
    }

    /** 压缩当前目录下的文件 / 文件夹（调用服务器 zip / tar / 7z） */
    @PostMapping("/compress")
    public R<Map<String, Object>> compress(@RequestBody ArchiveReq req) throws Exception {
        Map<String, Object> result = archiveService.compress(req);
        audit.record("FILE_COMPRESS", String.valueOf(result.get("path")), "OK",
                String.valueOf(result.get("format")));
        return R.ok(result);
    }
}
