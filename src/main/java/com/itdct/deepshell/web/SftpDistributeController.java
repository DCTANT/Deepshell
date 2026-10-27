package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.CrossTransferReq;
import com.itdct.deepshell.service.SftpDistributeService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

/** SFTP 批量分发：本地文件 -> 多台服务器同一目录 */
@RestController
@RequestMapping("/api/sftp/distribute")
public class SftpDistributeController {

    private final SftpDistributeService service;

    public SftpDistributeController(SftpDistributeService service) {
        this.service = service;
    }

    @PostMapping
    public R<Map<String, Object>> distribute(
            @RequestParam(value = "files", required = false) List<MultipartFile> files,
            @RequestParam(value = "connectionIds", required = false) List<Long> connectionIds,
            @RequestParam(value = "targetPath", required = false) String targetPath,
            @RequestParam(value = "conflict", required = false) String conflict) throws Exception {
        return R.ok(service.distribute(files, connectionIds, targetPath, conflict));
    }

    @PostMapping("/cross")
    public R<Map<String, Object>> cross(@RequestBody CrossTransferReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        return R.ok(service.crossTransfer(req.getSessionId(), req.getPaths(),
                req.getConnectionIds(), req.getTargetPath(), req.getConflict()));
    }

    @GetMapping("/{taskId}")
    public R<Map<String, Object>> get(@PathVariable String taskId) {
        return R.ok(service.get(taskId));
    }

    @PostMapping("/{taskId}/cancel")
    public R<Map<String, Object>> cancel(@PathVariable String taskId) {
        return R.ok(service.cancel(taskId));
    }

    @PostMapping("/{taskId}/retry")
    public R<Map<String, Object>> retry(@PathVariable String taskId) {
        return R.ok(service.retry(taskId));
    }
}
