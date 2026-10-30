package com.itdct.deepshell.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.itdct.deepshell.common.DataDir;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintStream;
import java.io.UnsupportedEncodingException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Properties;

/**
 * MCP stdio 桥接：AI 客户端（Claude Desktop 等）通过标准输入输出启动本进程，
 * 这里把每行 JSON-RPC 转发给正在运行的 DeepShell 的 /mcp，再把响应写回标准输出。
 * 本身不启动 Spring，也不复用数据库，避免与 GUI 实例产生两个状态。
 */
public final class McpStdioBridge {

    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 300000;

    private static final ObjectMapper OM = new ObjectMapper();
    /** MCP stdio 协议固定 UTF-8；不能依赖 Windows 中文环境的默认 GBK 编码 */
    private static final PrintStream OUT = utf8Stream(FileDescriptor.out);
    private static final PrintStream ERR = utf8Stream(FileDescriptor.err);

    private McpStdioBridge() {
    }

    private static PrintStream utf8Stream(FileDescriptor fd) {
        try {
            return new PrintStream(new FileOutputStream(fd), true, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            return new PrintStream(new FileOutputStream(fd), true);
        }
    }

    public static boolean hasStdioArg(String[] args) {
        if (args == null) {
            return false;
        }
        for (String arg : args) {
            if ("--mcp-stdio".equals(arg)) {
                return true;
            }
        }
        return false;
    }

    /** 在 main() 中、Spring 启动之前调用；返回后进程即可退出。 */
    public static void run(String[] args) {
        log("stdio 桥接启动，数据目录 " + DataDir.root());
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        try {
            String line;
            while ((line = in.readLine()) != null) {
                String message = line.trim();
                if (message.isEmpty()) {
                    continue;
                }
                handleLine(message);
            }
        } catch (Exception e) {
            log("stdio 桥接异常退出：" + e.getMessage());
        }
        log("stdin 已关闭，stdio 桥接退出");
    }

    private static void handleLine(String line) {
        JsonNode id = null;
        boolean notification = true;
        try {
            JsonNode request = OM.readTree(line);
            id = request == null ? null : request.get("id");
            // 批量消息即使没有单个 id 也要把响应数组写回去；纯通知批次由服务端返回 202
            notification = request != null && !request.isArray() && (id == null || id.isNull());
        } catch (Exception e) {
            writeLine(error(null, -32700, "客户端发送的 JSON 无法解析").toString());
            return;
        }
        String response;
        try {
            response = forward(line);
        } catch (UnauthorizedException e) {
            try {
                response = forward(line);
            } catch (Exception retryError) {
                response = error(id, -32001, "MCP Token 无效，请在 DeepShell「安全与访问 → MCP 服务」重新复制配置").toString();
            }
        } catch (Exception e) {
            response = error(id, -32603, friendly(e)).toString();
        }
        if (!notification && response != null && !response.trim().isEmpty()) {
            try {
                writeLine(OM.readTree(response).toString());
            } catch (Exception e) {
                writeLine(error(id, -32603, "DeepShell 返回了无法解析的响应").toString());
            }
        }
    }

    private static String forward(String payload) throws Exception {
        Endpoint ep = endpoint();
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(ep.url).openConnection();
            if (conn instanceof HttpsURLConnection) {
                allowSelfSignedLoopback((HttpsURLConnection) conn, ep.url);
            }
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            if (ep.token != null && !ep.token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + ep.token);
            }
            byte[] body = payload.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body);
            }
            int status = conn.getResponseCode();
            if (status == 202) {
                return null;
            }
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = readAll(stream);
            if (status == 401) {
                throw new UnauthorizedException();
            }
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("DeepShell 返回 HTTP " + status
                        + (text == null || text.trim().isEmpty() ? "" : "：" + shorten(text, 500)));
            }
            return text;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static Endpoint endpoint() {
        Path file = DataDir.root().resolve("mcp-server.json");
        if (Files.isRegularFile(file)) {
            try {
                JsonNode node = OM.readTree(Files.readAllBytes(file));
                String url = node.path("url").asText("").trim();
                String token = node.path("token").asText("").trim();
                if (!url.isEmpty()) {
                    return new Endpoint(url, token);
                }
            } catch (Exception e) {
                log("读取 mcp-server.json 失败：" + e.getMessage());
            }
        }
        // 兼容旧版本 / 端点文件尚未写入：从 runtime.properties 拼地址，Token 读 mcp.token
        String url = "http://127.0.0.1:17777/mcp";
        Path runtime = DataDir.root().resolve("runtime.properties");
        if (Files.isRegularFile(runtime)) {
            try (InputStream in = Files.newInputStream(runtime)) {
                Properties p = new Properties();
                p.load(in);
                String base = p.getProperty("url", "").trim();
                if (!base.isEmpty()) {
                    url = base + "/mcp";
                }
            } catch (Exception ignore) {
                // 回退默认地址
            }
        }
        String token = "";
        Path tokenFile = DataDir.root().resolve("mcp.token");
        if (Files.isRegularFile(tokenFile)) {
            try {
                token = new String(Files.readAllBytes(tokenFile), StandardCharsets.UTF_8).trim();
            } catch (Exception ignore) {
                // 无 Token 时由服务端返回 401
            }
        }
        return new Endpoint(url, token);
    }

    private static final class Endpoint {
        final String url;
        final String token;

        Endpoint(String url, String token) {
            this.url = url;
            this.token = token;
        }
    }

    private static final class UnauthorizedException extends Exception {
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) {
            return "";
        }
        try (InputStream stream = in) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = stream.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static String friendly(Exception e) {
        String message = e.getMessage();
        if (message == null || message.trim().isEmpty()) {
            message = e.getClass().getSimpleName();
        }
        if (e instanceof java.net.ConnectException) {
            return "无法连接 DeepShell（" + message + "）。请先启动 DeepShell 并保持运行";
        }
        return message;
    }

    private static String shorten(String s, int max) {
        String t = s == null ? "" : s.replaceAll("\\s+", " ").trim();
        return t.length() <= max ? t : t.substring(0, max) + "…";
    }

    private static ObjectNode error(JsonNode id, int code, String message) {
        ObjectNode node = OM.createObjectNode();
        node.put("jsonrpc", "2.0");
        if (id == null) {
            node.putNull("id");
        } else {
            node.set("id", id);
        }
        ObjectNode error = node.putObject("error");
        error.put("code", code);
        error.put("message", message);
        return node;
    }

    /** 只对回环地址放宽自签证书校验：桥接进程只连本机 DeepShell。 */
    private static void allowSelfSignedLoopback(HttpsURLConnection conn, String url) {
        try {
            URL u = new URL(url);
            String host = u.getHost();
            if (!"127.0.0.1".equals(host) && !"localhost".equalsIgnoreCase(host)
                    && !"::1".equals(host) && !"[::1]".equals(host)) {
                return;
            }
            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, new TrustManager[]{new X509TrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) {
                }

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) {
                }

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            }}, new SecureRandom());
            conn.setSSLSocketFactory(sc.getSocketFactory());
            conn.setHostnameVerifier(new HostnameVerifier() {
                @Override
                public boolean verify(String hostname, SSLSession session) {
                    return true;
                }
            });
        } catch (Exception e) {
            log("配置本地 HTTPS 信任失败：" + e.getMessage());
        }
    }

    /** MCP stdio 固定用 \n 分隔消息；Windows 的 println 会写 \r\n。 */
    private static synchronized void writeLine(String json) {
        OUT.print(json);
        OUT.print('\n');
        OUT.flush();
    }

    private static void log(String message) {
        // stdio 的 stdout 只能输出 JSON-RPC，诊断信息一律走 stderr
        ERR.println("[deepshell-mcp] " + message);
    }
}
