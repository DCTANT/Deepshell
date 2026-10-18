package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.BackgroundImageService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** AI 桌面背景图片（数据目录 bg/desktop/） */
@RestController
@RequestMapping("/api/desktop-bg")
public class DesktopBgController {

    private final BackgroundImageService service;

    public DesktopBgController(BackgroundImageService service) {
        this.service = service;
    }

    @PostMapping
    public R<String> upload(@RequestParam(value = "connId", required = false) Long connId,
                            @RequestParam("file") MultipartFile file) throws Exception {
        return R.ok(service.upload("desktop", connId, file));
    }

    @GetMapping("/img")
    public ResponseEntity<byte[]> img(@RequestParam(value = "connId", required = false) Long connId) throws Exception {
        return service.image("desktop", connId);
    }
}
