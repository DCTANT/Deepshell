package com.itdct.deepshell.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 网络工具箱：只读采集服务器监听端口与防火墙状态。
 * 端口优先使用 ss，缺失时回退 netstat；防火墙按 ufw / firewalld / nftables / iptables 的顺序探测。
 * 普通用户能看到监听端口，但其他用户的进程名和防火墙规则通常需要 root。
 */
@Service
public class FirewallPortService {

    private static final int MAX_PORTS = 500;
    private static final int MAX_RULES = 80;
    private static final int MAX_RAW_CHARS = 12000;

    private static final Pattern SS_PROCESS_RE =
            Pattern.compile("\\(\"([^\"]*)\",pid=(\\d+),fd=\\d+\\)");
    private static final Pattern NETSTAT_PROCESS_RE =
            Pattern.compile("^(\\d+)/(\\S+)$");

    static final String SCRIPT =
            "export LC_ALL=C 2>/dev/null; export LANG=C 2>/dev/null; " +
            "echo @@UID $(id -u 2>/dev/null || echo -1); " +
            "echo @@PORTS; " +
            "if command -v ss >/dev/null 2>&1; then " +
            "ss -lntup 2>&1 | head -n 4000; " +
            "elif command -v netstat >/dev/null 2>&1; then " +
            "netstat -lntup 2>/dev/null | head -n 4000; " +
            "else echo @@NO_PORTS; fi; " +
            "echo @@FW; " +
            "if command -v ufw >/dev/null 2>&1; then echo '##UFW'; " +
            "ufw status verbose 2>&1 | head -n 120; fi; " +
            "if command -v firewall-cmd >/dev/null 2>&1; then echo '##FIREWALLD'; " +
            "firewall-cmd --state 2>&1 | head -n 3; " +
            "echo '--LIST--'; firewall-cmd --list-all 2>&1 | head -n 120; fi; " +
            "if command -v systemctl >/dev/null 2>&1; then echo '##SVC'; " +
            "echo \"ufw=$(systemctl is-active ufw 2>/dev/null)\"; " +
            "echo \"firewalld=$(systemctl is-active firewalld 2>/dev/null)\"; fi; " +
            "if command -v nft >/dev/null 2>&1; then echo '##NFT'; " +
            "nft list ruleset 2>&1 | head -n 200; fi; " +
            "if command -v iptables >/dev/null 2>&1; then echo '##IPTABLES'; " +
            "iptables -S 2>&1 | head -n 200; fi; " +
            "echo @@END;";

    private final SshSessionManager sessions;
    private final SudoAccessService sudoAccess;

    public FirewallPortService(SshSessionManager sessions, SudoAccessService sudoAccess) {
        this.sessions = sessions;
        this.sudoAccess = sudoAccess;
    }

