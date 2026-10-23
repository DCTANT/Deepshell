package com.itdct.deepshell.protocol;

import com.itdct.deepshell.common.SystemBrowser;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;

/**
 * 启动期外部调用转发：发现已有 DeepShell 实例时，把链接交给它处理并退出，
 * 避免再次启动 Spring 造成端口冲突；没有实例运行时返回 false，由当前进程正常启动。
 *
 * 该进程可能由 javaw 拉起，没有控制台，因此所有结果都写入 logs/protocol.log。
 */
public final class ProtocolClient {

    public static final String HEADER_SECRET = "X-DeepShell-Protocol-Key";
    public static final String PATH_PING = "/api/protocol/ping";
    public static final String PATH_HANDOFF = "/api/protocol/handoff";

    private static final int MAX_BODY = 4096;

    private ProtocolClient() {
    }

    public static boolean tryHandoff(String rawUri) {
        String target;
        try {
            target = ProtocolRequest.parse(rawUri).describeTarget();
        } catch (Exception e) {
            target = "格式待服务端校验";
        }
        String baseUrl = ProtocolFiles.readRuntimeUrl();
        if (baseUrl == null) {
            ProtocolFiles.log("未发现运行信息，启动新的 DeepShell 实例（" + target + "）");
            return false;
        }
        String secret = ProtocolFiles.readSecret();
        if (secret == null) {
            ProtocolFiles.log("未找到协议握手密钥，启动新的 DeepShell 实例（" + target + "）");
            return false;
        }
        baseUrl = trimTrailingSlash(baseUrl);
        if (!isLoopbackBaseUrl(baseUrl)) {
            ProtocolFiles.log("运行信息不是本机回环地址，已忽略（" + target + "）");
            return false;
        }
        if (!ping(baseUrl, secret)) {
            ProtocolFiles.log("运行信息指向的实例未响应，启动新的 DeepShell 实例（" + target + "）");
            return false;
        }
        try {
            HttpURLConnection conn = open(baseUrl + PATH_HANDOFF, "POST", secret);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            conn.setDoOutput(true);
            byte[] body = ("uri=" + URLEncoder.encode(rawUri, "UTF-8")).getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body);
            }
            int code = conn.getResponseCode();
            String response = readBody(code >= 400 ? conn.getErrorStream() : conn.getInputStream());
            conn.disconnect();
            if (code >= 200 && code < 300) {
                ProtocolFiles.log("已交给运行中的 DeepShell（HTTP " + code + "，目标 " + target + "）");
                return true;
            }
            ProtocolFiles.log("运行中的 DeepShell 拒绝调用：HTTP " + code
                    + (response.isEmpty() ? "" : "，" + response));
            openErrorPage(baseUrl, "外部调用未能打开连接（HTTP " + code + "），详情见日志");
            return true;
        } catch (Exception e) {
            ProtocolFiles.log("转发外部调用失败: " + e.getMessage());
            openErrorPage(baseUrl, "外部调用转发失败：" + e.getMessage());
            return true;
        }
    }

    private static boolean ping(String baseUrl, String secret) {
        try {
            HttpURLConnection conn = open(baseUrl + PATH_PING, "GET", secret);
            conn.setConnectTimeout(1500);
            conn.setReadTimeout(2000);
            int code = conn.getResponseCode();
            drain(code >= 400 ? conn.getErrorStream() : conn.getInputStream());
            conn.disconnect();
            return code == 200;
        } catch (Exception e) {
            ProtocolFiles.log("探测运行实例失败: " + e.getMessage());
            return false;
        }
    }

    private static HttpURLConnection open(String url, String method, String secret) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty(HEADER_SECRET, secret);
        conn.setRequestProperty("Accept", "application/json");
        conn.setUseCaches(false);
        if (conn instanceof HttpsURLConnection) {
            // 仅用于本机回环：接受 DeepShell 首次启动生成的自签证书
            HttpsURLConnection https = (HttpsURLConnection) conn;
            https.setSSLSocketFactory(trustAllFactory());
            https.setHostnameVerifier(trustAllHostnames());
        }
        return conn;
    }

    private static void openErrorPage(String baseUrl, String message) {
        try {
            String url = baseUrl + "/workspace?protocolError="
                    + URLEncoder.encode(message, "UTF-8");
            SystemBrowser.open(url);
        } catch (Exception e) {
            ProtocolFiles.log("打开错误提示页失败: " + e.getMessage());
        }
    }

    private static String readBody(InputStream in) {
        if (in == null) {
            return "";
        }
        try (InputStream input = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[1024];
            int n;
            while ((n = input.read(buf)) >= 0 && out.size() < MAX_BODY) {
                out.write(buf, 0, Math.min(n, MAX_BODY - out.size()));
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8).trim();
        } catch (Exception e) {
            return "";
        }
    }

    private static void drain(InputStream in) {
        if (in == null) {
            return;
        }
        try (InputStream input = in) {
            byte[] buf = new byte[512];
            while (input.read(buf) >= 0) {
                // discard
            }
        } catch (Exception ignore) {
            // ignore
        }
    }

    private static String trimTrailingSlash(String url) {
        String result = url;
        while (result.endsWith("/")) {
            result = result.substring(0, result.length() - 1);
        }
        return result;
    }

    /** 握手密钥只发往本机回环，避免被篡改的 runtime.properties 引到外部地址。 */
    private static boolean isLoopbackBaseUrl(String baseUrl) {
        try {
            URL url = new URL(baseUrl);
            if (!"http".equalsIgnoreCase(url.getProtocol())
                    && !"https".equalsIgnoreCase(url.getProtocol())) {
                return false;
            }
            if (url.getPort() <= 0 || url.getPort() > 65535) {
                return false;
            }
            return InetAddress.getByName(url.getHost()).isLoopbackAddress();
        } catch (Exception e) {
            return false;
        }
    }

    private static SSLSocketFactory trustAllFactory() throws Exception {
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[]{new X509TrustManager() {
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
        }}, null);
        return context.getSocketFactory();
    }

    private static HostnameVerifier trustAllHostnames() {
        return new HostnameVerifier() {
            @Override
            public boolean verify(String hostname, SSLSession session) {
                return true;
            }
        };
    }
}
