package com.itdct.deepshell.service;

import com.itdct.deepshell.common.CaptchaGenerator;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.lang.reflect.Field;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CaptchaServiceTest {

    @Test
    void captchaRequiredAfterTwoFailuresAndResetAfterSuccess() {
        CaptchaService service = new CaptchaService();
        String ip = "192.0.2.10";

        assertFalse(service.isCaptchaRequired(ip));
        service.recordFailure(ip);
        assertEquals(1, service.getFailureCount(ip));
        assertFalse(service.isCaptchaRequired(ip));

        service.recordFailure(ip);
        assertEquals(2, service.getFailureCount(ip));
        assertTrue(service.isCaptchaRequired(ip));

        // 其他 IP 互不影响
        assertFalse(service.isCaptchaRequired("192.0.2.11"));

        service.resetFailures(ip);
        assertEquals(0, service.getFailureCount(ip));
        assertFalse(service.isCaptchaRequired(ip));
    }

    @Test
    void generatedImageAndCodeAreValid() throws Exception {
        CaptchaService service = new CaptchaService();
        CaptchaService.Challenge challenge = service.challenge();

        assertNotNull(challenge.captchaId);
        assertFalse(challenge.captchaId.isEmpty());
        assertNotNull(challenge.imageBase64);

        BufferedImage image = ImageIO.read(
                new ByteArrayInputStream(Base64.getDecoder().decode(challenge.imageBase64)));
        assertNotNull(image);
        assertEquals(CaptchaGenerator.WIDTH, image.getWidth());
        assertEquals(CaptchaGenerator.HEIGHT, image.getHeight());

        String code = storedCode(service, challenge.captchaId);
        assertEquals(CaptchaGenerator.LENGTH, code.length());
        for (int i = 0; i < code.length(); i++) {
            assertTrue(CaptchaGenerator.CHAR_POOL.indexOf(code.charAt(i)) >= 0,
                    "验证码字符应来自字符池: " + code.charAt(i));
        }
    }

    @Test
    void verificationIsCaseInsensitiveAndOneTimeOnly() throws Exception {
        CaptchaService service = new CaptchaService();
        CaptchaService.Challenge challenge = service.challenge();
        String code = storedCode(service, challenge.captchaId);

        assertEquals(CaptchaService.VerifyResult.MISSING, service.verify(null, code));
        assertEquals(CaptchaService.VerifyResult.MISSING, service.verify(challenge.captchaId, " "));

        assertEquals(CaptchaService.VerifyResult.OK,
                service.verify(challenge.captchaId, "  " + code.toUpperCase() + "  "));
        // 一次性使用：同一 captchaId 第二次校验必定失败
        assertEquals(CaptchaService.VerifyResult.INVALID,
                service.verify(challenge.captchaId, code));
    }

    @Test
    void wrongOrExpiredCaptchaIsRejected() {
        CaptchaService service = new CaptchaService();
        CaptchaService.Challenge challenge = service.challenge();

        // 0 不在字符池中，必定不会与生成的验证码相同
        assertEquals(CaptchaService.VerifyResult.INVALID,
                service.verify(challenge.captchaId, "0000"));
        assertEquals(CaptchaService.VerifyResult.INVALID,
                service.verify("not-exists", "abcd"));
    }

    @SuppressWarnings("unchecked")
    private static String storedCode(CaptchaService service, String captchaId) throws Exception {
        Field captchasField = CaptchaService.class.getDeclaredField("captchas");
        captchasField.setAccessible(true);
        Map<String, Object> captchas = (Map<String, Object>) captchasField.get(service);
        Object entry = captchas.get(captchaId);
        assertNotNull(entry);
        Field codeField = entry.getClass().getDeclaredField("code");
        codeField.setAccessible(true);
        return (String) codeField.get(entry);
    }
}
