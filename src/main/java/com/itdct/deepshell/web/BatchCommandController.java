package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.BatchCommandService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 多机命令：一条命令并行发送到多台已保存连接 */
@RestController
@RequestMapping("/api/batch-command")
public class BatchCommandController {

    private final BatchCommandService service;

    public BatchCommandController(BatchCommandService service) {
        this.service = service;
    }

    @PostMapping("/run")
    public R<Map<String, Object>> run(@RequestBody RunReq req) {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        return R.ok(service.run(req.getConnectionIds(), req.getCommand(), req.getTimeoutSec()));
    }

    public static class RunReq {
        private List<Long> connectionIds;
        private String command;
        private Integer timeoutSec;

        public List<Long> getConnectionIds() {
            return connectionIds;
        }

        public void setConnectionIds(List<Long> connectionIds) {
            this.connectionIds = connectionIds;
        }

        public String getCommand() {
            return command;
        }

        public void setCommand(String command) {
            this.command = command;
        }

        public Integer getTimeoutSec() {
            return timeoutSec;
        }

        public void setTimeoutSec(Integer timeoutSec) {
            this.timeoutSec = timeoutSec;
        }
    }
}
