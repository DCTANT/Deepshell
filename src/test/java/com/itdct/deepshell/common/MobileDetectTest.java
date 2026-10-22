package com.itdct.deepshell.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MobileDetectTest {

    @Test
    void detectsPhoneAndTabletUserAgents() {
        assertTrue(MobileDetect.isMobile(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"));
        assertTrue(MobileDetect.isMobile(
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"));
        assertTrue(MobileDetect.isMobile(
                "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Version/16.6 Mobile/15E148"));
        assertTrue(MobileDetect.isMobile(
                "Mozilla/5.0 (Linux; HarmonyOS 4.0) AppleWebKit/537.36 Mobile Safari/537.36"));
    }

    @Test
    void doesNotMatchDesktopBrowsers() {
        assertFalse(MobileDetect.isMobile(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"));
        assertFalse(MobileDetect.isMobile(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"));
        assertFalse(MobileDetect.isMobile(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0 Safari/537.36"));
        assertFalse(MobileDetect.isMobile(null));
        assertFalse(MobileDetect.isMobile(""));
    }
}
