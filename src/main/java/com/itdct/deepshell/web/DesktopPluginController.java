package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.DesktopPluginService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/** AI 桌面应用插件：安装 / 列表 / 卸载 */
@RestController
@RequestMapping("/api/desktop/plugins")
public class DesktopPluginController {

    private final DesktopPluginService service;

    public DesktopPluginController(DesktopPluginService service) {
        this.service = service;
    }

    @GetMapping
    public R<List<DesktopPluginService.PluginInfo>> list() {
        return R.ok(service.list());
    }

    @PostMapping("/import")
    public R<DesktopPluginService.PluginInfo> install(@RequestParam("file") MultipartFile file)
            throws Exception {
        return R.ok(service.install(file));
    }

    @GetMapping("/builtin")
    public R<List<DesktopPluginService.BuiltinPluginInfo>> builtin() {
        return R.ok(service.listBuiltin());
    }

    @PostMapping("/builtin/{id}/install")
    public R<DesktopPluginService.PluginInfo> installBuiltin(@PathVariable("id") String id)
            throws Exception {
        return R.ok(service.installBundled(id));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable("id") String id) throws Exception {
        service.delete(id);
        return R.ok();
    }
}
