package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.ArchiveReq;
import com.itdct.deepshell.dto.SftpEntry;
import com.itdct.deepshell.dto.SftpReq;
import com.itdct.deepshell.service.ArchiveService;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.SftpService;
import com.itdct.deepshell.service.TransferService;
import com.itdct.deepshell.service.VscodeEditService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.servlet.http.HttpServletResponse;
import java.net.URLEncoder;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sftp")
public class SftpController {

    private final SftpService sftp;
    private final VscodeEditService vscodeEditService;
    private final ArchiveService archiveService;
    private final TransferService transferService;
    private final AuditService audit;

    public SftpController(SftpService sftp, VscodeEditService vscodeEditService,
                          ArchiveService archiveService, TransferService transferService,
                          AuditService audit) {
        this.sftp = sftp;
        this.vscodeEditService = vscodeEditService;
        this.archiveService = archiveService;
        this.transferService = transferService;
        this.audit = audit;
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
                         HttpServletResponse resp) throws Exception {
        String name = path.substring(path.lastIndexOf('/') + 1);
        resp.setContentType("application/octet-stream");
        resp.setHeader("Content-Disposition", "attachment; filename=\"" + name
                + "\"; filename*=UTF-8''" + URLEncoder.encode(name, "UTF-8").replace("+", "%20"));
        audit.record("FILE_DOWNLOAD", path, "OK", null);
        sftp.download(sessionId, path, resp.getOutputStream());
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
        String safeName = name.replace("\\", "_").replace("\"", "_")
                .replace("\r", "_").replace("\n", "_");
        resp.setContentType(contentType);
        resp.setHeader("Content-Disposition", "inline; filename=\"" + safeName
                + "\"; filename*=UTF-8''" + URLEncoder.encode(name, "UTF-8").replace("+", "%20"));
        // 缩略图使用稳定的 mtime 版本号，允许浏览器缓存；完整预览会带新的时间戳绕过缓存
        resp.setHeader("Cache-Control", "private, max-age=300");
        resp.setHeader("X-Content-Type-Options", "nosniff");
        sftp.download(sessionId, path, resp.getOutputStream());
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
