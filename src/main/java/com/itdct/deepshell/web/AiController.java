package com.itdct.deepshell.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.AiAgentService;
import com.itdct.deepshell.service.AiCancellationToken;
import com.itdct.deepshell.service.AiCommandService;
import com.itdct.deepshell.service.AiCompactionService;
import com.itdct.deepshell.service.AiConfigService;
import com.itdct.deepshell.service.AiConnectivityService;
import com.itdct.deepshell.service.AiConversationService;
import com.itdct.deepshell.service.AiConversationTitleService;
import com.itdct.deepshell.service.AiModelCatalogService;
import lombok.Data;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import javax.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

@RestController
@RequestMapping("/api/ai")
public class AiController {

    private final AiConfigService config;
    private final AiCommandService commandService;
    private final AiAgentService agentService;
    private final AiConversationService convService;
    private final AiConversationTitleService titleService;
    private final AiModelCatalogService catalog;
    private final AiCompactionService compactionService;
    private final AiConnectivityService connectivityService;

    /** runId -> 取消令牌：前端停止时可直接取消服务端生成/命令执行 */
    private final Map<String, AiCancellationToken> activeRuns = new ConcurrentHashMap<>();
    /** SSE 心跳：探测客户端断开，并避免代理因长时间无数据关闭连接 */
    private final ScheduledExecutorService sseHeartbeat = Executors.newScheduledThreadPool(1, r -> {
        Thread t = new Thread(r, "ai-sse-heartbeat");
        t.setDaemon(true);
        return t;
    });

    public AiController(AiConfigService config, AiCommandService commandService,
                        AiAgentService agentService, AiConversationService convService,
                        AiConversationTitleService titleService,
                        AiModelCatalogService catalog, AiCompactionService compactionService,
                        AiConnectivityService connectivityService) {
        this.config = config;
        this.commandService = commandService;
        this.agentService = agentService;
        this.convService = convService;
        this.titleService = titleService;
        this.catalog = catalog;
        this.compactionService = compactionService;
        this.connectivityService = connectivityService;
    }

    @PreDestroy
    void shutdown() {
        sseHeartbeat.shutdownNow();
    }

    @GetMapping("/config")
    public R<Map<String, Object>> getConfig() {
        return R.ok(current());
    }

