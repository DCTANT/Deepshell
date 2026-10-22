package com.itdct.deepshell.common;

import java.util.regex.Pattern;

/**
 * 手机 / 平板浏览器识别：用于把首页自动引导到独立的手机版页面。
 * 只匹配明确的移动端 UA 关键字，桌面浏览器（含窄窗口）不受影响。
 */
public final class MobileDetect {

    private static final Pattern MOBILE_UA = Pattern.compile(
            "(android|iphone|ipod|ipad|mobile|windows phone|iemobile|blackberry|bb10"
                    + "|opera mini|opera mobi|webos|harmonyos|micromessenger)",
            Pattern.CASE_INSENSITIVE);

    private MobileDetect() {
    }

    public static boolean isMobile(String userAgent) {
        return userAgent != null && MOBILE_UA.matcher(userAgent).find();
    }
}
