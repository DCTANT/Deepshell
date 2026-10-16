package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.SftpEntry;
import com.itdct.deepshell.dto.SftpReq;
import com.itdct.deepshell.service.SftpService;
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

    public SftpController(SftpService sftp, VscodeEditService vscodeEditService) {
        this.sftp = sftp;
        this.vscodeEditService = vscodeEditService;
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
        return R.ok();
    }

    /** 新建空文件 */
    @PostMapping("/touch")
    public R<Void> touch(@RequestBody SftpReq req) throws Exception {
        sftp.createFile(req.getSessionId(), req.getPath());
        return R.ok();
    }

    @PostMapping("/rename")
    public R<Void> rename(@RequestBody SftpReq req) throws Exception {
        sftp.rename(req.getSessionId(), req.getPath(), req.getNewName());
        return R.ok();
    }

    /** 拖拽移动：把 path 移动到 destDir 目录下 */
    @PostMapping("/move")
    public R<Void> move(@RequestBody SftpReq req) throws Exception {
        sftp.move(req.getSessionId(), req.getPath(), req.getDestDir());
        return R.ok();
    }

    @PostMapping("/delete")
    public R<Void> delete(@RequestBody SftpReq req) throws Exception {
        sftp.delete(req.getSessionId(), req.getPath());
        return R.ok();
    }

    @GetMapping("/read")
    public R<String> read(@RequestParam String sessionId, @RequestParam String path) throws Exception {
        return R.ok(sftp.readText(sessionId, path));
    }

    @PostMapping("/write")
    public R<Void> write(@RequestBody SftpReq req) throws Exception {
        sftp.writeText(req.getSessionId(), req.getPath(), req.getContent() == null ? "" : req.getContent());
        return R.ok();
    }

    @GetMapping("/download")
    public void download(@RequestParam String sessionId, @RequestParam String path,
                         HttpServletResponse resp) throws Exception {
        String name = path.substring(path.lastIndexOf('/') + 1);
        resp.setContentType("application/octet-stream");
        resp.setHeader("Content-Disposition", "attachment; filename=\"" + name
                + "\"; filename*=UTF-8''" + URLEncoder.encode(name, "UTF-8").replace("+", "%20"));
        sftp.download(sessionId, path, resp.getOutputStream());
    }

    @PostMapping("/upload")
    public R<Void> upload(@RequestParam String sessionId, @RequestParam String path,
                          @RequestParam("file") MultipartFile file) throws Exception {
        sftp.upload(sessionId, path, file);
        return R.ok();
    }

    /** 下载到本地并用 VSCode 打开，保存后自动同步回服务器 */
    @PostMapping("/vscode")
    public R<Map<String, Object>> vscode(@RequestBody SftpReq req) throws Exception {
        return R.ok(vscodeEditService.open(req.getSessionId(), req.getPath()));
    }
}
