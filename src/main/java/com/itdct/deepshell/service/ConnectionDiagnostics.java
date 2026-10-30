package com.itdct.deepshell.service;

import com.jcraft.jsch.JSchException;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 把 SSH/JSch 的英文错误翻译成新手能照做的排查步骤。
 * 网络层故障（DNS / 端口 / 防火墙）、认证失败、私钥格式、代理与跳板机分别给出不同建议，
 * 不再只回一句“Auth fail”。
 */
public final class ConnectionDiagnostics {

    private ConnectionDiagnostics() {
    }

    public static Map<String, Object> from(Throwable e, String who) {
        String detail = fullMessage(e);
        return fromMessage(detail, who, e);
    }

    public static Map<String, Object> fromJSch(JSchException e, String who) {
        return fromMessage(fullMessage(e), who, e);
    }

    public static Map<String, Object> fromMessage(String message, String who) {
        return fromMessage(message, who, null);
    }

    public static Map<String, Object> config(String message) {
        String msg = message == null ? "" : message.trim();
        List<String> steps = new ArrayList<>();
        steps.add("回到连接设置，补全提示中缺少的字段后重新测试。");
        steps.add("密码 / 私钥口令留空表示沿用已保存值；新建连接时不能留空。");
        steps.add("端口填 SSH 端口，默认 22，不是网站端口。");
        return base("CONFIG", "连接信息还不完整", msg, steps, msg, "连接参数");
    }

    /** 执行网关本身的故障：地址、Token、白名单或证书，而不是目标机的登录问题。 */
    public static Map<String, Object> gateway(String gatewayName, String message) {
        String role = gatewayName == null || gatewayName.trim().isEmpty()
                ? "执行网关" : "执行网关 " + gatewayName.trim();
        String msg = message == null ? "" : message.trim();
        List<String> steps = new ArrayList<>();
        steps.add("打开「执行网关」设置，用「测试」确认地址与 Token 可用、对方已启用执行网关。");
        steps.add("确认目标地址在网关白名单内（支持精确主机、*.域名、IP 与 CIDR）。");
        steps.add("网关使用 HTTPS 自签证书时，需要在网关配置里勾选「跳过证书校验」。");
        steps.add("确认网关所在网络能访问目标主机的 SSH 端口，而不是只有本机能访问。");
        return base("GATEWAY_FAILED", "执行网关不可用", role + "：" + msg, steps, msg, role);
    }

