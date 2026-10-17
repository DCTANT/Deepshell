package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AiModelCatalogServiceTest {

    private final AiModelCatalogService catalog = new AiModelCatalogService(new AiConfigService());

    @Test
    void parsesOpenAiStyleData() throws Exception {
        String json = "{\"object\":\"list\",\"data\":["
                + "{\"id\":\"deepseek-v4-pro\",\"object\":\"model\",\"created\":100},"
                + "{\"id\":\"deepseek-flash\",\"object\":\"model\",\"created\":200},"
                + "{\"id\":\"deepseek-v4-pro\",\"object\":\"model\",\"created\":100}]}";
        assertEquals(Arrays.asList("deepseek-v4-pro", "deepseek-flash"),
                AiModelCatalogService.parseModels(json));
    }

    @Test
    void parsesDashScopeNativeOutput() throws Exception {
        String json = "{\"request_id\":\"x\",\"output\":{\"total\":3,\"models\":["
                + "{\"model\":\"qwen3.8-max\"},{\"model\":\"qwen-plus\"},{\"model\":\"text-embedding-v4\"}]}}";
        assertEquals(Arrays.asList("qwen3.8-max", "qwen-plus"),
                AiModelCatalogService.parseModels(json));
    }

    @Test
    void parsesModelsArrayWithModelField() throws Exception {
        String json = "{\"models\":[{\"id\":\"minimax-m2\"},{\"model\":\"MiniMax-M3\"}]}";
        assertEquals(Arrays.asList("minimax-m2", "MiniMax-M3"),
                AiModelCatalogService.parseModels(json));
    }

    @Test
    void filtersNonChatModelsAndDeduplicates() throws Exception {
        String json = "{\"data\":[{\"id\":\"gpt-4o\"},{\"id\":\"text-embedding-3-small\"},"
                + "{\"id\":\"whisper-1\"},{\"id\":\"tts-1\"},{\"id\":\"gpt-4o\"},"
                + "{\"id\":\"dall-e-3\"},{\"id\":\"gpt-4o-mini\"}]}";
        assertEquals(Arrays.asList("gpt-4o", "gpt-4o-mini"),
                AiModelCatalogService.parseModels(json));
    }

    @Test
    void keepsVisionAndReasoningModels() throws Exception {
        String json = "{\"data\":[{\"id\":\"qwen-vl-max\"},{\"id\":\"glm-4v-plus\"},"
                + "{\"id\":\"deepseek-reasoner\"}]}";
        assertEquals(3, AiModelCatalogService.parseModels(json).size());
    }

    @Test
    void invalidJsonThrows() {
        assertThrows(Exception.class, () -> AiModelCatalogService.parseModels("not json"));
    }

    @Test
    void resolveProviderPrefersStoredValidId() {
        assertEquals("custom", catalog.resolveProviderId("custom", "https://api.deepseek.com"));
        assertEquals("glm", catalog.resolveProviderId("glm", "https://example.com/anything"));
    }

    @Test
    void resolveProviderInfersFromLegacyBaseUrl() {
        // 老配置没有 provider 字段：按 API 地址域名推断
        assertEquals("deepseek", catalog.resolveProviderId("", "https://api.deepseek.com"));
        assertEquals("deepseek", catalog.resolveProviderId(null, "https://api.deepseek.com/v1"));
        assertEquals("qwen", catalog.resolveProviderId("", "https://dashscope.aliyuncs.com/compatible-mode/v1"));
        assertEquals("glm", catalog.resolveProviderId("", "https://open.bigmodel.cn/api/paas/v4"));
        assertEquals("minimax", catalog.resolveProviderId("", "https://api.minimaxi.com/v1"));
        assertEquals("custom", catalog.resolveProviderId("", "https://my-gateway.example.com/v1"));
        assertEquals("custom", catalog.resolveProviderId("", ""));
    }

    @Test
    void presetsContainRequestedVendors() {
        List<String> ids = Arrays.asList("deepseek", "qwen", "glm", "minimax", "kimi", "openai", "custom");
        for (String id : ids) {
            AiModelCatalogService.Provider p = catalog.provider(id);
            assertNotNull(p, "缺少厂商预设: " + id);
            assertFalse(p.getName().isEmpty());
        }
        assertTrue(catalog.provider("qwen").getFallbackModels().contains("qwen-plus"));
        assertTrue(catalog.provider("minimax").getFallbackModels().contains("MiniMax-M3"));
        assertTrue(catalog.provider("glm").getFallbackModels().contains("glm-5.3"));
        assertTrue(catalog.provider("custom").getFallbackModels().isEmpty());
    }
}
