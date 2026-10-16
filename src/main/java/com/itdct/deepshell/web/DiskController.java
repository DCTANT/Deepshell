package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.DiskService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/disk")
public class DiskController {

    private final DiskService service;

    public DiskController(DiskService service) {
        this.service = service;
    }

    /** 分析指定目录的直接子项占用（目录/文件大小降序，含占比） */
    @GetMapping("/analyze")
    public R<Map<String, Object>> analyze(@RequestParam String sessionId, @RequestParam String path) throws Exception {
        return R.ok(service.analyze(sessionId, path));
    }
}
