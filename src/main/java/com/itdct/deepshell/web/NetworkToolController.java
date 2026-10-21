package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.NetworkToolService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 网络工具箱：在目标服务器上执行连通性测试 */
@RestController
@RequestMapping("/api/nettools")
public class NetworkToolController {

    private final NetworkToolService service;

    public NetworkToolController(NetworkToolService service) {
        this.service = service;
    }

    @PostMapping("/run")
    public R<Map<String, Object>> run(@RequestBody RunReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        return R.ok(service.run(req.getSessionId(), req.getTool(), req.getTarget(), req.getPort()));
    }

    public static class RunReq {
        private String sessionId;
        private String tool;
        private String target;
        private Integer port;

        public String getSessionId() {
            return sessionId;
        }

        public void setSessionId(String sessionId) {
            this.sessionId = sessionId;
        }

        public String getTool() {
            return tool;
        }

        public void setTool(String tool) {
            this.tool = tool;
        }

        public String getTarget() {
            return target;
        }

        public void setTarget(String target) {
            this.target = target;
        }

        public Integer getPort() {
            return port;
        }

        public void setPort(Integer port) {
            this.port = port;
        }
    }
}
