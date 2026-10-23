package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * AI 配置向导的「一键测试」：用极小的真实请求验证地址 / Key / 模型是否可用。
 * 失败时返回可操作的步骤（换 Key、改地址、看余额/额度），而不是只显示 HTTP 状态码。
 */
@Slf4j
@Service
public class AiConnectivityService {

    private final AiConfigService config;
    private final AiModelCatalogService catalog;
    private final RestTemplate rest;
    private final ObjectMapper om = new ObjectMapper();

    public AiConnectivityService(AiConfigService config, AiModelCatalogService catalog) {
        this.config = config;
        this.catalog = catalog;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(8000);
        factory.setReadTimeout(30000);
        this.rest = new RestTemplate(factory);
    }

    public Map<String, Object> test(String providerId, String baseUrl, String apiKey, String model) {
        AiModelCatalogService.Provider provider = catalog.provider(providerId);
        String pid = provider == null ? catalog.resolveProviderId(providerId, baseUrl) : provider.getId();
        if (provider == null) {
            provider = catalog.provider(pid);
        }
        String base = firstNonBlank(baseUrl, provider == null ? "" : provider.getBaseUrl());
        if (base.isEmpty()) {
            base = config.baseUrl();
        }
        String key = firstNonBlank(apiKey, config.apiKey());
        String useModel = firstNonBlank(model, provider == null ? "" : provider.getRecommendedModel());
        if (useModel.isEmpty()) {
            useModel = config.model();
        }
        if (base.isEmpty()) {
            return failure(provider, "NO_BASE_URL", "还没有填写 API 地址",
                    "请在设置中填写厂商提供的 OpenAI 兼容接口地址。", new ArrayList<String>());
        }
        if (key.isEmpty()) {
            return failure(provider, "NO_KEY", "还没有填写 API Key",
                    "把厂商控制台创建的 Key 粘贴到「API Key」输入框。", new ArrayList<String>());
        }
        if (useModel.isEmpty()) {
            return failure(provider, "NO_MODEL", "还没有选择模型",
                    "从推荐模型中选择一个，或直接填写厂商的模型 ID。", new ArrayList<String>());
        }

        String url = trimSlashes(base) + "/chat/completions";
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", useModel);
        List<Map<String, String>> messages = new ArrayList<>();
        Map<String, String> msg = new LinkedHashMap<>();
        msg.put("role", "user");
        msg.put("content", "只回复 OK 两个字母，不要解释。");
        messages.add(msg);
        body.put("messages", messages);
        body.put("max_tokens", 16);
        body.put("temperature", 0);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(key);
        long start = System.currentTimeMillis();
        try {
            String raw = rest.postForObject(url, new HttpEntity<>(body, headers), String.class);
            long elapsed = System.currentTimeMillis() - start;
            JsonNode root = om.readTree(raw == null ? "{}" : raw);
            String reply = root.path("choices").path(0).path("message").path("content").asText("");
            JsonNode usage = root.path("usage");
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("ok", true);
            result.put("latencyMs", elapsed);
            result.put("model", useModel);
            result.put("reply", reply);
            if (usage.isObject()) {
                Map<String, Object> u = new LinkedHashMap<>();
                u.put("promptTokens", usage.path("prompt_tokens").asInt(0));
                u.put("completionTokens", usage.path("completion_tokens").asInt(0));
                result.put("usage", u);
            }
            result.put("message", "连接成功，耗时 " + elapsed + " ms");
            return result;
        } catch (HttpStatusCodeException e) {
            long elapsed = System.currentTimeMillis() - start;
            int code = e.getStatusCode().value();
            String detail = errorDetail(e);
            log.warn("AI 测试失败 {} HTTP {}: {}", pid, code, detail);
            return httpFailure(provider, url, useModel, code, detail, elapsed);
        } catch (ResourceAccessException e) {
            long elapsed = System.currentTimeMillis() - start;
            return failure(provider, "NETWORK", "网络连接失败",
                    "没有连上模型服务，通常是网络、代理或接口地址问题。", stepsNetwork(provider, base), elapsed,
                    base, e.getMessage());
        } catch (Exception e) {
            long elapsed = System.currentTimeMillis() - start;
            return failure(provider, "UNKNOWN", "测试失败",
                    "请求模型服务时出错：" + shorten(e.getMessage()), stepsGeneric(provider), elapsed,
                    base, e.getMessage());
        }
    }

