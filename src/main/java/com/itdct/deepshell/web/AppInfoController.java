package com.itdct.deepshell.web;

import com.itdct.deepshell.common.DataDir;
import com.itdct.deepshell.common.R;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/app-info")
public class AppInfoController {

    @GetMapping
    public R<Map<String, String>> info() {
        Map<String, String> m = new HashMap<>();
        m.put("name", "DeepShell");
        String v = AppInfoController.class.getPackage().getImplementationVersion();
        m.put("version", v == null ? "1.2.0" : v);
        m.put("java", System.getProperty("java.version"));
        m.put("os", System.getProperty("os.name") + " " + System.getProperty("os.arch"));
        m.put("dataDir", DataDir.root().toString());
        return R.ok(m);
    }
}
