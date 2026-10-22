package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.plugin.PluginRuntimeService;
import com.itdct.deepshell.service.DesktopPluginService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/** AI 桌面应用插件：安装 / 列表 / 卸载 */
@RestController
@RequestMapping("/api/desktop/plugins")
public class DesktopPluginController {

    private final DesktopPluginService service;
    private final PluginRuntimeService runtime;

    public DesktopPluginController(DesktopPluginService service, PluginRuntimeService runtime) {
        this.service = service;
        this.runtime = runtime;
    }

    @GetMapping
    public R<List<DesktopPluginService.PluginInfo>> list() {
        List<DesktopPluginService.PluginInfo> list = service.list();
        for (DesktopPluginService.PluginInfo info : list) {
            info.setBackendLoaded(runtime.isLoaded(info.getId()));
        }
        return R.ok(list);
    }

    @PostMapping("/import")
    public R<DesktopPluginService.PluginInfo> install(@RequestParam("file") MultipartFile file)
            throws Exception {
        DesktopPluginService.PluginInfo info = service.install(file, runtime::unload);
        runtime.markStale(info.getId());
        return R.ok(info);
    }

    @GetMapping("/builtin")
    public R<List<DesktopPluginService.BuiltinPluginInfo>> builtin() {
        return R.ok(service.listBuiltin());
    }

    @PostMapping("/builtin/{id}/install")
    public R<DesktopPluginService.PluginInfo> installBuiltin(@PathVariable("id") String id)
            throws Exception {
        DesktopPluginService.PluginInfo info = service.installBundled(id, runtime::unload);
        runtime.markStale(info.getId());
        return R.ok(info);
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable("id") String id) throws Exception {
        runtime.unload(id);
        service.delete(id);
        runtime.markStale(id);
        return R.ok();
    }
}