    @PostMapping("/config")
    public R<Map<String, Object>> saveConfig(@RequestBody AiConfigForm form) {
        config.save(form.getProvider(), form.getBaseUrl(), form.getApiKey(), form.getModel(),
                form.getMaxSteps(), form.getContextWindow());
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
            m.put("recommendedModel", p.getRecommendedModel());
            m.put("keySteps", p.getKeySteps());
            m.put("costLevel", p.getCostLevel());
            m.put("costHint", p.getCostHint());
            m.put("pricingUrl", p.getPricingUrl());
            list.add(m);
        }
        return R.ok(list);
    }

    /** AI 配置向导：用临时参数（不保存）发一次极小的真实请求，返回延迟或可操作错误。 */
    @PostMapping("/test")
    public R<Map<String, Object>> test(@RequestBody AiTestForm form) {
        return R.ok(connectivityService.test(form.getProvider(), form.getBaseUrl(),
                form.getApiKey(), form.getModel()));
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
        checkStepBudget(form);
        return R.ok(agentService.step(form.getSessionId(), form.getCwd(), form.isAuto(), form.getMessages()));
    }

    /**
     * AI 终端：流式一轮对话（SSE）。
     * 事件：delta（模型回复增量文本）→ result（完整结果，含命令/执行输出）或 error。
     */
    @PostMapping(value = "/agent/step/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter agentStepStream(@RequestBody AgentStepForm form) {
        final String runId = form.getRunId();
        final AiCancellationToken token = new AiCancellationToken();
        if (runId != null && !runId.isEmpty()) {
            activeRuns.put(runId, token);
        }
        // 模型生成 + 单条命令最长执行 120s，留足余量；超时由容器断开
        final SseEmitter emitter = new SseEmitter(600_000L);
        emitter.onTimeout(() -> {
            token.cancel();
            try { emitter.complete(); } catch (Exception ignore) { /* ignore */ }
        });
        emitter.onError(e -> {
            token.cancel();
            removeRun(runId, token);
        });
        emitter.onCompletion(() -> {
            token.cancel();
            removeRun(runId, token);
        });
        // 模型长时间不吐字时也能及时发现浏览器已断开，避免后台继续生成
        ScheduledFuture<?> heartbeat = sseHeartbeat.scheduleAtFixedRate(() -> {
            if (token.isCancelled()) {
                return;
            }
            try {
                synchronized (emitter) {
                    emitter.send(SseEmitter.event().comment("ping"));
                }
            } catch (Exception e) {
                token.cancel();
                try {
                    emitter.completeWithError(e);
                } catch (Exception ignore) {
                    // 客户端已断开
                }
            }
        }, 15, 15, TimeUnit.SECONDS);

        Thread worker = new Thread(() -> {
            try {
                checkStepBudget(form);
                AiAgentService.AgentResult r = agentService.stepStream(
                        form.getSessionId(), form.getCwd(), form.isAuto(), form.getMessages(),
                        new Consumer<String>() {
                            @Override
                            public void accept(String text) {
                                if (token.isCancelled()) {
                                    throw new AiCancellationToken.CancelledException();
                                }
                                Map<String, Object> ev = new LinkedHashMap<>();
                                ev.put("type", "delta");
                                ev.put("text", text);
                                sendEvent(emitter, ev, token);
                            }
                        },
                        new Consumer<String>() {
                            @Override
                            public void accept(String text) {
                                if (token.isCancelled()) {
                                    throw new AiCancellationToken.CancelledException();
                                }
                                Map<String, Object> ev = new LinkedHashMap<>();
                                ev.put("type", "reasoning");
                                ev.put("text", text);
                                sendEvent(emitter, ev, token);
                            }
                        }, token);
                if (token.isCancelled()) {
                    completeQuietly(emitter);
                    return;
                }
                Map<String, Object> ev = new LinkedHashMap<>();
                ev.put("type", "result");
                ev.put("result", r);
                sendEvent(emitter, ev, token);
                emitter.complete();
            } catch (AiCancellationToken.CancelledException e) {
                // 用户停止或连接断开：安静收尾，不再回传错误
                completeQuietly(emitter);
            } catch (Throwable e) {
                if (token.isCancelled()) {
                    completeQuietly(emitter);
                    return;
                }
                String msg = (e.getMessage() == null || e.getMessage().isEmpty())
                        ? e.toString() : e.getMessage();
                try {
                    Map<String, Object> ev = new LinkedHashMap<>();
                    ev.put("type", "error");
                    ev.put("message", msg);
                    sendEvent(emitter, ev, token);
                } catch (Throwable ignore) {
                    // 客户端已断开
                }
                completeQuietly(emitter);
            } finally {
                heartbeat.cancel(false);
                removeRun(runId, token);
            }
        }, "ai-agent-stream");
        worker.setDaemon(true);
        worker.start();
        return emitter;
    }

    /** AI 终端：用户确认后执行指定命令（支持按 runId 取消） */
    @PostMapping("/agent/exec")
    public R<AiAgentService.AgentResult> agentExec(@RequestBody AgentExecForm form) {
        final String runId = form.getRunId();
        final AiCancellationToken token = new AiCancellationToken();
        if (runId != null && !runId.isEmpty()) {
            activeRuns.put(runId, token);
        }
        try {
            return R.ok(agentService.exec(form.getSessionId(), form.getCwd(),
                    form.getCommand(), token));
        } finally {
            removeRun(runId, token);
        }
    }

    /** 前端点「停止」时调用：取消模型生成，并终止正在执行的 AI 命令 */
    @PostMapping("/agent/cancel")
    public R<Void> agentCancel(@RequestBody Map<String, String> body) {
        String runId = body == null ? null : body.get("runId");
        AiCancellationToken token = (runId == null || runId.isEmpty())
                ? null : activeRuns.remove(runId);
        if (token != null) {
            token.cancel();
        }
        return R.ok();
    }

    /** 上下文压缩：只生成摘要，不执行任何命令 */
    @PostMapping("/compact")
    public R<AiCompactionService.CompactResult> compact(@RequestBody CompactForm form) {
        if (form == null) {
            throw new IllegalArgumentException("缺少对话内容");
        }
        return R.ok(compactionService.compact(form.getMessages(), form.getCwd()));
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

    /** 分叉对话：默认复制全部消息；msgIndex >= 0 时只复制到该条消息（含） */
    @PostMapping("/convs/{id}/fork")
    public R<AiConversationService.ConvDto> convFork(@PathVariable Long id,
                                                     @RequestBody(required = false) ConvForkForm form) {
        return R.ok(convService.fork(id, form == null ? null : form.getMsgIndex()));
    }

    /** 总结对话标题；force=false 时只替换占位标题，force=true 时覆盖用户当前标题 */
    @PostMapping("/convs/{id}/title")
    public R<AiConversationService.ConvDto> convTitle(@PathVariable Long id,
                                                      @RequestBody(required = false) ConvTitleForm form) {
        boolean force = form != null && Boolean.TRUE.equals(form.getForce());
        return R.ok(titleService.generate(id, force,
                form == null ? null : form.getHint(),
                form == null ? null : form.getExpectedTitle()));
    }

    @PutMapping("/convs/{id}")
    public R<AiConversationService.ConvDto> convSave(@PathVariable Long id, @RequestBody ConvSaveForm form) {
        AiConversationService.ConvForm f = new AiConversationService.ConvForm();
        f.title = form.getTitle();
        f.cwd = form.getCwd();
        f.active = form.getActive();
        f.pinned = form.getPinned();
        f.unread = form.getUnread();
        f.msgs = form.getMsgs();
        return R.ok(convService.save(id, f));
    }

    @DeleteMapping("/convs/{id}")
    public R<Void> convDelete(@PathVariable Long id) {
        convService.delete(id);
        return R.ok();
    }

    /** 单轮步数上限由设置在服务端兜底校验（前端也会在达到上限时暂停） */
    private void checkStepBudget(AgentStepForm form) {
        Integer step = form.getStep();
        if (step == null || step < 1) {
            return;
        }
        int max = config.maxSteps();
        if (step > max) {
            throw new IllegalArgumentException("已达单轮 " + max + " 步上限，如任务未完成请继续发消息说明");
        }
    }

    private static void sendEvent(SseEmitter emitter, Map<String, Object> event,
                                  AiCancellationToken token) {
        if (token.isCancelled()) {
            throw new AiCancellationToken.CancelledException();
        }
        try {
            synchronized (emitter) {
                emitter.send(SseEmitter.event().data(event, MediaType.APPLICATION_JSON));
            }
        } catch (Exception e) {
            token.cancel();
            throw new AiCancellationToken.CancelledException();
        }
    }

    private static void completeQuietly(SseEmitter emitter) {
        try {
            emitter.complete();
        } catch (Exception ignore) {
            // 客户端已断开
        }
    }

    private void removeRun(String runId, AiCancellationToken token) {
        if (runId != null && !runId.isEmpty()) {
            activeRuns.remove(runId, token);
        }
    }

    private Map<String, Object> current() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("provider", catalog.resolveProviderId(config.provider(), config.baseUrl()));
        m.put("baseUrl", config.baseUrl());
        m.put("model", config.model());
        m.put("hasKey", !config.apiKey().isEmpty());
        m.put("maxSteps", config.maxSteps());
        m.put("contextWindow", config.contextWindow());
        return m;
    }

    @Data
    public static class AiConfigForm {
        private String provider;
        private String baseUrl;
        private String apiKey;
        private String model;
        private Integer maxSteps;
        private Integer contextWindow;
    }

    @Data
    public static class ModelsForm {
        private String provider;
        private String baseUrl;
        private String apiKey;
    }

    @Data
    public static class AiTestForm {
        private String provider;
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
        private String runId;
        /** 本轮第几步（1 起），用于服务端校验单轮上限；旧前端不传时不做限制 */
        private Integer step;
        private List<AiAgentService.AgentMessage> messages;
    }

    @Data
    public static class AgentExecForm {
        private String sessionId;
        private String cwd;
        private String command;
        private String runId;
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
        private Boolean pinned;
        private Boolean unread;
        private JsonNode msgs;
    }

    @Data
    public static class ConvTitleForm {
        private String hint;
        private String expectedTitle;
        private Boolean force;
    }

    @Data
    public static class ConvForkForm {
        private Integer msgIndex;
    }

    @Data
    public static class CompactForm {
        private List<AiAgentService.AgentMessage> messages;
        private String cwd;
    }
}
