package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.LocalDownloadReq;
import com.itdct.deepshell.service.LocalDownloadService;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.util.LinkedHashMap;
import java.util.Map;

/** 下载到本机目录（仅 loopback 访问；目录由服务端原生选择框签发 token） */
@RestController
@RequestMapping("/api/local-download")
public class LocalDownloadController {

    private final LocalDownloadService localDownloadService;

    public LocalDownloadController(LocalDownloadService localDownloadService) {
        this.localDownloadService = localDownloadService;
    }

    /** 当前访问是否来自本机、本机是否有图形界面（用于前端决定是否显示入口） */
    @GetMapping("/status")
    public R<Map<String, Object>> status(HttpServletRequest request) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("local", isLoopback(request));
        result.put("available", localDownloadService.isPickerAvailable());
        return R.ok(result);
    }

    @PostMapping("/pick")
    public R<Map<String, Object>> pick(HttpServletRequest request) {
        requireLocal(request);
        return R.ok(localDownloadService.pickDirectory());
    }

    @PostMapping("/start")
    public R<Map<String, Object>> start(@RequestBody LocalDownloadReq req,
                                        HttpServletRequest request) throws Exception {
        requireLocal(request);
        return R.ok(localDownloadService.start(req));
    }

    @GetMapping("/tasks/{id}")
    public R<Map<String, Object>> task(@PathVariable String id, HttpServletRequest request) {
        requireLocal(request);
        return R.ok(localDownloadService.getTask(id));
    }

    @PostMapping("/tasks/{id}/open")
    public R<Void> openTarget(@PathVariable String id, HttpServletRequest request) {
        requireLocal(request);
        localDownloadService.openTarget(id);
        return R.ok();
    }

    private static void requireLocal(HttpServletRequest request) {
        if (!isLoopback(request)) {
            throw new IllegalArgumentException("仅支持在本机访问（127.0.0.1 / localhost）时下载到本机目录");
        }
    }

    private static boolean isLoopback(HttpServletRequest request) {
        String addr = request.getRemoteAddr();
        if (addr == null) {
            return false;
        }
        try {
            if (InetAddress.getByName(addr).isLoopbackAddress()) {
                return true;
            }
        } catch (Exception ignore) {
            // 继续按字符串判断 IPv4-mapped IPv6
        }
        return "::1".equals(addr) || addr.startsWith("::ffff:127.");
    }
}
