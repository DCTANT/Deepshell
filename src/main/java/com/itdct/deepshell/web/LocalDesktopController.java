package com.itdct.deepshell.web;

import com.itdct.deepshell.common.ImageThumbnails;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.ContentSearchReq;
import com.itdct.deepshell.dto.CopyReq;
import com.itdct.deepshell.dto.FileChecksumResult;
import com.itdct.deepshell.dto.FileContentMatch;
import com.itdct.deepshell.dto.SftpEntry;
import com.itdct.deepshell.dto.SftpReq;
import com.itdct.deepshell.dto.UploadConflictReq;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.LocalDesktopService;
import com.itdct.deepshell.service.SftpService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 本地桌面文件接口：仅操作数据目录下的 Desktop 沙箱，不依赖 SSH 会话。
 * 路径使用虚拟根目录 “/”，前端可以复用以 “/” 为根的资源管理器逻辑。
 */
@RestController
@RequestMapping("/api/local/fs")
public class LocalDesktopController {

    private final LocalDesktopService service;
    private final AuditService audit;

    public LocalDesktopController(LocalDesktopService service, AuditService audit) {
        this.service = service;
        this.audit = audit;
    }

    @GetMapping("/info")
    public R<Map<String, Object>> info() {
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("local", true);
        info.put("label", "本地桌面");
        info.put("root", service.getRoot().toString());
        info.put("os", System.getProperty("os.name"));
        return R.ok(info);
    }

    @GetMapping("/list")
    public R<List<SftpEntry>> list(@RequestParam(required = false) String path) throws IOException {
        return R.ok(service.list(path));
    }

    @GetMapping("/read")
    public R<String> read(@RequestParam String path) throws IOException {
        return R.ok(service.readText(path));
    }

    @PostMapping("/write")
    public R<Void> write(@RequestBody SftpReq req) throws IOException {
        service.writeText(req.getPath(), req.getContent());
        audit.record("LOCAL_FILE_EDIT", req.getPath(), "OK", null);
        return R.ok();
    }

    @PostMapping("/mkdir")
    public R<Void> mkdir(@RequestBody SftpReq req) throws IOException {
        service.mkdir(req.getPath());
        audit.record("LOCAL_FILE_MKDIR", req.getPath(), "OK", null);
        return R.ok();
    }

    @PostMapping("/touch")
    public R<Void> touch(@RequestBody SftpReq req) throws IOException {
        service.createFile(req.getPath());
        audit.record("LOCAL_FILE_TOUCH", req.getPath(), "OK", null);
        return R.ok();
    }

    @PostMapping("/rename")
    public R<Void> rename(@RequestBody SftpReq req) throws IOException {
        service.rename(req.getPath(), req.getNewName());
        audit.record("LOCAL_FILE_RENAME", req.getPath(), "OK", "新名称：" + req.getNewName());
        return R.ok();
    }

    @PostMapping("/move")
    public R<Void> move(@RequestBody SftpReq req) throws IOException {
        service.move(req.getPath(), req.getDestDir());
        audit.record("LOCAL_FILE_MOVE", req.getPath(), "OK", "目标目录：" + req.getDestDir());
        return R.ok();
    }

    @PostMapping("/copy")
    public R<List<String>> copy(@RequestBody CopyReq req) throws IOException {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        List<String> created = service.copy(req.getPaths(), req.getDestDir());
        audit.record("LOCAL_FILE_COPY", req.getDestDir(), "OK",
                "复制 " + (created == null ? 0 : created.size()) + " 项");
        return R.ok(created);
    }

    @PostMapping("/delete")
    public R<Void> delete(@RequestBody SftpReq req) throws IOException {
        service.delete(req.getPath());
        audit.record("LOCAL_FILE_DELETE", req.getPath(), "OK", null);
        return R.ok();
    }

