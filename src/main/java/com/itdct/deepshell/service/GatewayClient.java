package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 访问其他 DeepShell 执行网关的 HTTP 客户端：探测能力与拼接隧道地址。
 * 自签证书需要用户在网关配置里显式勾选跳过校验，否则按系统信任链校验。
 */
@Service
public class GatewayClient {

    private static final int TIMEOUT_MS = 8000;
    private static final ObjectMapper OM = new ObjectMapper();

    public Map<String, Object> info(String baseUrl, String token, boolean insecureTls) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) java.net.URI.create(join(baseUrl, "/api/gateway/info")).toURL()
                    .openConnection();
            applyTls(conn, insecureTls);
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setRequestMethod("GET");
            conn.setRequestProperty(GatewaySettingsService.HEADER, token == null ? "" : token);
            conn.setRequestProperty("Accept", "application/json");
            int status = conn.getResponseCode();
            String body = readAll(status >= 400 ? conn.getErrorStream() : conn.getInputStream());
            if (status == 401) {
                throw new IllegalStateException("网关 Token 无效");
            }
            if (status == 403) {
                throw new IllegalStateException(message(body, "对方 DeepShell 未启用执行网关"));
            }
            if (status != 200) {
                throw new IllegalStateException("网关返回 HTTP " + status + "：" + message(body, "请检查网关地址与配置"));
            }
            JsonNode root = OM.readTree(body);
            if (root.path("code").asInt(-1) != 0) {
                throw new IllegalStateException(root.path("msg").asText("网关拒绝请求"));
            }
            JsonNode data = root.path("data");
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("enabled", data.path("enabled").asBoolean(false));
            m.put("version", data.path("version").asText(""));
            m.put("maxConnections", data.path("maxConnections").asInt(0));
            m.put("activeTunnels", data.path("activeTunnels").asInt(0));
            m.put("allowlistCount", data.path("allowlistCount").asInt(0));
            return m;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    static String join(String baseUrl, String path) {
        String base = baseUrl == null ? "" : baseUrl.trim();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base + path;
    }

    static URI tunnelUri(String baseUrl, String targetHost, int targetPort) {
        URI base = URI.create(baseUrl.trim());
        String scheme = "https".equalsIgnoreCase(base.getScheme()) ? "wss" : "ws";
        String host = base.getHost();
        if (host == null || host.isEmpty()) {
            throw new IllegalArgumentException("网关地址缺少主机名");
        }
        if (host.indexOf(':') >= 0 && !host.startsWith("[")) {
            host = "[" + host + "]";
        }
        int port = base.getPort();
        String authority = port > 0 ? host + ":" + port : host;
        String prefix = base.getRawPath() == null ? "" : base.getRawPath();
        while (prefix.endsWith("/")) {
            prefix = prefix.substring(0, prefix.length() - 1);
        }
        String target = targetHost == null ? "" : targetHost.trim();
        String query;
        try {
            query = "host=" + URLEncoder.encode(target, "UTF-8") + "&port=" + targetPort;
        } catch (java.io.UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
        return URI.create(scheme + "://" + authority + prefix + "/ws/gateway/tunnel?" + query);
    }

    static SSLContext insecureSslContext() throws Exception {
        TrustManager[] trustAll = new TrustManager[]{new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String authType) {
                // 显式选择跳过校验
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String authType) {
                // 显式选择跳过校验
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        }};
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, trustAll, new SecureRandom());
        return context;
    }

    static HostnameVerifier trustAllHosts() {
        return (hostname, session) -> true;
    }

    private static void applyTls(HttpURLConnection conn, boolean insecureTls) throws Exception {
        if (!(conn instanceof HttpsURLConnection)) {
            return;
        }
        if (insecureTls) {
            HttpsURLConnection https = (HttpsURLConnection) conn;
            https.setSSLSocketFactory(insecureSslContext().getSocketFactory());
            https.setHostnameVerifier(trustAllHosts());
        }
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) {
            return "";
        }
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            try {
                in.close();
            } catch (Exception ignore) {
                // 忽略
            }
        }
    }

    private static String message(String body, String fallback) {
        try {
            String msg = OM.readTree(body).path("msg").asText("");
            return msg.isEmpty() ? fallback : msg;
        } catch (Exception e) {
            return fallback;
        }
    }
}
