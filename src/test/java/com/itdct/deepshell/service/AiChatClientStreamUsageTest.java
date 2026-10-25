package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class AiChatClientStreamUsageTest {

    private static class FakeConfig extends AiConfigService {
        private final int port;

        FakeConfig(int port) {
            this.port = port;
        }

        @Override
        public String apiKey() {
            return "test-key";
        }

        @Override
        public String baseUrl() {
            return "http://127.0.0.1:" + port + "/v1";
        }

        @Override
        public String model() {
            return "fake-model";
        }

        @Override
        public String provider() {
            return "custom";
        }
    }

    private static final String SSE = "data: {\"choices\":[{\"delta\":{\"content\":\"hello \"}}]}\n\n"
            + "data: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n\n"
            + "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":5,"
            + "\"total_tokens\":105,\"prompt_tokens_details\":{\"cached_tokens\":60},"
            + "\"completion_tokens_details\":{\"reasoning_tokens\":2}}}\n\n"
            + "data: [DONE]\n\n";

    @Test
    void capturesUsageFromStreamingChunkAndRequestsIncludeUsage() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> requestBody = new AtomicReference<>("");
        server.createContext("/v1/chat/completions", exchange -> {
            requestBody.set(readAll(exchange.getRequestBody()));
            byte[] data = SSE.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/event-stream; charset=utf-8");
            exchange.sendResponseHeaders(200, data.length);
            exchange.getResponseBody().write(data);
            exchange.close();
        });
        server.start();
        try {
            AiChatClient client = new AiChatClient(new FakeConfig(server.getAddress().getPort()));
            List<String> deltas = new ArrayList<>();
            AiChatClient.ChatResult result = client.streamDetailed(
                    "system", history(), deltas::add, null, new AiCancellationToken());

            assertEquals("hello world", result.text);
            assertTrue(requestBody.get().contains("\"stream_options\""));
            assertTrue(requestBody.get().contains("\"include_usage\":true"));
            assertFalse(result.usage.estimated);
            assertEquals(Integer.valueOf(100), result.usage.promptTokens);
            assertEquals(Integer.valueOf(5), result.usage.completionTokens);
            assertEquals(Integer.valueOf(105), result.usage.totalTokens);
            assertEquals(Integer.valueOf(60), result.usage.cachedTokens);
            assertEquals(Integer.valueOf(2), result.usage.reasoningTokens);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void retriesWithoutStreamOptionsWhenProviderRejectsIt() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger calls = new AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            String body = readAll(exchange.getRequestBody());
            calls.incrementAndGet();
            if (body.contains("\"stream_options\"")) {
                byte[] err = "{\"error\":{\"message\":\"Unsupported parameter: stream_options\"}}"
                        .getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(400, err.length);
                exchange.getResponseBody().write(err);
            } else {
                byte[] data = SSE.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "text/event-stream; charset=utf-8");
                exchange.sendResponseHeaders(200, data.length);
                exchange.getResponseBody().write(data);
            }
            exchange.close();
        });
        server.start();
        try {
            AiChatClient client = new AiChatClient(new FakeConfig(server.getAddress().getPort()));
            AiChatClient.ChatResult result = client.streamDetailed(
                    "system", history(), s -> { }, null, new AiCancellationToken());

            assertEquals("hello world", result.text);
            assertEquals(2, calls.get());
            assertEquals(Integer.valueOf(100), result.usage.promptTokens);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void returnsReasoningOnlyDsmlForAgentFallback() throws Exception {
        String dsml = "< | | DSML | | calls>\n"
                + "< | | DSML | | invoke name=\"code_execution\">\n"
                + "< parameter name=\"cmd\">uname -a</ parameter>\n"
                + "</ | | DSML | | invoke>\n"
                + "</ | | DSML | | calls>";
        String sse = "data: {\"choices\":[{\"delta\":{\"reasoning_content\":"
                + new ObjectMapper().writeValueAsString(dsml) + "}}]}\n\n"
                + "data: [DONE]\n\n";
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            byte[] data = sse.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/event-stream; charset=utf-8");
            exchange.sendResponseHeaders(200, data.length);
            exchange.getResponseBody().write(data);
            exchange.close();
        });
        server.start();
        try {
            AiChatClient client = new AiChatClient(new FakeConfig(server.getAddress().getPort()));
            List<String> reasoningDeltas = new ArrayList<>();
            AiChatClient.ChatResult result = client.streamDetailed(
                    "system", history(), s -> { }, reasoningDeltas::add, new AiCancellationToken());

            assertEquals("", result.text);
            assertEquals(1, reasoningDeltas.size());
            assertEquals("uname -a", AiAgentService.dsmlParameter(result.reasoning, "cmd"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void returnsReasoningOnlyBareParameterForAgentFallback() throws Exception {
        String dsml = "<parameter name=\"cmd\">cat /tmp/dsh_cookies.txt</parameter>\n"
                + "<parameter name=\"note\">查看 cookie</parameter>";
        String sse = "data: {\"choices\":[{\"delta\":{\"reasoning_content\":"
                + new ObjectMapper().writeValueAsString(dsml) + "}}]}\n\n"
                + "data: [DONE]\n\n";
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            byte[] data = sse.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/event-stream; charset=utf-8");
            exchange.sendResponseHeaders(200, data.length);
            exchange.getResponseBody().write(data);
            exchange.close();
        });
        server.start();
        try {
            AiChatClient client = new AiChatClient(new FakeConfig(server.getAddress().getPort()));
            List<String> reasoningDeltas = new ArrayList<>();
            AiChatClient.ChatResult result = client.streamDetailed(
                    "system", history(), s -> { }, reasoningDeltas::add, new AiCancellationToken());

            assertEquals("", result.text);
            assertEquals(1, reasoningDeltas.size());
            assertEquals("cat /tmp/dsh_cookies.txt", AiAgentService.dsmlParameter(result.reasoning, "cmd"));
            assertEquals("查看 cookie", AiAgentService.dsmlParameter(result.reasoning, "note"));
        } finally {
            server.stop(0);
        }
    }

    private static List<Map<String, String>> history() {
        Map<String, String> user = new LinkedHashMap<>();
        user.put("role", "user");
        user.put("content", "你好");
        return Arrays.asList(user);
    }

    private static String readAll(InputStream in) {
        try (InputStream is = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[2048];
            int n;
            while ((n = is.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }
}
