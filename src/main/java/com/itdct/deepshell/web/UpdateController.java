package com.itdct.deepshell.web;

import com.itdct.deepshell.common.LocalRequest;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.UpdateService;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.util.Map;

/** 自动更新接口；只允许本机访问，避免局域网里的其他人触发本机替换程序。 */
@RestController
@RequestMapping("/api/update")
public class UpdateController {

    private final UpdateService updateService;
    private final AuditService audit;

    public UpdateController(UpdateService updateService, AuditService audit) {
        this.updateService = updateService;
        this.audit = audit;
    }

    @GetMapping("/check")
    public R<Map<String, Object>> check(HttpServletRequest request) {
        LocalRequest.requireLocal(request, "检查更新");
        return R.ok(updateService.check());
    }

    @PostMapping("/download")
    public R<Map<String, Object>> download(HttpServletRequest request) {
        LocalRequest.requireLocal(request, "下载更新");
        Map<String, Object> r = updateService.startDownload();
        audit.record("UPDATE", "download", "OK", String.valueOf(r.get("version")));
        return R.ok(r);
    }

    @GetMapping("/download/status")
    public R<Map<String, Object>> downloadStatus(HttpServletRequest request) {
        LocalRequest.requireLocal(request, "查看更新下载进度");
        return R.ok(updateService.downloadView());
    }

    @PostMapping("/install")
    public R<Map<String, Object>> install(HttpServletRequest request) {
        LocalRequest.requireLocal(request, "安装更新");
        Map<String, Object> r = updateService.installDownloaded();
        audit.record("UPDATE", "install", "OK", String.valueOf(r.get("message")));
        return R.ok(r);
    }
}
