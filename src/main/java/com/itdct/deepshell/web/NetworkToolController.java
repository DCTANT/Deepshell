package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.FirewallPortService;
import com.itdct.deepshell.service.NetworkToolService;
import com.itdct.deepshell.service.NetworkTrafficService;
import com.itdct.deepshell.service.SudoAccessService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 网络工具箱：连通性测试与服务器进程级实时流量 */
@RestController
@RequestMapping("/api/nettools")
public class NetworkToolController {

    private final NetworkToolService service;
    private final NetworkTrafficService traffic;
    private final FirewallPortService firewallPorts;
    private final SudoAccessService sudoAccess;

    public NetworkToolController(NetworkToolService service, NetworkTrafficService traffic,
                                 FirewallPortService firewallPorts, SudoAccessService sudoAccess) {
        this.service = service;
        this.traffic = traffic;
        this.firewallPorts = firewallPorts;
        this.sudoAccess = sudoAccess;
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
                Boolean.TRUE.equals(req.getReset()), Boolean.TRUE.equals(req.getRoot())));
    }

    /** 监听端口与防火墙状态：只读快照，root=true 时通过已授权的 sudo 读取完整信息。 */
    @PostMapping("/ports")
    public R<Map<String, Object>> ports(@RequestBody PortsReq req) throws Exception {
        if (req == null || req.getSessionId() == null || req.getSessionId().trim().isEmpty()) {
            throw new IllegalArgumentException("缺少会话 ID");
        }
        return R.ok(firewallPorts.snapshot(req.getSessionId().trim(),
                Boolean.TRUE.equals(req.getRoot())));
    }

    @GetMapping("/root")
    public R<Map<String, Object>> rootStatus(@RequestParam("sessionId") String sessionId) {
        return R.ok(sudoAccess.status(requireSession(sessionId)));
    }

    @PostMapping("/root")
    public R<Map<String, Object>> enableRoot(@RequestBody RootReq req) {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        return R.ok(sudoAccess.enable(requireSession(req.getSessionId()), req.getPassword()));
    }

    @DeleteMapping("/root")
    public R<Map<String, Object>> disableRoot(@RequestParam("sessionId") String sessionId) {
        return R.ok(sudoAccess.clear(requireSession(sessionId)));
    }

    private static String requireSession(String sessionId) {
        if (sessionId == null || sessionId.trim().isEmpty()) {
            throw new IllegalArgumentException("缺少会话 ID");
        }
        return sessionId.trim();
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
        private Boolean root;

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

        public Boolean getRoot() {
            return root;
        }

        public void setRoot(Boolean root) {
            this.root = root;
        }
    }

    public static class PortsReq {
        private String sessionId;
        private Boolean root;

        public String getSessionId() {
            return sessionId;
        }

        public void setSessionId(String sessionId) {
            this.sessionId = sessionId;
        }

        public Boolean getRoot() {
            return root;
        }

        public void setRoot(Boolean root) {
            this.root = root;
        }
    }

    public static class RootReq {
        private String sessionId;
        private String password;

        public String getSessionId() {
            return sessionId;
        }

        public void setSessionId(String sessionId) {
            this.sessionId = sessionId;
        }

        public String getPassword() {
            return password;
        }

        public void setPassword(String password) {
            this.password = password;
        }
    }
}
