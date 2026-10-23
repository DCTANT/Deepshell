package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Data;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * AI 模型厂商预设与模型列表实时获取。
 * 各厂商均提供 OpenAI 兼容的 Chat Completions 接口；模型列表优先从厂商接口实时拉取
 * （OpenAI 风格 GET {base}/models；阿里云百炼走原生 GET /api/v1/models），
 * 拉取失败或未配置 Key 时回退内置常用模型，用户仍可手动输入模型 ID。
 */
@Service
public class AiModelCatalogService {

    /** 单个厂商预设 */
    public static class Provider {
        private final String id;
        private final String name;
        private final String baseUrl;
        private final String keyUrl;
        private final String modelsUrl;
        private final List<String> fallbackModels;
        private final String recommendedModel;
        private final List<String> keySteps;
        private final String costLevel;
        private final String costHint;
        private final String pricingUrl;

        Provider(String id, String name, String baseUrl, String keyUrl, String modelsUrl,
                 List<String> fallbackModels, String recommendedModel, List<String> keySteps,
                 String costLevel, String costHint, String pricingUrl) {
            this.id = id;
            this.name = name;
            this.baseUrl = baseUrl;
            this.keyUrl = keyUrl;
            this.modelsUrl = modelsUrl;
            this.fallbackModels = fallbackModels;
            this.recommendedModel = recommendedModel;
            this.keySteps = keySteps;
            this.costLevel = costLevel;
            this.costHint = costHint;
            this.pricingUrl = pricingUrl;
        }

        public String getId() {
            return id;
        }

        public String getName() {
            return name;
        }

        public String getBaseUrl() {
            return baseUrl;
        }

        public String getKeyUrl() {
            return keyUrl;
        }

        public String getModelsUrl() {
            return modelsUrl;
        }

        public List<String> getFallbackModels() {
            return fallbackModels;
        }

        public String getRecommendedModel() {
            return recommendedModel;
        }

        public List<String> getKeySteps() {
            return keySteps;
        }

        public String getCostLevel() {
            return costLevel;
        }

        public String getCostHint() {
            return costHint;
        }

        public String getPricingUrl() {
            return pricingUrl;
        }
    }

    /** 模型列表拉取结果：models 为可用模型；dynamic 表示是否来自厂商接口实时获取；note 为界面提示 */
    @Data
    public static class ModelList {
        private final List<String> models;
        private final boolean dynamic;
        private final String note;

        public ModelList(List<String> models, boolean dynamic, String note) {
            this.models = models;
            this.dynamic = dynamic;
            this.note = note;
        }
    }

    /** 适配厂商（顺序即界面展示顺序）；base 为 OpenAI 兼容地址（chat/completions 前缀） */
    private static final Map<String, Provider> PRESETS = new LinkedHashMap<>();

