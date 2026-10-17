package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.PowerService;
import lombok.Data;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/system/power")
public class PowerController {

    private final PowerService service;

    public PowerController(PowerService service) {
        this.service = service;
    }

    /** 远端服务器关机 / 重启（action: shutdown | reboot） */
    @PostMapping
    public R<Map<String, Object>> perform(@RequestBody PowerForm form) {
        return R.ok(service.perform(form.getSessionId(), form.getAction()));
    }

    @Data
    public static class PowerForm {
        private String sessionId;
        private String action;
    }
}