    @PostMapping("/upload")
    public R<Map<String, Object>> upload(@RequestParam String path,
                                         @RequestParam(value = "relativePath", required = false) String relativePath,
                                         @RequestParam(value = "conflict", required = false) String conflict,
                                         @RequestParam("file") MultipartFile file)
            throws IOException {
        Map<String, Object> result = service.uploadWithPolicy(path, relativePath, file, conflict);
        boolean skipped = Boolean.TRUE.equals(result.get("skipped"));
        String auditPath = result.get("path") == null ? path : String.valueOf(result.get("path"));
        audit.record("LOCAL_FILE_UPLOAD", auditPath, skipped ? "SKIP" : "OK",
                skipped ? "同名文件，已跳过" : file.getSize() + " bytes");
        return R.ok(result);
    }

    /** 上传前预检本地桌面同名文件 */
    @PostMapping("/upload/conflicts")
    public R<List<Map<String, Object>>> uploadConflicts(@RequestBody UploadConflictReq req)
            throws IOException {
        if (req == null || req.getDir() == null) {
            throw new IllegalArgumentException("缺少目标目录");
        }
        List<SftpService.UploadConflictFile> files = new ArrayList<>();
        if (req.getFiles() != null) {
            for (UploadConflictReq.FileItem item : req.getFiles()) {
                if (item != null) {
                    files.add(new SftpService.UploadConflictFile(
                            item.getRelativePath(), item.getName(), item.getSize()));
                }
            }
        }
        return R.ok(service.checkUploadConflicts(req.getDir(), files));
    }

