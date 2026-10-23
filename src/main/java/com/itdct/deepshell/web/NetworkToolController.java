package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.NetworkToolService;
import com.itdct.deepshell.service.NetworkTrafficService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 网络工具箱：连通性测试与服务器进程级实时流量 */
@RestController
@RequestMapping("/api/nettools")
public class NetworkToolController {

    private final NetworkToolService service;
    private final NetworkTrafficService traffic;

    public NetworkToolController(NetworkToolService service, NetworkTrafficService traffic) {
        this.service = service;
        this.traffic = traffic;
    }

    @PostMapping("/run")
    public R<Map<String, Object>> run(@RequestBody RunReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        return R.ok(service.run(req.getSessionId(), req.getTool(), req.getTarget(), req.getPort()));
    }

    /** 进程级实时流量快照：reset=true 时清空该会话的差分基线。 */
    @PostMapping("/process-traffic")
    public R<Map<String, Object>> processTraffic(@RequestBody TrafficReq req) throws Exception {
        if (req == null || req.getSessionId() == null || req.getSessionId().trim().isEmpty()) {
            throw new IllegalArgumentException("缺少会话 ID");
        }
        return R.ok(traffic.sample(req.getSessionId().trim(),
                Boolean.TRUE.equals(req.getReset())));
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

    public static class TrafficReq {
        private String sessionId;
        private Boolean reset;

        public String getSessionId() {
            return sessionId;
        }

        public void setSessionId(String sessionId) {
            this.sessionId = sessionId;
        }

        public Boolean getReset() {
            return reset;
        }

        public void setReset(Boolean reset) {
            this.reset = reset;
        }
    }
}