    private static Map<String, Object> fromMessage(String message, String who, Throwable e) {
        String msg = message == null ? "" : message;
        String lower = msg.toLowerCase(Locale.ROOT);
        String role = who == null || who.trim().isEmpty() ? "目标主机" : who.trim();

        if (contains(lower, "auth fail", "auth cancel", "authentication failed",
                "too many authentication failures", "userauth fail")) {
            List<String> steps = new ArrayList<>();
            steps.add("先确认用户名。Ubuntu 镜像通常是 ubuntu，其他 Linux 常用 root；以云控制台实例详情 / 重置密码页显示的登录名为准。");
            steps.add("到云控制台重置实例密码（阿里云 / 腾讯云 / 华为云都支持），重置后等 1~2 分钟再试。");
            steps.add("密码登录被关闭时，root 也会被拒绝：改用创建实例时的普通用户登录，再执行 sudo；或在控制台 VNC 中检查 /etc/ssh/sshd_config 的 PermitRootLogin。");
            steps.add("用密钥时确认私钥路径、私钥口令正确；PuTTY 的 .ppk 文件不能直接用，需要先用 PuTTYgen 转成 OpenSSH 格式。");
            steps.add("账号开启双因素认证或禁止密码登录时，改用密钥，或让管理员在服务器上放行你的公钥。");
            return base("AUTH_FAILED", "登录被拒绝", role + "拒绝了这次登录，用户名或密码 / 密钥不正确。",
                    steps, msg, role);
        }

        if (contains(lower, "invalid privatekey", "invalid private key", "unsupported key",
                "invalidkey", "invalid key", "failed to parse key", "cannot parse")) {
            List<String> steps = new ArrayList<>();
            steps.add("确认「私钥路径」填的是运行 DeepShell 的这台电脑上的文件绝对路径，而不是服务器上的路径。");
            steps.add("只支持 OpenSSH / PEM 格式；PuTTY 的 .ppk 需转换：puttygen key.ppk -O private-openssh -o id_ed25519。");
            steps.add("Linux / macOS 上私钥权限建议 600：chmod 600 ~/.ssh/id_ed25519。");
            steps.add("有口令的私钥要在「私钥口令」中填写；口令错了同样会报私钥加载失败。");
            return base("KEY_INVALID", "私钥无法使用", role + "的私钥文件无法加载或格式不正确。",
                    steps, msg, role);
        }

        if (contains(lower, "no such file", "cannot read", "file not found",
                "is not a file", "permission denied") && hasKeyHint(msg)) {
            List<String> steps = new ArrayList<>();
            steps.add("打开连接设置，把「私钥路径」改成真实存在的文件；可把完整路径粘贴进去，避免手写目录。");
            steps.add("Windows 路径示例：C:\\Users\\你的名字\\.ssh\\id_ed25519；不要加引号。");
            steps.add("如果私钥在另一台电脑上，先把私钥复制到运行 DeepShell 的电脑，并妥善保管。");
            return base("KEY_NOT_FOUND", "找不到私钥文件", role + "连接需要的私钥文件不存在或不可读。",
                    steps, msg, role);
        }

        if (contains(lower, "connection refused", "connect refused", "connection reset by peer")) {
            List<String> steps = new ArrayList<>();
            steps.add("确认端口是否填对：SSH 默认是 22；如果改过端口，要用自定义端口。");
            steps.add("确认服务器上的 SSH 服务正在运行：在云控制台 VNC / 其他终端执行 systemctl status sshd。");
            steps.add("到云厂商「安全组 / 防火墙」放行入方向 TCP 22（或你的 SSH 端口），来源填你的公网 IP 或 0.0.0.0/0。");
            steps.add("服务器本机防火墙也要放行：sudo firewall-cmd --add-service=ssh --permanent（或 ufw allow 22/tcp）。");
            return base("CONNECTION_REFUSED", "端口拒绝连接", role + "的端口没有 SSH 服务在监听，或防火墙直接拒绝了连接。",
                    steps, msg, role);
        }

        if (contains(lower, "unknownhost", "unknown host", "name or service not known",
                "nodename nor servname", "no such host")) {
            List<String> steps = new ArrayList<>();
            steps.add("检查公网 IP 是否抄错（常见是把内网 IP 当成公网 IP）。");
            steps.add("直接改用 IP 测试，排除域名解析问题；域名刚解析时有缓存，等几分钟或换 DNS 再试。");
            steps.add("公司内网域名需要先连 VPN；云厂商内网地址只能从同 VPC / 同一专线访问。");
            steps.add("如果服务器刚创建，等实例状态变成「运行中」再试。");
            return base("HOST_NOT_FOUND", "找不到这台服务器", "无法解析主机地址「" + safeHost(msg) + "」。",
                    steps, msg, role);
        }

        if (contains(lower, "timed out", "timeout", "operation timed out")) {
            List<String> steps = new ArrayList<>();
            steps.add("确认实例处于「运行中」，没有关机 / 到期 / 欠费。");
            steps.add("确认填的是公网 IP / 弹性公网 IP，而不是 192.168、10.x 这类内网地址。");
            steps.add("到云控制台安全组放行入方向 TCP 22（或自定义 SSH 端口），来源限制为你的 IP 更安全。");
            steps.add("用控制台提供的「远程连接 / VNC」登录服务器，检查 SSH 服务与防火墙；本机网络 / 公司代理也可能阻断 22 端口。");
            steps.add("可以先用网络工具箱的「端口探测」测试 IP:端口是否通。");
            return base("TIMEOUT", "连接超时", "在限定时间内没有收到 " + role + " 的响应，通常是网络或安全组问题。",
                    steps, msg, role);
        }

        if (contains(lower, "no route to host", "network is unreachable", "host is unreachable",
                "connect: network is unreachable")) {
            List<String> steps = new ArrayList<>();
            steps.add("确认这台电脑能访问公网；切换网络 / 关闭代理后再试。");
            steps.add("确认服务器 IP 属于当前网络可达范围；内网服务器需要 VPN 或跳板机。");
            steps.add("云安全组和服务器防火墙都要放行对应端口。");
            return base("NETWORK_UNREACHABLE", "网络不可达", "当前网络找不到通往 " + role + " 的路径。",
                    steps, msg, role);
        }

        if (contains(lower, "proxy")) {
            List<String> steps = new ArrayList<>();
            steps.add("检查代理地址、端口、用户名和密码；代理失效时先关掉代理直连测试。");
            steps.add("HTTP 代理与 SOCKS5 不要选错类型；公司代理通常还需在系统里信任其证书。");
            steps.add("如果代理只允许白名单域名，请把 SSH 目标加入白名单。");
            return base("PROXY_FAILED", "代理连接失败", "经过代理连接 " + role + " 时失败。",
                    steps, msg, role);
        }

        if (contains(lower, "algorithm negotiation fail", "no common algorithm",
                "key exchange", "kex")) {
            List<String> steps = new ArrayList<>();
            steps.add("服务器 SSH 版本 / 加密算法太旧，和当前 JSch 没有共同算法。");
            steps.add("在服务器升级 OpenSSH（或让管理员开启兼容算法），这是最稳妥的做法。");
            steps.add("如果服务器是老旧网络设备，可能需要在服务器端开启 ssh-rsa / diffie-hellman-group14-sha1 等兼容项。");
            return base("SSH_ALGORITHM", "SSH 算法不兼容", role + "与客户端没有可用的加密算法。",
                    steps, msg, role);
        }

        if (contains(lower, "jsch")) {
            List<String> steps = new ArrayList<>();
            steps.add("先点「重新测试」；仍失败时用云控制台 VNC 登录服务器确认 SSH 服务状态。");
            steps.add("检查主机、端口、用户名是否来自正确的实例。");
            steps.add("展开下方技术详情，把错误信息发给服务器管理员。");
            return base("SSH_ERROR", "SSH 连接失败", role + "建立 SSH 会话时出错。",
                    steps, msg, role);
        }

        List<String> steps = new ArrayList<>();
        steps.add("确认实例正在运行、公网 IP 和端口正确。");
        steps.add("检查云安全组 / 服务器防火墙是否放行 SSH 端口。");
        steps.add("用云控制台 VNC 登录服务器，执行 systemctl status sshd 查看 SSH 服务。");
        steps.add("仍无法解决时展开技术详情，把完整错误发给管理员。");
        return base("UNKNOWN", "连接失败", role + "没有连接成功。",
                steps, msg, role);
    }

