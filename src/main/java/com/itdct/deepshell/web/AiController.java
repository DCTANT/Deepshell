package com.itdct.deepshell.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.AiAgentService;
import com.itdct.deepshell.service.AiCommandService;
import com.itdct.deepshell.service.AiConfigService;
import com.itdct.deepshell.service.AiConversationService;
import lombok.Data;
import org.springframework.web.bind.annotation.*;

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

    public AiController(AiConfigService config, AiCommandService commandService,
                        AiAgentService agentService, AiConversationService convService) {
        this.config = config;
        this.commandService = commandService;
        this.agentService = agentService;
        this.convService = convService;
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
