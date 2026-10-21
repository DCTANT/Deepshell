package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.ServiceManagerService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 服务与计划任务 */
@RestController
@RequestMapping("/api/services")
public class ServiceManagerController {

    private final ServiceManagerService service;

    public ServiceManagerController(ServiceManagerService service) {
        this.service = service;
    }

    @GetMapping("/list")
    public R<List<Map<String, Object>>> list(@RequestParam String sessionId) throws Exception {
        return R.ok(service.list(sessionId));
    }

    @PostMapping("/action")
    public R<Void> action(@RequestBody ActionReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        service.action(req.getSessionId(), req.getUnit(), req.getAction());
        return R.ok();
    }

    @GetMapping("/cron")
    public R<Map<String, Object>> cron(@RequestParam String sessionId) throws Exception {
        return R.ok(service.cron(sessionId));
    }

    @PostMapping("/cron/add")
    public R<Map<String, Object>> addCron(@RequestBody CronReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        return R.ok(service.addCron(req.getSessionId(), req.getLine()));
    }

    @PostMapping("/cron/delete")
    public R<Map<String, Object>> deleteCron(@RequestBody CronReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        return R.ok(service.deleteCron(req.getSessionId(), req.getLine()));
    }

    public static class ActionReq {
        private String sessionId;
        private String unit;
        private String action;

        public String getSessionId() {
            return sessionId;
        }

        public void setSessionId(String sessionId) {
            this.sessionId = sessionId;
        }

        public String getUnit() {
            return unit;
        }

        public void setUnit(String unit) {
            this.unit = unit;
        }

        public String getAction() {
            return action;
        }

        public void setAction(String action) {
            this.action = action;
        }
    }

    public static class CronReq {
        private String sessionId;
        private String line;

        public String getSessionId() {
            return sessionId;
        }

        public void setSessionId(String sessionId) {
            this.sessionId = sessionId;
        }

        public String getLine() {
            return line;
        }

        public void setLine(String line) {
            this.line = line;
        }
    }
}