    private static Map<String, Object> base(String code, String title, String summary,
                                            List<String> steps, String detail, String role) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", code);
        m.put("title", title);
        m.put("summary", summary);
        m.put("steps", steps);
        m.put("detail", shorten(detail));
        m.put("role", role);
        return m;
    }

    private static boolean contains(String lower, String... keywords) {
        for (String keyword : keywords) {
            if (lower.contains(keyword)) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasKeyHint(String msg) {
        String lower = msg.toLowerCase(Locale.ROOT);
        return lower.contains("key") || lower.contains("identity") || lower.contains("private");
    }

    private static String safeHost(String message) {
        // 只用于展示，避免把长篇英文错误塞进标题
        String s = message == null ? "" : message;
        int start = s.indexOf('[');
        int end = s.indexOf(']', start + 1);
        if (start >= 0 && end > start) {
            return s.substring(start + 1, end);
        }
        return "服务器地址";
    }

    private static String fullMessage(Throwable e) {
        if (e == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        Throwable cur = e;
        int depth = 0;
        while (cur != null && depth++ < 6) {
            String m = cur.getMessage();
            if (m != null && !m.trim().isEmpty() && sb.indexOf(m) < 0) {
                if (sb.length() > 0) {
                    sb.append(" / ");
                }
                sb.append(m.trim());
            }
            cur = cur.getCause();
        }
        if (sb.length() == 0) {
            sb.append(e.getClass().getSimpleName());
        }
        return sb.toString();
    }

    private static String shorten(String text) {
        if (text == null) {
            return "";
        }
        String oneLine = text.replace('\r', ' ').replace('\n', ' ').trim();
        return oneLine.length() > 600 ? oneLine.substring(0, 600) + "…" : oneLine;
    }
}