    /** 普通下载：支持 HTTP Range，浏览器或下载工具可断点续传。 */
    @GetMapping("/download")
    public void download(@RequestParam String path, HttpServletRequest req,
                         HttpServletResponse resp) throws IOException {
        String name = baseName(path);
        long[] stat = service.fileStat(path);
        long size = stat[0];
        String etag = "\"" + size + "-" + stat[1] + "\"";
        String lastModified = SftpController.httpDate(stat[1]);
        resp.setContentType("application/octet-stream");
        resp.setHeader("Content-Disposition", SftpController.contentDisposition("attachment", name));
        resp.setHeader("Accept-Ranges", "bytes");
        resp.setHeader("Cache-Control", "no-store");
        resp.setHeader("ETag", etag);
        resp.setHeader("Last-Modified", lastModified);
        long start = 0;
        long end = size > 0 ? size - 1 : 0;
        boolean partial = false;
        String rangeHeader = req.getHeader("Range");
        String ifRange = req.getHeader("If-Range");
        if (rangeHeader != null && ifRange != null && !ifRange.trim().isEmpty()
                && !ifRange.trim().equals(etag) && !ifRange.trim().equals(lastModified)) {
            rangeHeader = null;
        }
        if (rangeHeader != null && !rangeHeader.trim().isEmpty()) {
            long[] span = SftpController.parseRange(rangeHeader, size);
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
        audit.record("LOCAL_FILE_DOWNLOAD", path, "OK", null);
        if (length <= 0 || "HEAD".equalsIgnoreCase(req.getMethod())) {
            return;
        }
        try {
            service.streamRange(path, start, length, resp.getOutputStream());
        } catch (IOException clientGone) {
            // 浏览器取消下载或网络中断
        }
    }

    @PostMapping("/content-search")
    public R<List<FileContentMatch>> contentSearch(@RequestBody ContentSearchReq req) throws IOException {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        return R.ok(service.contentSearch(req.getRoot(), req.getKeyword(), req.getInclude(),
                req.isCaseSensitive(), req.getMaxResults()));
    }

    @GetMapping("/checksum")
    public R<FileChecksumResult> checksum(@RequestParam String path,
                                         @RequestParam(value = "algorithm", defaultValue = "sha256")
                                                 String algorithm) throws IOException {
        return R.ok(service.checksum(path, algorithm));
    }

    @GetMapping("/preview")
    public void preview(@RequestParam String path, HttpServletResponse resp) throws IOException {
        String name = baseName(path);
        String contentType = SftpController.imageContentType(name);
        if (contentType == null) {
            throw new IllegalArgumentException("该文件类型不支持图片预览");
        }
        resp.setContentType(contentType);
        resp.setHeader("Content-Disposition", SftpController.contentDisposition("inline", name));
        resp.setHeader("Cache-Control", "private, max-age=300");
        resp.setHeader("X-Content-Type-Options", "nosniff");
        service.download(path, resp.getOutputStream());
    }

    @GetMapping("/video")
    public void video(@RequestParam String path, HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        String contentType = SftpController.videoContentType(baseName(path));
        if (contentType == null) {
            throw new IllegalArgumentException("该文件类型不支持视频预览");
        }
        streamMedia(path, req, resp, contentType);
    }

    @GetMapping("/audio")
    public void audio(@RequestParam String path, HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        String contentType = SftpController.audioContentType(baseName(path));
        if (contentType == null) {
            throw new IllegalArgumentException("该文件类型不支持音频预览");
        }
        streamMedia(path, req, resp, contentType);
    }

    private void streamMedia(String path, HttpServletRequest req, HttpServletResponse resp,
                             String contentType) throws IOException {
        String name = baseName(path);
        long size = service.fileSize(path);
        resp.setContentType(contentType);
        resp.setHeader("Accept-Ranges", "bytes");
        resp.setHeader("Content-Disposition", SftpController.contentDisposition("inline", name));
        resp.setHeader("Cache-Control", "private, max-age=300");
        resp.setHeader("X-Content-Type-Options", "nosniff");

        long start = 0;
        long end = size > 0 ? size - 1 : 0;
        boolean partial = false;
        String rangeHeader = req.getHeader("Range");
        if (rangeHeader != null && !rangeHeader.trim().isEmpty()) {
            long[] span = SftpController.parseRange(rangeHeader, size);
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
            service.streamRange(path, start, length, resp.getOutputStream());
        } catch (IOException clientGone) {
            // 浏览器取消播放或拖动进度条
        }
    }

    @GetMapping("/thumbnail")
    public void thumbnail(@RequestParam String path,
                          @RequestParam(value = "size", defaultValue = "200") int size,
                          HttpServletResponse resp) {
        String name = baseName(path);
        String contentType = SftpController.imageContentType(name);
        if (contentType == null) {
            sendError(resp, HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE);
            return;
        }
        byte[] source;
        try {
            source = service.readBytes(path, LocalDesktopService.maxThumbSource());
        } catch (IllegalArgumentException tooLarge) {
            sendError(resp, HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            return;
        } catch (IOException readFailed) {
            sendError(resp, HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        resp.setHeader("Cache-Control", "private, max-age=300");
        resp.setHeader("X-Content-Type-Options", "nosniff");
        if ("image/svg+xml".equals(contentType)) {
            writeImage(resp, contentType, source);
            return;
        }
        try {
            ImageThumbnails.Thumb thumb = ImageThumbnails.create(source, size);
            writeImage(resp, thumb.getContentType(), thumb.getData());
        } catch (Exception decodeFailed) {
            sendError(resp, HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE);
        }
    }

    private static String baseName(String path) {
        String p = path == null ? "" : path.replace('\\', '/');
        int idx = p.lastIndexOf('/');
        return idx >= 0 ? p.substring(idx + 1) : p;
    }

    private static void writeImage(HttpServletResponse resp, String contentType, byte[] data) {
        try {
            resp.setContentType(contentType);
            resp.setContentLength(data.length);
            OutputStream out = resp.getOutputStream();
            out.write(data);
        } catch (IOException ignore) {
            // 浏览器取消加载
        }
    }

    private static void sendError(HttpServletResponse resp, int status) {
        try {
            resp.sendError(status);
        } catch (IOException ignore) {
            // ignore
        }
    }
}