    public Map<String, Object> snapshot(String sessionId, boolean root) throws Exception {
        SshSessionManager.SshSession session = sessions.get(sessionId);
        String raw;
        if (root) {
            SudoAccessService.Command command = sudoAccess.wrap(sessionId, SCRIPT);
            raw = command.getPassword() == null
                    ? sessions.execCapture(session, command.getCommand(), 15000)
                    : sessions.execCaptureWithInput(session, command.getCommand(),
                    command.getPassword() + "\n", 15000);
            if (raw == null || !raw.contains("@@END")) {
                throw new IllegalArgumentException("root 读取失败：" + firstLine(raw));
            }
        } else {
            raw = sessions.execCapture(session, SCRIPT, 15000);
        }

        Parsed parsed = parse(raw);
        List<PortInfo> ports = parsed.ports;
        ports.sort(new Comparator<PortInfo>() {
            @Override
            public int compare(PortInfo a, PortInfo b) {
                int c = Integer.compare(a.port, b.port);
                if (c != 0) {
                    return c;
                }
                c = a.protocol.compareTo(b.protocol);
                if (c != 0) {
                    return c;
                }
                return a.address.compareTo(b.address);
            }
        });
        if (ports.size() > MAX_PORTS) {
            ports = new ArrayList<PortInfo>(ports.subList(0, MAX_PORTS));
        }

        boolean hiddenProcesses = false;
        List<Map<String, Object>> portList = new ArrayList<Map<String, Object>>();
        for (PortInfo p : ports) {
            if (p.pid <= 0) {
                hiddenProcesses = true;
            }
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("protocol", p.protocol);
            row.put("address", p.address);
            row.put("port", p.port);
            row.put("process", p.process);
            row.put("pid", p.pid);
            row.put("scope", scopeOf(p.address));
            portList.add(row);
        }

        FwInfo firewall = chooseFirewall(parsed);
        boolean restricted = firewall.restricted || (!root && hiddenProcesses);
        Map<String, Object> fw = firewall.toMap();
        if (Boolean.FALSE.equals(firewall.active) && firewall.rules.isEmpty()) {
            fw.put("raw", "");
        }
        if (firewall.restricted) {
            fw.put("hint", "普通用户无法读取完整防火墙规则，点击「以 root 读取」查看。");
        } else if (!firewall.installed) {
            fw.put("hint", "未检测到 ufw / firewalld / nftables / iptables；使用云服务器时请同时检查云安全组。");
        } else if (Boolean.FALSE.equals(firewall.active)) {
            fw.put("hint", "防火墙未启用，所有监听端口可能直接暴露；请确认是否已配置云安全组。");
        } else if (firewall.active == null) {
            fw.put("hint", "无法确定防火墙状态，点击「以 root 读取」或登录服务器手动确认。");
        } else {
            fw.put("hint", "这里只展示服务器本机防火墙；云安全组仍需在云控制台单独检查。");
        }

        StringBuilder note = new StringBuilder();
        if (!parsed.portsAvailable) {
            note.append("未找到 ss / netstat，无法读取监听端口。");
        }
        if (hiddenProcesses) {
            if (note.length() > 0) {
                note.append(" ");
            }
            note.append("部分监听端口属于其他用户，以 root 读取可补全进程名。");
        }
        if (firewall.restricted) {
            if (note.length() > 0) {
                note.append(" ");
            }
            note.append("防火墙规则需要 root 才能完整读取。");
        }
        if (note.length() > 0) {
            note.append(" ");
        }
        note.append("0.0.0.0 / :: 表示监听所有网卡；实际能否访问还取决于云安全组和防火墙规则。");

        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("uid", parsed.uid);
        data.put("root", root);
        data.put("portsAvailable", parsed.portsAvailable);
        data.put("ports", portList);
        data.put("firewall", fw);
        data.put("restricted", restricted);
        data.put("note", note.toString());
        return data;
    }

    /* ---------------- 解析 ---------------- */

    static Parsed parse(String raw) {
        Parsed p = new Parsed();
        if (raw == null || raw.trim().isEmpty()) {
            return p;
        }
        List<String> ufw = new ArrayList<String>();
        List<String> firewalld = new ArrayList<String>();
        List<String> nft = new ArrayList<String>();
        List<String> iptables = new ArrayList<String>();
        String svcUfw = null;
        String svcFirewalld = null;
        String section = "";
        String fwSection = "";
        for (String line : raw.split("\\r?\\n")) {
            String t = line.trim();
            if (t.startsWith("@@UID")) {
                p.uid = (int) safeLong(t.substring(5).trim(), -1);
                continue;
            }
            if ("@@PORTS".equals(t)) {
                section = "ports";
                continue;
            }
            if ("@@FW".equals(t)) {
                section = "fw";
                continue;
            }
            if ("@@END".equals(t)) {
                section = "end";
                continue;
            }
            if ("@@NO_PORTS".equals(t)) {
                p.portsAvailable = false;
                continue;
            }
            if ("ports".equals(section)) {
                PortInfo info = parsePortLine(line);
                if (info != null && p.portKeys.add(info.key())) {
                    p.ports.add(info);
                }
                continue;
            }
            if (!"fw".equals(section)) {
                continue;
            }
            if ("##UFW".equals(t)) {
                fwSection = "ufw";
                continue;
            }
            if ("##FIREWALLD".equals(t)) {
                fwSection = "firewalld";
                continue;
            }
            if ("##SVC".equals(t)) {
                fwSection = "svc";
                continue;
            }
            if ("##NFT".equals(t)) {
                fwSection = "nft";
                continue;
            }
            if ("##IPTABLES".equals(t)) {
                fwSection = "iptables";
                continue;
            }
            if ("ufw".equals(fwSection)) {
                ufw.add(line);
            } else if ("firewalld".equals(fwSection)) {
                firewalld.add(line);
            } else if ("nft".equals(fwSection)) {
                nft.add(line);
            } else if ("iptables".equals(fwSection)) {
                iptables.add(line);
            } else if ("svc".equals(fwSection)) {
                if (t.startsWith("ufw=")) {
                    svcUfw = t.substring(4).trim();
                } else if (t.startsWith("firewalld=")) {
                    svcFirewalld = t.substring(10).trim();
                }
            }
        }
        p.ufw = parseUfw(ufw, svcUfw);
        p.firewalld = parseFirewalld(firewalld, svcFirewalld);
        p.nft = parseRuleSet("nftables", nft, true);
        p.iptables = parseRuleSet("iptables", iptables, false);
        return p;
    }

