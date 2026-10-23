package com.itdct.deepshell.service;

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
 * JumpServer / 运维门户调用 DeepShell HTTP 接口时使用的 Token。
 * 优先使用 application.yml 的 deepshell.integration.token；未配置时自动生成到
 * 数据目录 integration.token，并可在「集成接口」弹窗中查看 / 重新生成。
 */
@Slf4j
@Service
public class IntegrationTokenService {

    public static final String HEADER = "X-DeepShell-Integration-Token";

    private static final SecureRandom RANDOM = new SecureRandom();

    @Value("${deepshell.integration.token:}")
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
                log.warn("读取集成接口 Token 失败: {}", e.getMessage());
            }
        }
        try {
            String value = randomToken();
            Files.createDirectories(file.getParent());
            Files.write(file, (value + System.lineSeparator()).getBytes(StandardCharsets.UTF_8));
            restrictToOwner(file);
            log.info("已生成集成接口 Token: {}", file);
            return value;
        } catch (Exception e) {
            throw new IllegalStateException("生成集成接口 Token 失败：" + e.getMessage(), e);
        }
    }

    public synchronized String regenerate() {
        if (isConfigured()) {
            throw new IllegalArgumentException("当前 Token 由 application.yml 固定配置，请修改配置后重启");
        }
        try {
            String value = randomToken();
            Path file = tokenFile();
            Files.createDirectories(file.getParent());
            Files.write(file, (value + System.lineSeparator()).getBytes(StandardCharsets.UTF_8));
            restrictToOwner(file);
            return value;
        } catch (Exception e) {
            throw new IllegalStateException("重新生成集成接口 Token 失败：" + e.getMessage(), e);
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
        if (supplied == null || supplied.isEmpty()) {
            return false;
        }
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                supplied.getBytes(StandardCharsets.UTF_8));
    }

    public Path tokenFile() {
        return DataDir.root().resolve("integration.token");
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