    static {
        add("deepseek", "DeepSeek", "https://api.deepseek.com",
                "https://platform.deepseek.com/api_keys", null,
                Arrays.asList("deepseek-v4-pro", "deepseek-flash", "deepseek-chat", "deepseek-reasoner"),
                "deepseek-v4-pro",
                Arrays.asList("打开 DeepSeek 开放平台，用手机号或邮箱注册 / 登录",
                        "在「充值」中按需充值；通常充 10 元就足够日常使用很久",
                        "进入「API keys」→「创建 API key」，复制 sk- 开头的 Key（只完整显示一次）"),
                "低", "按 token 计费，整体便宜：普通问答约几分钱，AI 连续执行 10~20 步约几毛钱。日常任务可换 deepseek-flash 更省。",
                "https://api-docs.deepseek.com/quick_start/pricing");
        add("qwen", "通义千问（Qwen）", "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "https://bailian.console.aliyun.com/", "https://dashscope.aliyuncs.com/api/v1/models",
                Arrays.asList("qwen3.8-max", "qwen3.7-plus", "qwen3.8-flash",
                        "qwen-max", "qwen-plus", "qwen-turbo", "qwen-long"),
                "qwen3.8-flash",
                Arrays.asList("登录阿里云百炼控制台（bailian.console.aliyun.com）",
                        "开通「模型服务」；新用户通常有免费额度，用完后按量付费",
                        "进入「API-KEY 管理」→ 创建 API-KEY，复制到 DeepShell"),
                "低", "flash 型号便宜且有免费额度；max 能力更强、价格更高。日常使用每月通常几元到几十元。",
                "https://help.aliyun.com/zh/model-studio/models");
        add("glm", "智谱 GLM", "https://open.bigmodel.cn/api/paas/v4",
                "https://open.bigmodel.cn/usercenter/apikeys", null,
                Arrays.asList("glm-5.3", "glm-5.3-flash", "glm-4.7-flash", "glm-4-plus", "glm-4-flash"),
                "glm-5.3-flash",
                Arrays.asList("打开智谱开放平台，注册并完成实名认证",
                        "进入「API Keys」页面，创建一个新的 API Key",
                        "复制 Key；如果页面提示资源包 / 余额，按需购买最小额度"),
                "低", "flash 系列价格低，适合日常问答和命令翻译；plus 系列能力更强、费用更高。",
                "https://open.bigmodel.cn/pricing");
        add("minimax", "MiniMax", "https://api.minimaxi.com/v1",
                "https://platform.minimaxi.com/user-center/basic-information/interface-key", null,
                Arrays.asList("MiniMax-M3", "MiniMax-M2", "MiniMax-Text-01", "abab6.5s"),
                "MiniMax-M2",
                Arrays.asList("登录 MiniMax 开放平台并完成实名认证",
                        "在「账户信息」→「接口密钥」中创建 Key",
                        "复制 Key，并确认账户有可用额度"),
                "中", "按 token 计费，价格中等；长上下文和长任务会明显增加费用。",
                "https://platform.minimaxi.com/document/Price");
        add("kimi", "月之暗面 Kimi", "https://api.moonshot.cn/v1",
                "https://platform.moonshot.cn/console/api-keys", null,
                Arrays.asList("kimi-k3", "kimi-k2-0905-preview", "kimi-latest",
                        "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"),
                "kimi-latest",
                Arrays.asList("打开 Moonshot 开放平台，注册并登录",
                        "进入「API Key 管理」→ 新建 API Key",
                        "复制 Key；新用户可能有体验额度，超出后按量计费"),
                "中", "按 token 计费，长上下文模型更贵；日常问答通常几分钱一次。",
                "https://platform.moonshot.cn/docs/pricing/chat");
        add("openai", "OpenAI", "https://api.openai.com/v1",
                "https://platform.openai.com/api-keys", null,
                Arrays.asList("gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"),
                "gpt-4o-mini",
                Arrays.asList("登录 OpenAI 平台（需要海外支付方式）",
                        "在 Billing 中充值，并确认账户有可用额度",
                        "进入「API keys」→「Create new secret key」，复制 sk- 开头的 Key"),
                "中高", "按美元 token 计费；mini 型号较省，GPT-4 系列较贵。国内访问可能需要代理。",
                "https://openai.com/api/pricing/");
        add("custom", "自定义（OpenAI 兼容）", "", "", null, new ArrayList<>(),
                "", new ArrayList<>(),
                "未知", "由你的服务商决定；请确认接口兼容 /chat/completions 与 /models。", "");
    }

    private static void add(String id, String name, String baseUrl, String keyUrl,
                            String modelsUrl, List<String> fallbackModels,
                            String recommendedModel, List<String> keySteps,
                            String costLevel, String costHint, String pricingUrl) {
        PRESETS.put(id, new Provider(id, name, baseUrl, keyUrl, modelsUrl, fallbackModels,
                recommendedModel, keySteps, costLevel, costHint, pricingUrl));
    }

    /** 过滤非对话类模型的名称片段（向量 / 语音 / 图像 / 视频等） */
    private static final String[] NON_CHAT_MARKERS = {
            "embedding", "embed-", "rerank", "whisper", "tts", "asr", "speech",
            "moderation", "dall-e", "sora", "cogview", "cogvideo", "transcription",
            "realtime", "ocr", "wanx"
    };

    private static final int MAX_MODELS = 500;

    private final AiConfigService config;
    private final RestTemplate rest;
    private final ObjectMapper mapper = new ObjectMapper();

    public AiModelCatalogService(AiConfigService config) {
        this.config = config;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(8000);
        factory.setReadTimeout(15000);
        this.rest = new RestTemplate(factory);
    }

    public List<Provider> providers() {
        return new ArrayList<>(PRESETS.values());
    }

    public Provider provider(String id) {
        return id == null ? null : PRESETS.get(id.trim());
    }

    /**
     * 解析当前生效的厂商：已保存的合法厂商优先；否则按 API 地址的域名匹配；都匹配不到按「自定义」。
     */
    public String resolveProviderId(String storedProvider, String baseUrl) {
        Provider stored = provider(storedProvider);
        if (stored != null) {
            return stored.getId();
        }
        String host = hostOf(baseUrl);
        if (!host.isEmpty()) {
            for (Provider p : PRESETS.values()) {
                if (!p.getBaseUrl().isEmpty() && host.equals(hostOf(p.getBaseUrl()))) {
                    return p.getId();
                }
            }
        }
        return "custom";
    }

    private static String hostOf(String url) {
        if (url == null || url.trim().isEmpty()) {
            return "";
        }
        try {
            String h = URI.create(url.trim()).getHost();
            return h == null ? "" : h.toLowerCase(Locale.ROOT);
        } catch (Exception ignore) {
            return "";
        }
    }