    private static PortInfo parsePortLine(String line) {
        String t = line == null ? "" : line.trim();
        if (t.isEmpty()) {
            return null;
        }
        String[] a = t.split("\\s+");
        if (a.length < 4) {
            return null;
        }
        String protocol = a[0].toLowerCase(Locale.ROOT);
        if (protocol.endsWith("6")) {
            protocol = protocol.substring(0, protocol.length() - 1);
        }
        if (!"tcp".equals(protocol) && !"udp".equals(protocol)) {
            return null;
        }

        boolean ssFormat = "LISTEN".equalsIgnoreCase(a[1]) || "UNCONN".equalsIgnoreCase(a[1]);
        String local;
        String processText = "";
        if (ssFormat) {
            if (a.length < 5) {
                return null;
            }
            local = a[4];
            StringBuilder sb = new StringBuilder();
            for (int i = 6; i < a.length; i++) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(a[i]);
            }
            processText = sb.toString();
        } else {
            if (a.length < 4) {
                return null;
            }
            local = a[3];
            processText = a[a.length - 1];
        }

        int colon = local.lastIndexOf(':');
        if (colon <= 0 || colon == local.length() - 1) {
            return null;
        }
        String address = local.substring(0, colon).trim();
        String portText = local.substring(colon + 1).replaceAll("[^0-9].*$", "");
        if (address.isEmpty() || portText.isEmpty()) {
            return null;
        }
        int port;
        try {
            port = Integer.parseInt(portText);
        } catch (NumberFormatException e) {
            return null;
        }
        if (port < 1 || port > 65535) {
            return null;
        }
        if (address.startsWith("[") && address.endsWith("]")) {
            address = address.substring(1, address.length() - 1);
        }

