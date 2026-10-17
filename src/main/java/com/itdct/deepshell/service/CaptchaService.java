package com.itdct.deepshell.service;

import com.itdct.deepshell.common.CaptchaGenerator;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 登录验证码：按发起登录的 IP 累计失败次数，达到阈值后要求输入图形验证码。
 *
 * <p>验证码保存在进程内存中（DeepShell 不依赖 Redis），2 分钟有效、一次性使用；
 * 登录成功后清空该 IP 的失败计数。失败计数在 30 分钟无新失败后自动失效。</p>
 */
@Slf4j
@Service
public class CaptchaService {

    /** 同一 IP 连续失败达到该次数后要求验证码；小于等于 0 表示关闭验证码 */
    @Value("${deepshell.auth.captcha-fail-times:2}")
    private int captchaFailTimes = 2;

    private static final long CAPTCHA_VALID_MS = 120_000L;
    private static final long FAILURE_WINDOW_MS = 30 * 60_000L;
    private static final int MAX_CAPTCHAS = 5_000;
    private static final int MAX_TRACKED_IPS = 10_000;

    private final ConcurrentHashMap<String, CaptchaEntry> captchas = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, FailureState> failures = new ConcurrentHashMap<>();

    public int getCaptchaFailTimes() {
        return captchaFailTimes;
    }

    /** 当前 IP 是否需要验证码 */
    public boolean isCaptchaRequired(String ip) {
        return captchaFailTimes > 0 && getFailureCount(ip) >= captchaFailTimes;
    }

    /** 当前 IP 在失败统计窗口内的失败次数 */
    public int getFailureCount(String ip) {
        if (ip == null) {
            return 0;
        }
        FailureState state = failures.get(ip);
        if (state == null) {
            return 0;
        }
        synchronized (state) {
            if (isExpired(state)) {
                failures.remove(ip, state);
                return 0;
            }
            return state.count;
        }
    }

    /** 记录一次登录失败，返回该 IP 的累计失败次数 */
    public int recordFailure(String ip) {
        if (ip == null) {
            return 0;
        }
        cleanupFailuresIfNeeded();
        FailureState state = failures.computeIfAbsent(ip, key -> new FailureState());
        int count;
        synchronized (state) {
            long now = System.currentTimeMillis();
            if (now - state.lastFailureAt > FAILURE_WINDOW_MS) {
                state.count = 0;
            }
            state.count++;
            state.lastFailureAt = now;
            count = state.count;
        }
        if (captchaFailTimes > 0 && count == captchaFailTimes) {
            log.warn("IP {} 连续登录失败 {} 次，之后登录需要输入验证码", ip, count);
        }
        return count;
    }

    /** 登录成功后清空该 IP 的失败计数 */
    public void resetFailures(String ip) {
        if (ip != null) {
            failures.remove(ip);
        }
    }

    /** 生成一组新的验证码（文本 + JPEG Base64 图片） */
    public Challenge challenge() {
        purgeExpiredCaptchas();
        if (captchas.size() >= MAX_CAPTCHAS) {
            // 验证码本身 2 分钟过期，极端情况下直接清空，避免内存无限增长
            captchas.clear();
        }
        CaptchaGenerator.Generated generated = CaptchaGenerator.generate();
        String captchaId = UUID.randomUUID().toString().replace("-", "");
        captchas.put(captchaId, new CaptchaEntry(
                generated.code.toLowerCase(Locale.ROOT),
                System.currentTimeMillis() + CAPTCHA_VALID_MS));

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            ImageIO.write(generated.image, "jpg", out);
        } catch (IOException e) {
            throw new IllegalStateException("生成验证码图片失败: " + e.getMessage(), e);
        }
        return new Challenge(captchaId, Base64.getEncoder().encodeToString(out.toByteArray()));
    }

    /**
     * 校验验证码，忽略大小写与首尾空白。
     * 验证码一次性使用：无论校验成功与否都会立即失效，避免被反复尝试。
     */
    public VerifyResult verify(String captchaId, String code) {
        if (captchaId == null || captchaId.trim().isEmpty()
                || code == null || code.trim().isEmpty()) {
            return VerifyResult.MISSING;
        }
        CaptchaEntry entry = captchas.remove(captchaId.trim());
        if (entry == null || entry.expiresAt < System.currentTimeMillis()) {
            return VerifyResult.INVALID;
        }
        return entry.code.equalsIgnoreCase(code.trim()) ? VerifyResult.OK : VerifyResult.INVALID;
    }

    private void purgeExpiredCaptchas() {
        long now = System.currentTimeMillis();
        for (Map.Entry<String, CaptchaEntry> entry : captchas.entrySet()) {
            if (entry.getValue().expiresAt < now) {
                captchas.remove(entry.getKey(), entry.getValue());
            }
        }
    }

    private void cleanupFailuresIfNeeded() {
        if (failures.size() < MAX_TRACKED_IPS) {
            return;
        }
        for (Map.Entry<String, FailureState> entry : failures.entrySet()) {
            FailureState state = entry.getValue();
            synchronized (state) {
                if (isExpired(state)) {
                    failures.remove(entry.getKey(), state);
                }
            }
        }
    }

    private static boolean isExpired(FailureState state) {
        return System.currentTimeMillis() - state.lastFailureAt > FAILURE_WINDOW_MS;
    }

    public enum VerifyResult {
        /** 校验通过 */
        OK,
        /** 未提交验证码 */
        MISSING,
        /** 验证码错误、已过期或已使用 */
        INVALID
    }

    public static final class Challenge {
        public final String captchaId;
        public final String imageBase64;

        Challenge(String captchaId, String imageBase64) {
            this.captchaId = captchaId;
            this.imageBase64 = imageBase64;
        }
    }

    private static final class CaptchaEntry {
        final String code;
        final long expiresAt;

        CaptchaEntry(String code, long expiresAt) {
            this.code = code;
            this.expiresAt = expiresAt;
        }
    }

    private static final class FailureState {
        int count;
        long lastFailureAt;
    }
}