    private Map<String, Object> httpFailure(AiModelCatalogService.Provider provider, String url,
                                            String model, int code, String detail, long elapsed) {
        String keyUrl = provider == null ? "" : provider.getKeyUrl();
        String pricingUrl = provider == null ? "" : provider.getPricingUrl();
        List<String> steps = new ArrayList<>();
        String title;
        String summary;
        if (code == 401) {
            title = "API Key 无效或已失效";
            summary = "服务端不认这个 Key，或 Key 已被删除 / 过期。";
            steps.add("打开「获取 API Key」页面重新创建一个 Key：" + safeUrl(keyUrl));
            steps.add("复制时确认没有漏掉开头或结尾，也不要带空格、引号。");
            steps.add("如果刚创建 Key，等 1~2 分钟再测试；部分厂商需要先开通模型服务。");
            steps.add("确认没有把「接口密钥」和「登录密码」弄混。");
        } else if (code == 403) {
            title = "这个 Key 没有调用权限";
            summary = "Key 有效，但账号 / 子账号没有开通对应模型或接口权限。";
            steps.add("在厂商控制台确认已开通 Chat Completions / 模型服务。");
            steps.add("检查账号是否欠费、是否完成实名认证。");
            steps.add("子账号需要让主账号授予模型调用权限。");
        } else if (code == 404) {
            title = "接口地址或模型名不对";
            summary = "服务端找不到这个接口或模型。";
            steps.add("把「API 地址」重置为厂商默认值；自定义服务确认地址以 /v1 结尾。");
            steps.add("点「刷新列表」选择厂商返回的模型，不要手写不存在的模型 ID。");
            steps.add("确认没有多写 /chat/completions（DeepShell 会自动拼接）。");
        } else if (code == 429) {
            title = "请求太频繁或额度用尽";
            summary = "触发了厂商限流，或免费额度 / 余额已用完。";
            steps.add("等 1 分钟再点测试；不要连续快速点击。");
            steps.add("到厂商控制台查看余额、免费额度与限流说明。");
            steps.add("换一个更轻量的模型（如 flash / mini 系列）再试。");
        } else if (code == 400) {
            title = "请求被模型拒绝";
            summary = "请求参数或模型 ID 不被接受。";
            steps.add("确认模型 ID 与厂商当前提供的名称完全一致。");
            steps.add("点「刷新列表」重新选择模型；自定义服务检查是否兼容 OpenAI 接口。");
            steps.add("如果厂商要求额外参数（如 group、version），请使用厂商的 OpenAI 兼容地址。");
        } else if (code >= 500) {
            title = "模型服务暂时不可用";
            summary = "厂商服务端返回 " + code + "，通常是临时故障。";
            steps.add("等几分钟后重新测试。");
            steps.add("查看厂商状态页 / 公告，确认是否在维护。");
            steps.add("换一个模型或厂商确认是否是单个模型的问题。");
        } else {
            title = "模型服务返回 HTTP " + code;
            summary = "厂商拒绝了请求，具体原因见下方技术详情。";
            steps.add("检查 API 地址、Key、模型 ID 是否匹配同一家厂商。");
            steps.add("到厂商控制台查看余额、权限与接口状态。");
            steps.add("仍失败时把技术详情发给模型服务商。");
        }
        if (pricingUrl != null && !pricingUrl.isEmpty()) {
            steps.add("费用 / 额度说明：" + pricingUrl);
        }
        return failure(provider, "HTTP_" + code, title, summary, steps, elapsed, url, detail);
    }

    private static List<String> stepsNetwork(AiModelCatalogService.Provider provider, String base) {
        List<String> steps = new ArrayList<>();
        steps.add("确认这台电脑能正常上网；打开厂商官网测试。");
        steps.add("如果使用代理 / VPN，请让 DeepShell 进程也走同样的代理，或先关闭代理再试。");
        steps.add("检查 API 地址是否完整：" + (base == null ? "" : base));
        steps.add("公司网络可能拦截外部 API，换手机热点测试可以快速判断。");
        return steps;
    }

    private static List<String> stepsGeneric(AiModelCatalogService.Provider provider) {
        List<String> steps = new ArrayList<>();
        steps.add("重新检查 API 地址、Key 与模型 ID 是否属于同一家厂商。");
        if (provider != null && provider.getKeyUrl() != null && !provider.getKeyUrl().isEmpty()) {
            steps.add("重新生成 Key：" + provider.getKeyUrl());
        }
        steps.add("换一个模型再试，排除单个模型不可用。");
        steps.add("把下方技术详情发给模型服务商排查。");
        return steps;
    }

    private Map<String, Object> failure(AiModelCatalogService.Provider provider, String code,
                                        String title, String summary, List<String> steps) {
        return failure(provider, code, title, summary, steps, 0, "", "");
    }

    private Map<String, Object> failure(AiModelCatalogService.Provider provider, String code,
                                        String title, String summary, List<String> steps,
                                        long elapsed, String url, String detail) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", code);
        error.put("title", title);
        error.put("summary", summary);
        error.put("steps", steps);
        if (provider != null) {
            error.put("providerName", provider.getName());
            error.put("keyUrl", provider.getKeyUrl());
            error.put("pricingUrl", provider.getPricingUrl());
        }
        if (url != null && !url.isEmpty()) {
            error.put("requestUrl", url);
        }
        if (detail != null && !detail.trim().isEmpty()) {
            error.put("detail", shorten(detail));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", false);
        result.put("latencyMs", elapsed);
        result.put("error", error);
        result.put("message", title);
        return result;
    }

    private static String errorDetail(HttpStatusCodeException e) {
        String body = e.getResponseBodyAsString();
        if (body != null && !body.trim().isEmpty()) {
            try {
                JsonNode root = new ObjectMapper().readTree(body);
                String detail = root.path("error").path("message").asText("");
                if (detail.isEmpty()) {
                    detail = root.path("message").asText("");
                }
                if (!detail.isEmpty()) {
                    return detail;
                }
            } catch (Exception ignore) {
                // 返回原始文本
            }
            return body;
        }
        return e.getStatusText();
    }

    private static String firstNonBlank(String a, String b) {
        if (a != null && !a.trim().isEmpty()) {
            return a.trim();
        }
        return b == null ? "" : b.trim();
    }

    private static String trimSlashes(String s) {
        String t = s == null ? "" : s.trim();
        while (t.endsWith("/")) {
            t = t.substring(0, t.length() - 1);
        }
        return t;
    }

    private static String safeUrl(String url) {
        return url == null || url.isEmpty() ? "厂商控制台的 API Key 页面" : url;
    }

    private static String shorten(String text) {
        if (text == null) {
            return "";
        }
        String oneLine = text.replace('\r', ' ').replace('\n', ' ').trim();
        return oneLine.length() > 500 ? oneLine.substring(0, 500) + "…" : oneLine;
    }
}