    /**
     * 实时获取模型列表：优先请求厂商接口（接口地址可在入参覆盖；apiKey 为空时用已保存的），
     * 失败 / 未配置 Key 时回退该厂商内置常用模型，并通过 note 告知界面原因。
     */
    public ModelList fetchModels(String providerId, String baseUrlOverride, String apiKeyOverride) {
        Provider p = provider(providerId);
        List<String> fallback = p == null ? new ArrayList<>() : new ArrayList<>(p.getFallbackModels());
        String base = firstNonBlank(baseUrlOverride, p == null ? "" : p.getBaseUrl());
        String key = firstNonBlank(apiKeyOverride, config.apiKey());
        if (base.isEmpty()) {
            return new ModelList(fallback, false, "请先填写 API 地址");
        }
        if (key.isEmpty()) {
            return new ModelList(fallback, false, "尚未配置 API Key，暂展示内置常用模型；填写后可点「刷新列表」实时获取");
        }
        String url = p != null && p.getModelsUrl() != null && !p.getModelsUrl().isEmpty()
                ? p.getModelsUrl()
                : trimSlashes(base) + "/models";
        // 百炼原生接口按分页返回，尝试一页取全；若参数不被接受则退回无参请求
        if (url.contains("api/v1/models")) {
            url = url + "?page_no=1&page_size=" + MAX_MODELS;
        }
        String body;
        try {
            body = get(url, key);
        } catch (HttpStatusCodeException e1) {
            if (url.contains("?")) {
                try {
                    body = get(url.substring(0, url.indexOf('?')), key);
                } catch (Exception e2) {
                    return failure(fallback, e2);
                }
            } else {
                return failure(fallback, e1);
            }
        } catch (Exception e) {
            return failure(fallback, e);
        }
        List<String> models;
        try {
            models = parseModels(body);
        } catch (Exception e) {
            return new ModelList(fallback, false, "模型列表解析失败，已展示内置常用模型，也可直接输入模型 ID");
        }
        if (models.isEmpty()) {
            return new ModelList(fallback, false, "接口未返回可用模型，已展示内置常用模型，也可直接输入模型 ID");
        }
        return new ModelList(models, true, "已从接口实时获取 " + models.size() + " 个模型");
    }

    private String get(String url, String key) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(key);
        return rest.getForObject(url, String.class, new HttpEntity<>(headers));
    }

    private static ModelList failure(List<String> fallback, Exception e) {
        String detail;
        if (e instanceof HttpStatusCodeException) {
            int code = ((HttpStatusCodeException) e).getStatusCode().value();
            detail = code == 404 || code == 405
                    ? "该厂商未提供模型列表接口（HTTP " + code + "）"
                    : "获取模型列表失败（HTTP " + code + "）";
        } else {
            detail = "获取模型列表失败（" + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()) + "）";
        }
        return new ModelList(fallback, false, detail + "，已展示内置常用模型，也可直接输入模型 ID");
    }

    /**
     * 兼容解析各厂商的模型列表响应：
     * OpenAI 风格 data[].id / data[].model；百炼原生 output.models[].model；models[].id 等。
     * 过滤非对话类模型、去重，保持接口返回顺序。
     */
    static List<String> parseModels(String json) throws Exception {
        JsonNode root = new ObjectMapper().readTree(json);
        List<String> raw = new ArrayList<>();
        collect(root.path("data"), raw);
        if (raw.isEmpty()) {
            collect(root.path("output").path("models"), raw);
        }
        if (raw.isEmpty()) {
            collect(root.path("models"), raw);
        }
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        for (String m : raw) {
            String id = m == null ? "" : m.trim();
            if (id.isEmpty() || isNonChat(id)) {
                continue;
            }
            seen.add(id);
            if (seen.size() >= MAX_MODELS) {
                break;
            }
        }
        return new ArrayList<>(seen);
    }

    private static void collect(JsonNode arrayNode, List<String> out) {
        if (arrayNode == null || !arrayNode.isArray()) {
            return;
        }
        for (JsonNode item : arrayNode) {
            if (item.isTextual()) {
                out.add(item.asText());
                continue;
            }
            String id = firstNonBlank(text(item, "id"), text(item, "model"));
            if (id.isEmpty()) {
                id = text(item, "name");
            }
            out.add(id);
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.path(field);
        return v.isTextual() ? v.asText("") : "";
    }

    private static boolean isNonChat(String modelId) {
        String t = modelId.toLowerCase(Locale.ROOT);
        for (String marker : NON_CHAT_MARKERS) {
            if (t.contains(marker)) {
                return true;
            }
        }
        return false;
    }

    private static String firstNonBlank(String a, String b) {
        if (a != null && !a.trim().isEmpty()) {
            return a.trim();
        }
        return b == null ? "" : b.trim();
    }

    private static String trimSlashes(String s) {
        String t = s.trim();
        while (t.endsWith("/")) {
            t = t.substring(0, t.length() - 1);
        }
        return t;
    }
}
