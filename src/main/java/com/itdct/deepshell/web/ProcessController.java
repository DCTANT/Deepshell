package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.ProcessEntry;
import com.itdct.deepshell.service.ProcessService;
import lombok.Data;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/process")
public class ProcessController {

    private final ProcessService service;

    public ProcessController(ProcessService service) {
        this.service = service;
    }

    @GetMapping("/list")
    public R<List<ProcessEntry>> list(@RequestParam String sessionId) throws Exception {
        return R.ok(service.list(sessionId));
    }

    /** 进程完整命令行（详情弹窗用，列表数据里的命令行有长度上限） */
    @GetMapping("/detail")
    public R<Map<String, String>> detail(@RequestParam String sessionId, @RequestParam long pid) throws Exception {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("command", service.detail(sessionId, pid));
        return R.ok(m);
    }

    @PostMapping("/kill")
    public R<Void> kill(@RequestBody KillReq req) throws Exception {
        if (req.getPid() == null) {
            throw new IllegalArgumentException("缺少 PID");
        }
        service.kill(req.getSessionId(), req.getPid(), Boolean.TRUE.equals(req.getForce()));
        return R.ok();
    }

    @Data
    public static class KillReq {
        private String sessionId;
        private Long pid;
        private Boolean force;
    }
}
