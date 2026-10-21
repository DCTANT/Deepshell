package com.itdct.deepshell.service;

import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 网络工具箱：在目标服务器上执行 ping / traceroute / DNS / 端口探测。
 * 主机名与端口严格校验后再拼接命令，避免命令注入。
 */
@Service
public class NetworkToolService {

    private static final int MAX_OUTPUT_BYTES = 256 * 1024;

    private final SshSessionManager sessions;

    public NetworkToolService(SshSessionManager sessions) {
        this.sessions = sessions;
    }

    public Map<String, Object> run(String sessionId, String tool, String target, Integer port)
            throws Exception {
        String kind = tool == null ? "" : tool.trim();
        if (!"ping".equals(kind) && !"traceroute".equals(kind)
                && !"dns".equals(kind) && !"port".equals(kind)) {
            throw new IllegalArgumentException("不支持的网络工具");
        }
        String host = safeTarget(target);
        int portNo = 0;
        if ("port".equals(kind)) {
            if (port == null || port < 1 || port > 65535) {
                throw new IllegalArgumentException("端口范围应为 1-65535");
            }
            portNo = port;
        }

        String q = shellQuote(host);
        String command;
        long timeout;
        if ("ping".equals(kind)) {
            command = "ping -c 4 -W 2 " + q + " 2>&1";
            timeout = 30000;
        } else if ("traceroute".equals(kind)) {
            command = "if command -v traceroute >/dev/null 2>&1; then traceroute -n -m 20 -w 2 "
                    + q + " 2>&1; elif command -v tracepath >/dev/null 2>&1; then tracepath -n "
                    + q + " 2>&1; else echo '服务器未安装 traceroute / tracepath'; fi";
            timeout = 90000;
        } else if ("dns".equals(kind)) {
            command = "if command -v dig >/dev/null 2>&1; then dig +short " + q
                    + " 2>&1; elif command -v nslookup >/dev/null 2>&1; then nslookup " + q
                    + " 2>&1; elif command -v getent >/dev/null 2>&1; then getent ahosts " + q
                    + " 2>&1; else echo '服务器未安装 dig / nslookup / getent'; fi";
            timeout = 30000;
        } else {
            command = "if command -v nc >/dev/null 2>&1; then nc -z -w 4 " + q + " " + portNo
                    + " && echo '端口开放' || echo '端口关闭或不可达'; "
                    + "elif command -v bash >/dev/null 2>&1; then timeout 5 bash -c 'exec 3<>/dev/tcp/"
                    + host + "/" + portNo + "' 2>/dev/null && echo '端口开放' || echo '端口关闭或不可达'; "
                    + "else echo '服务器未安装 nc 或 bash，无法探测端口'; fi";
            timeout = 20000;
        }

        SshSessionManager.SshSession s = sessions.get(sessionId);
        long start = System.currentTimeMillis();
        SshSessionManager.ExecResult r = sessions.execInShell(s, command, null, timeout, MAX_OUTPUT_BYTES);
        long elapsed = System.currentTimeMillis() - start;

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("tool", kind);
        data.put("target", host);
        data.put("port", portNo);
        data.put("command", command);
        data.put("output", r.output == null ? "" : r.output);
        data.put("exitCode", r.exitCode);
        data.put("timedOut", r.timedOut);
        data.put("truncated", r.truncated);
        data.put("durationMs", elapsed);
        return data;
    }

    private static String safeTarget(String target) {
        String t = target == null ? "" : target.trim();
        if (t.isEmpty()) {
            throw new IllegalArgumentException("请输入主机名或 IP 地址");
        }
        if (t.length() > 253) {
            throw new IllegalArgumentException("主机名过长");
        }
        if (!t.matches("^[A-Za-z0-9._:%-]+$")) {
            throw new IllegalArgumentException("主机名只能包含字母、数字、点、下划线、冒号、连字符和百分号");
        }
        if (t.startsWith("-")) {
            throw new IllegalArgumentException("主机名不能以 - 开头");
        }
        return t;
    }

    private static String shellQuote(String value) {
        return "'" + String.valueOf(value).replace("'", "'\\''") + "'";
    }
}
