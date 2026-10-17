package com.itdct.deepshell.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.AiAgentService;
import com.itdct.deepshell.service.AiCommandService;
import com.itdct.deepshell.service.AiConfigService;
import com.itdct.deepshell.service.AiConversationService;
import com.itdct.deepshell.service.AiModelCatalogService;
import lombok.Data;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/ai")
public class AiController {

    private final AiConfigService config;
    private final AiCommandService commandService;
    private final AiAgentService agentService;
    private final AiConversationService convService;
    private final AiModelCatalogService catalog;

    public AiController(AiConfigService config, AiCommandService commandService,
                        AiAgentService agentService, AiConversationService convService,
                        AiModelCatalogService catalog) {
        this.config = config;
        this.commandService = commandService;
        this.agentService = agentService;
        this.convService = convService;
        this.catalog = catalog;
    }

    @GetMapping("/config")
    public R<Map<String, Object>> getConfig() {
        return R.ok(current());
    }

    @PostMapping("/config")
    public R<Map<String, Object>> saveConfig(@RequestBody AiConfigForm form) {
        config.save(form.getProvider(), form.getBaseUrl(), form.getApiKey(), form.getModel());
        return R.ok(current());
    }

    /** 可选厂商预设（名称 / 默认 API 地址 / Key 获取地址 / 内置常用模型） */
    @GetMapping("/providers")
    public R<List<Map<String, Object>>> providers() {
        List<Map<String, Object>> list = new ArrayList<>();
        for (AiModelCatalogService.Provider p : catalog.providers()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", p.getId());
            m.put("name", p.getName());
            m.put("baseUrl", p.getBaseUrl());
            m.put("keyUrl", p.getKeyUrl());
            m.put("fallbackModels", p.getFallbackModels());
            list.add(m);
        }
        return R.ok(list);
    }

    /** 实时获取指定厂商的模型列表（apiKey 为空时用已保存的；失败回退内置列表并附提示） */
    @PostMapping("/models")
    public R<AiModelCatalogService.ModelList> models(@RequestBody ModelsForm form) {
        return R.ok(catalog.fetchModels(form.getProvider(), form.getBaseUrl(), form.getApiKey()));
    }

    @PostMapping("/translate")
    public R<Map<String, String>> translate(@RequestBody TranslateForm form) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("command", commandService.translate(form.getText(), form.getCwd()));
        return R.ok(m);
    }

    /** AI 终端：一轮对话（调用模型，必要时直接执行命令） */
    @PostMapping("/agent/step")
    public R<AiAgentService.AgentResult> agentStep(@RequestBody AgentStepForm form) {
        return R.ok(agentService.step(form.getSessionId(), form.getCwd(), form.isAuto(), form.getMessages()));
    }

    /** AI 终端：用户确认后执行指定命令 */
    @PostMapping("/agent/exec")
    public R<AiAgentService.AgentResult> agentExec(@RequestBody AgentExecForm form) {
        return R.ok(agentService.exec(form.getSessionId(), form.getCwd(), form.getCommand()));
    }

    /* ---------- AI 终端对话（SQLite 持久化） ---------- */

    @GetMapping("/convs")
    public R<List<AiConversationService.ConvDto>> convList(@RequestParam Long connId) {
        return R.ok(convService.list(connId));
    }

    @PostMapping("/convs")
    public R<AiConversationService.ConvDto> convCreate(@RequestBody ConvCreateForm form) {
        return R.ok(convService.create(form.getConnId()));
    }

    @PutMapping("/convs/{id}")
    public R<AiConversationService.ConvDto> convSave(@PathVariable Long id, @RequestBody ConvSaveForm form) {
        AiConversationService.ConvForm f = new AiConversationService.ConvForm();
        f.title = form.getTitle();
        f.cwd = form.getCwd();
        f.active = form.getActive();
        f.msgs = form.getMsgs();
        return R.ok(convService.save(id, f));
    }

    @DeleteMapping("/convs/{id}")
    public R<Void> convDelete(@PathVariable Long id) {
        convService.delete(id);
        return R.ok();
    }

    private Map<String, Object> current() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("provider", catalog.resolveProviderId(config.provider(), config.baseUrl()));
        m.put("baseUrl", config.baseUrl());
        m.put("model", config.model());
        m.put("hasKey", !config.apiKey().isEmpty());
        return m;
    }

    @Data
    public static class AiConfigForm {
        private String provider;
        private String baseUrl;
        private String apiKey;
        private String model;
    }

    @Data
    public static class ModelsForm {
        private String provider;
        private String baseUrl;
        private String apiKey;
    }

    @Data
    public static class TranslateForm {
        private String text;
        private String cwd;
    }

    @Data
    public static class AgentStepForm {
        private String sessionId;
        private String cwd;
        private boolean auto;
        private List<AiAgentService.AgentMessage> messages;
    }

    @Data
    public static class AgentExecForm {
        private String sessionId;
        private String cwd;
        private String command;
    }

    @Data
    public static class ConvCreateForm {
        private Long connId;
    }

    @Data
    public static class ConvSaveForm {
        private String title;
        private String cwd;
        private Boolean active;
        private JsonNode msgs;
    }
}
