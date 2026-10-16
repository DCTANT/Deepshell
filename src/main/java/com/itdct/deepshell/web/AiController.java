package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.AiCommandService;
import com.itdct.deepshell.service.AiConfigService;
import lombok.Data;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/ai")
public class AiController {

    private final AiConfigService config;
    private final AiCommandService commandService;

    public AiController(AiConfigService config, AiCommandService commandService) {
        this.config = config;
        this.commandService = commandService;
    }

    @GetMapping("/config")
    public R<Map<String, Object>> getConfig() {
        return R.ok(current());
    }

    @PostMapping("/config")
    public R<Map<String, Object>> saveConfig(@RequestBody AiConfigForm form) {
        config.save(form.getBaseUrl(), form.getApiKey(), form.getModel());
        return R.ok(current());
    }

    @PostMapping("/translate")
    public R<Map<String, String>> translate(@RequestBody TranslateForm form) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("command", commandService.translate(form.getText(), form.getCwd()));
        return R.ok(m);
    }

    private Map<String, Object> current() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("baseUrl", config.baseUrl());
        m.put("model", config.model());
        m.put("hasKey", !config.apiKey().isEmpty());
        return m;
    }

    @Data
    public static class AiConfigForm {
        private String baseUrl;
        private String apiKey;
        private String model;
    }

    @Data
    public static class TranslateForm {
        private String text;
        private String cwd;
    }
}
