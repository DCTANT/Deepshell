package com.itdct.deepshell.web;

import com.itdct.deepshell.common.LocalRequest;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.LocalShellService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** 本机终端可选的 Shell 列表（仅回环访问，不暴露可执行文件路径）。 */
@RestController
@RequestMapping("/api/local-shell")
public class LocalShellController {

    private final LocalShellService localShell;

    public LocalShellController(LocalShellService localShell) {
        this.localShell = localShell;
    }

    @GetMapping("/shells")
    public R<Map<String, Object>> shells(HttpServletRequest request) {
        Map<String, Object> m = new LinkedHashMap<>();
        boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        m.put("platform", windows ? "windows" : "unix");
        if (!LocalRequest.isLoopback(request)) {
            m.put("available", false);
            m.put("message", "本地终端只能在运行 DeepShell 的这台电脑上使用");
            m.put("default", "");
            m.put("shells", new ArrayList<Map<String, Object>>());
            return R.ok(m);
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (LocalShellService.ShellOption option : localShell.shells()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", option.getId());
            item.put("name", option.getName());
            item.put("available", option.isAvailable());
            items.add(item);
        }
        m.put("available", true);
        m.put("default", localShell.defaultShellId());
        m.put("shells", items);
        return R.ok(m);
    }
}
