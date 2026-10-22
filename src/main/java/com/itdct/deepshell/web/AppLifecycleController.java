package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.AppLifecycleService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/** DeepShell 后端自身的关闭 / 重启（供工作台菜单与 AI 桌面开始菜单调用）。 */
@RestController
@RequestMapping("/api/app-lifecycle")
public class AppLifecycleController {

    private final AppLifecycleService service;

    public AppLifecycleController(AppLifecycleService service) {
        this.service = service;
    }

    @PostMapping("/shutdown")
    public R<Map<String, Object>> shutdown() {
        service.shutdown();
        return R.ok(result("DeepShell 后端服务正在关闭"));
    }

    @PostMapping("/restart")
    public R<Map<String, Object>> restart() throws Exception {
        service.restart();
        return R.ok(result("DeepShell 后端服务正在重启"));
    }

    private static Map<String, Object> result(String message) {
        Map<String, Object> m = new HashMap<>();
        m.put("message", message);
        return m;
    }
}
