package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.TrashDeleteReq;
import com.itdct.deepshell.dto.TrashDeleteResult;
import com.itdct.deepshell.dto.TrashItem;
import com.itdct.deepshell.dto.TrashReq;
import com.itdct.deepshell.service.RecycleBinService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sftp/trash")
public class RecycleBinController {

    private final RecycleBinService service;

    public RecycleBinController(RecycleBinService service) {
        this.service = service;
    }

    @GetMapping("/list")
    public R<List<TrashItem>> list(@RequestParam String sessionId) throws Exception {
        return R.ok(service.list(sessionId));
    }

    @PostMapping("/delete")
    public R<List<TrashDeleteResult>> delete(@RequestBody TrashDeleteReq req) throws Exception {
        return R.ok(service.delete(req.getSessionId(), req.getItems()));
    }

    @PostMapping("/restore")
    public R<Map<String, Object>> restore(@RequestBody TrashReq req) throws Exception {
        return R.ok(service.restore(req.getSessionId(), req.getId()));
    }

    @PostMapping("/purge")
    public R<Map<String, Object>> purge(@RequestBody TrashReq req) throws Exception {
        return R.ok(service.purge(req.getSessionId(), req.getIds()));
    }

    @PostMapping("/empty")
    public R<Map<String, Object>> empty(@RequestBody TrashReq req) throws Exception {
        return R.ok(service.empty(req.getSessionId()));
    }
}
