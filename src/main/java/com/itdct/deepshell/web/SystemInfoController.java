package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.SystemInfoService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/system")
public class SystemInfoController {

    private final SystemInfoService service;

    public SystemInfoController(SystemInfoService service) {
        this.service = service;
    }

    /** 当前会话对应服务器的系统信息（basic/cpu/cpuUsage/memory/net/disk 分区结构） */
    @GetMapping("/info")
    public R<Map<String, Object>> info(@RequestParam String sessionId) throws Exception {
        return R.ok(service.collect(sessionId));
    }
}
