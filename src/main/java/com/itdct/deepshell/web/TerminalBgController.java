package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.BackgroundImageService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** 终端背景图片（数据目录 bg/） */
@RestController
@RequestMapping("/api/terminal-bg")
public class TerminalBgController {

    private final BackgroundImageService service;

    public TerminalBgController(BackgroundImageService service) {
        this.service = service;
    }

    @PostMapping
    public R<String> upload(@RequestParam("file") MultipartFile file) throws Exception {
        return R.ok(service.upload("terminal", file));
    }

    @GetMapping("/img")
    public ResponseEntity<byte[]> img() throws Exception {
        return service.image("terminal");
    }
}
