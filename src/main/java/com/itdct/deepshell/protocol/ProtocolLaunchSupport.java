package com.itdct.deepshell.protocol;

/**
 * 启动参数中的外部调用链接。
 * main() 在 Spring 启动前先尝试交给已运行实例，只有确实没有实例时才继续冷启动；
 * 冷启动完成后由 ProtocolBootstrap 消费 pendingUri 并打开浏览器。
 */
public final class ProtocolLaunchSupport {

    public static final String ARG_PREFIX = "--deepshell.protocol-uri=";

    private static volatile String pendingUri;

    private ProtocolLaunchSupport() {
    }

    /**
     * @return true 表示已由现有实例处理（当前进程应直接退出）；false 表示需要继续启动
     */
    public static boolean handleEarly(String[] args) {
        String uri = findUri(args);
        if (uri == null) {
            return false;
        }
        pendingUri = uri;
        String target;
        try {
            target = ProtocolRequest.parse(uri).describeTarget();
        } catch (Exception e) {
            target = "链接格式错误： " + e.getMessage();
        }
        ProtocolFiles.log("收到外部调用：" + target);
        try {
            return ProtocolClient.tryHandoff(uri);
        } catch (Throwable e) {
            ProtocolFiles.log("处理外部调用时发生异常: " + e.getMessage());
            return false;
        }
    }

    public static String findUri(String[] args) {
        if (args == null) {
            return null;
        }
        for (int i = 0; i < args.length; i++) {
            String arg = args[i];
            if (arg == null) {
                continue;
            }
            if (arg.startsWith(ARG_PREFIX)) {
                String value = arg.substring(ARG_PREFIX.length()).trim();
                if (!value.isEmpty()) {
                    return value;
                }
            }
            if ("--deepshell.protocol-uri".equals(arg) && i + 1 < args.length) {
                String value = args[i + 1] == null ? "" : args[i + 1].trim();
                if (!value.isEmpty()) {
                    return value;
                }
            }
            // 允许 java -jar deepshell.jar deepshell://connect?... 这种手工调用
            if (arg.regionMatches(true, 0, ProtocolRequest.SCHEME + ":", 0,
                    ProtocolRequest.SCHEME.length() + 1)) {
                return arg.trim();
            }
        }
        return null;
    }

    public static boolean hasPending() {
        return pendingUri != null;
    }

    public static String pendingUri() {
        return pendingUri;
    }
}
