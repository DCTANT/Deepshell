package com.itdct.deepshell.common;

import javax.servlet.http.HttpServletRequest;
import java.net.InetAddress;

/** 本机回环请求判断（本机快捷方式、开机启动、SSH / PuTTY 导入、自动更新等敏感操作）。 */
public final class LocalRequest {

    private LocalRequest() {
    }

    public static boolean isLoopback(HttpServletRequest request) {
        String addr = request == null ? null : request.getRemoteAddr();
        if (addr == null) {
            return false;
        }
        try {
            if (InetAddress.getByName(addr).isLoopbackAddress()) {
                return true;
            }
        } catch (Exception ignore) {
            // 继续按字符串判断 IPv4-mapped IPv6
        }
        return "::1".equals(addr) || addr.startsWith("::ffff:127.");
    }

    public static void requireLocal(HttpServletRequest request, String action) {
        if (!isLoopback(request)) {
            throw new IllegalArgumentException("仅支持在本机访问（127.0.0.1 / localhost）时" + action);
        }
    }
}