        String process = "";
        int pid = 0;
        Matcher pm = SS_PROCESS_RE.matcher(processText);
        if (pm.find()) {
            process = pm.group(1);
            pid = (int) safeLong(pm.group(2), 0);
        } else {
            Matcher nm = NETSTAT_PROCESS_RE.matcher(processText);
            if (nm.matches()) {
                pid = (int) safeLong(nm.group(1), 0);
                process = nm.group(2);
            }
        }
        PortInfo info = new PortInfo();
        info.protocol = protocol;
        info.address = address;
        info.port = port;
        info.process = process;
        info.pid = pid;
        return info;
    }

    private static FwInfo parseUfw(List<String> lines, String svcState) {
        if (lines == null || lines.isEmpty()) {
            return FwInfo.none();
        }
        FwInfo f = new FwInfo("ufw");
        String text = join(lines);
        f.raw = truncate(text);
        String lower = text.toLowerCase(Locale.ROOT);
        f.restricted = permissionError(lower);
        if (lower.contains("status: active")) {
            f.active = Boolean.TRUE;
        } else if (lower.contains("status: inactive")) {
            f.active = Boolean.FALSE;
        } else if (svcState != null && !svcState.isEmpty()) {
            f.active = "active".equalsIgnoreCase(svcState);
        }
        f.rules = ufwRules(lines);
        return f;
    }

    private static List<String> ufwRules(List<String> lines) {
        List<String> out = new ArrayList<String>();
        boolean body = false;
        for (String line : lines) {
            String t = line == null ? "" : line.trim();
            if (!body) {
                if (t.matches("^-{2,}\\s+-{2,}.*$")) {
                    body = true;
                }
                continue;
            }
            if (t.isEmpty()) {
                continue;
            }
            out.add(t.replaceAll("\\s+", " "));
            if (out.size() >= MAX_RULES) {
                break;
            }
        }
        return out;
    }

    private static FwInfo parseFirewalld(List<String> lines, String svcState) {
        if (lines == null || lines.isEmpty()) {
            return FwInfo.none();
        }
        FwInfo f = new FwInfo("firewalld");
        String text = join(lines);
        f.raw = truncate(text);
        String lower = text.toLowerCase(Locale.ROOT);
        f.restricted = permissionError(lower);
        int listIdx = -1;
        for (int i = 0; i < lines.size(); i++) {
            if ("--LIST--".equals(lines.get(i).trim())) {
                listIdx = i;
                break;
            }
        }
        String state = listIdx > 0 ? join(lines.subList(0, listIdx)) : text;
        if (state.toLowerCase(Locale.ROOT).contains("not running")) {
            f.active = Boolean.FALSE;
        } else if (state.toLowerCase(Locale.ROOT).contains("running")) {
            f.active = Boolean.TRUE;
        } else if (svcState != null && !svcState.isEmpty()) {
            f.active = "active".equalsIgnoreCase(svcState);
        }
        if (Boolean.TRUE.equals(f.active) && listIdx >= 0) {
            List<String> rules = new ArrayList<String>();
            for (int i = listIdx + 1; i < lines.size(); i++) {
                String t = lines.get(i) == null ? "" : lines.get(i).trim();
                if (t.isEmpty()) {
                    continue;
                }
                if (t.indexOf(':') > 0 || t.endsWith("(active)")) {
                    rules.add(t.replaceAll("\\s+", " "));
                }
                if (rules.size() >= MAX_RULES) {
                    break;
                }
            }
            f.rules = rules;
        }
        return f;
    }

    private static FwInfo parseRuleSet(String type, List<String> lines, boolean nft) {
        if (lines == null || lines.isEmpty()) {
            return FwInfo.none();
        }
        FwInfo f = new FwInfo(type);
        String text = join(lines);
        f.raw = truncate(text);
        String lower = text.toLowerCase(Locale.ROOT);
        f.restricted = permissionError(lower);
        if (!f.restricted) {
            List<String> rules = new ArrayList<String>();
            boolean active = false;
            for (String line : lines) {
                String t = line == null ? "" : line.trim();
                if (t.isEmpty()) {
                    continue;
                }
                rules.add(t.replaceAll("\\s+", " "));
                if (nft) {
                    active = true;
                } else if (t.startsWith("-A ") || t.startsWith("-N ")
                        || (t.startsWith("-P ") && !t.endsWith(" ACCEPT"))) {
                    active = true;
                }
                if (rules.size() >= MAX_RULES) {
                    break;
                }
            }
            f.active = active;
            f.rules = rules;
        }
        return f;
    }

    static FwInfo chooseFirewall(Parsed p) {
        FwInfo ufw = p.ufw;
        FwInfo fwld = p.firewalld;
        FwInfo nft = p.nft;
        FwInfo ipt = p.iptables;
        if (ufw.installed && Boolean.TRUE.equals(ufw.active)) {
            return ufw;
        }
        if (fwld.installed && Boolean.TRUE.equals(fwld.active)) {
            return fwld;
        }
        if (nft.installed && !nft.restricted && Boolean.TRUE.equals(nft.active)) {
            return nft;
        }
        if (ipt.installed && !ipt.restricted && Boolean.TRUE.equals(ipt.active)) {
            return ipt;
        }
        if (ufw.installed && !ufw.restricted) {
            return ufw;
        }
        if (fwld.installed && !fwld.restricted) {
            return fwld;
        }
        if (nft.installed && !nft.restricted) {
            return nft;
        }
        if (ipt.installed && !ipt.restricted) {
            return ipt;
        }
        if (ufw.installed) {
            return ufw;
        }
        if (fwld.installed) {
            return fwld;
        }
        if (nft.installed) {
            return nft;
        }
        if (ipt.installed) {
            return ipt;
        }
        return FwInfo.none();
    }

    private static boolean permissionError(String lower) {
        return lower.contains("permission denied")
                || lower.contains("operation not permitted")
                || lower.contains("must be root")
                || lower.contains("need to be root")
                || lower.contains("you need to be root")
                || lower.contains("not authorized")
                || lower.contains("authorization failed")
                || lower.contains("access denied")
                || lower.contains("could not process rule");
    }

    static String scopeOf(String address) {
        String a = address == null ? "" : address.trim().toLowerCase(Locale.ROOT);
        if ("0.0.0.0".equals(a) || "::".equals(a) || "*".equals(a)) {
            return "all";
        }
        if ("::1".equals(a) || a.startsWith("127.") || "localhost".equals(a)) {
            return "local";
        }
        return "bound";
    }

    private static String join(List<String> lines) {
        StringBuilder sb = new StringBuilder();
        for (String line : lines) {
            if (line == null) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(line);
        }
        return sb.toString();
    }

    private static String truncate(String text) {
        if (text == null) {
            return "";
        }
        if (text.length() <= MAX_RAW_CHARS) {
            return text;
        }
        return text.substring(0, MAX_RAW_CHARS) + "\n…（已截断）";
    }

    private static long safeLong(String text, long def) {
        try {
            return Long.parseLong(text);
        } catch (Exception e) {
            return def;
        }
    }

    private static String firstLine(String text) {
        if (text == null) {
            return "无输出";
        }
        int idx = text.indexOf('\n');
        String line = idx >= 0 ? text.substring(0, idx) : text;
        return line.trim().isEmpty() ? "无输出" : line.trim();
    }

    static class Parsed {
        int uid = -1;
        boolean portsAvailable = true;
        final List<PortInfo> ports = new ArrayList<PortInfo>();
        final Set<String> portKeys = new HashSet<String>();
        FwInfo ufw = FwInfo.none();
        FwInfo firewalld = FwInfo.none();
        FwInfo nft = FwInfo.none();
        FwInfo iptables = FwInfo.none();
    }

    static class PortInfo {
        String protocol;
        String address;
        int port;
        String process = "";
        int pid = 0;

        String key() {
            return protocol + "|" + address + "|" + port + "|" + pid + "|" + process;
        }
    }

    static class FwInfo {
        final String type;
        boolean installed;
        Boolean active;
        boolean restricted;
        List<String> rules = Collections.emptyList();
        String raw = "";

        FwInfo(String type) {
            this.type = type;
            this.installed = true;
        }

        static FwInfo none() {
            FwInfo f = new FwInfo("none");
            f.installed = false;
            return f;
        }

        Map<String, Object> toMap() {
            Map<String, Object> map = new LinkedHashMap<String, Object>();
            map.put("type", type);
            map.put("typeLabel", label(type));
            map.put("installed", installed);
            map.put("active", active);
            map.put("restricted", restricted);
            map.put("rules", rules == null ? Collections.emptyList() : rules);
            map.put("raw", raw == null ? "" : raw);
            map.put("stateText", Boolean.TRUE.equals(active) ? "已启用"
                    : (Boolean.FALSE.equals(active) ? "未启用" : (restricted ? "需要 root" : "状态未知")));
            return map;
        }

        private static String label(String type) {
            if ("ufw".equals(type)) {
                return "UFW";
            }
            if ("firewalld".equals(type)) {
                return "firewalld";
            }
            if ("nftables".equals(type)) {
                return "nftables";
            }
            if ("iptables".equals(type)) {
                return "iptables";
            }
            return "未检测到";
        }
    }
}
