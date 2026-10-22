package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.plugin.PluginRuntimeService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 后端插件通用调用入口。只能调用当前已安装并已加载的插件模块；
 * 桌面插件的沙箱 iframe 通过宿主消息桥访问此接口，不直接接触登录令牌。
 */
@RestController
@RequestMapping("/api/desktop/plugins/runtime")
public class PluginRuntimeController {

    private final PluginRuntimeService runtime;

    public PluginRuntimeController(PluginRuntimeService runtime) {
        this.runtime = runtime;
    }

    @PostMapping("/{id}/invoke")
    public R<Object> invoke(@PathVariable("id") String id, @RequestBody InvokeReq req) {
        if (req == null) {
            throw new IllegalArgumentException("缺少调用参数");
        }
        return R.ok(runtime.invoke(id, req.action, req.payload));
    }

    public static class InvokeReq {
        public String action;
        public Map<String, Object> payload;
    }
}
