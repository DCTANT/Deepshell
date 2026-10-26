package com.itdct.deepshell.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.itdct.deepshell.common.DataDir;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Set;

/**
 * MCP 调用 Token：与 HTTP 集成接口分开，泄露或重新生成 MCP Token 不影响 JumpServer / 门户。
 * 优先使用 application.yml 的 deepshell.mcp.token；未配置时自动生成到数据目录 mcp.token。
 * 运行中的实际地址与 Token 会写入 mcp-server.json，供同 jar 的 stdio 桥接进程读取。
 */
@Slf4j
@Service
public class McpTokenService {

    /** 客户端可直接携带的专用请求头；也接受 Authorization: Bearer 与 ?token= */
    public static final String HEADER = "X-DeepShell-Mcp-Token";

    private static final SecureRandom RANDOM = new SecureRandom();
    private final ObjectMapper om = new ObjectMapper();

    @Value("${deepshell.mcp.token:}")
    private String configuredToken;

    public boolean isConfigured() {
        return configuredToken != null && !configuredToken.trim().isEmpty();
    }

    public synchronized String token() {
        if (isConfigured()) {
            return configuredToken.trim();
        }
        Path file = tokenFile();
        if (Files.isRegularFile(file)) {
            try {
                String value = new String(Files.readAllBytes(file), StandardCharsets.UTF_8).trim();
                if (!value.isEmpty()) {
                    return value;
                }
            } catch (Exception e) {
                log.warn("读取 MCP Token 失败: {}", e.getMessage());
            }
        }
        try {
            String value = randomToken();
            Files.createDirectories(file.getParent());
            Files.write(file, (value + System.lineSeparator()).getBytes(StandardCharsets.UTF_8));
            restrictToOwner(file);
            log.info("已生成 MCP Token: {}", file);
            return value;
        } catch (Exception e) {
            throw new IllegalStateException("生成 MCP Token 失败：" + e.getMessage(), e);
        }
    }

    public synchronized String regenerate() {
        if (isConfigured()) {
            throw new IllegalArgumentException("当前 MCP Token 由 application.yml 固定配置，请修改配置后重启");
        }
        try {
            String value = randomToken();
            Path file = tokenFile();
            Files.createDirectories(file.getParent());
            Files.write(file, (value + System.lineSeparator()).getBytes(StandardCharsets.UTF_8));
            restrictToOwner(file);
            return value;
        } catch (Exception e) {
            throw new IllegalStateException("重新生成 MCP Token 失败：" + e.getMessage(), e);
        }
    }

    public boolean verify(HttpServletRequest request) {
        String expected;
        try {
            expected = token();
        } catch (Exception e) {
            return false;
        }
        String supplied = request.getHeader(HEADER);
        if (supplied == null || supplied.trim().isEmpty()) {
            String authorization = request.getHeader("Authorization");
            if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
                supplied = authorization.substring(7).trim();
            }
        }
        if (supplied == null || supplied.trim().isEmpty()) {
            // 部分客户端只能填 URL：允许 ?token=，只在本机 / HTTPS 场景推荐
            supplied = request.getParameter("token");
        }
        if (supplied == null || supplied.trim().isEmpty()) {
            return false;
        }
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                supplied.trim().getBytes(StandardCharsets.UTF_8));
    }

    public Path tokenFile() {
        return DataDir.root().resolve("mcp.token");
    }

    public Path endpointFile() {
        return DataDir.root().resolve("mcp-server.json");
    }

    /**
     * 把当前运行地址与 Token 写入数据目录，供 stdio 桥接 / 外部脚本发现。
     * 文件权限尽量收紧；读取方只需要本机当前用户权限。
     */
    public synchronized void publishEndpoint(String url) {
        try {
            ObjectNode node = om.createObjectNode();
            node.put("url", url);
            node.put("token", token());
            node.put("version", 1);
            Path file = endpointFile();
            Files.createDirectories(file.getParent());
            Files.write(file, om.writerWithDefaultPrettyPrinter().writeValueAsBytes(node));
            restrictToOwner(file);
        } catch (Exception e) {
            log.warn("写入 MCP 端点信息失败: {}", e.getMessage());
        }
    }

    private static String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static void restrictToOwner(Path file) {
        try {
            Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
            Files.setPosixFilePermissions(file, perms);
        } catch (Exception ignore) {
            // Windows 等不支持 POSIX 权限的平台交给用户目录 ACL
        }
    }
}
