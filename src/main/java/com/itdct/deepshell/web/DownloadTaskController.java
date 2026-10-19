package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.DownloadTaskService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** 浏览器下载任务的进度查询（下载请求本身仍在 SftpController 中处理） */
@RestController
@RequestMapping("/api/downloads")
public class DownloadTaskController {

    private final DownloadTaskService service;

    public DownloadTaskController(DownloadTaskService service) {
        this.service = service;
    }

    /** 发起下载前创建任务，前端据此轮询进度 */
    @PostMapping("/tasks")
    public R<DownloadTaskService.Task> create(@RequestBody(required = false) Map<String, Object> body) {
        Object name = body == null ? null : body.get("name");
        return R.ok(service.create(name == null ? null : String.valueOf(name)));
    }

    @GetMapping("/tasks/{id}")
    public R<DownloadTaskService.Task> get(@PathVariable String id) {
        return R.ok(service.get(id));
    }
}
