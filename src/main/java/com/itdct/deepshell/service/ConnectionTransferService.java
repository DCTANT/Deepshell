package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.itdct.deepshell.entity.SshConnection;
import com.itdct.deepshell.repo.SshConnectionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 连接配置导入/导出：
 * 导出 = 与 FinalShell conn 文件同构的对象数组，密码以其加密格式写入，可直接被 FinalShell 导入；
 * 导入 = 兼容 FinalShell 导出/conn 文件（数组、单对象、# 前缀键、明文或加密密码均支持）。
 */
@Slf4j
@Service
public class ConnectionTransferService {

    private static final char[] ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789".toCharArray();

    private final SshConnectionRepository repo;
    private final CryptoService cryptoService;
    private final ObjectMapper om = new ObjectMapper();

    public ConnectionTransferService(SshConnectionRepository repo, CryptoService cryptoService) {
        this.repo = repo;
        this.cryptoService = cryptoService;
    }

    public String exportJson() throws Exception {
        return exportJson(null);
    }

    /** ids 为 null/空时导出全部，否则只导出指定连接（保持原排序） */
    public String exportJson(List<Long> ids) throws Exception {
        List<SshConnection> list = repo.findAllByOrderBySortOrderAscIdAsc();
        if (ids != null && !ids.isEmpty()) {
            java.util.Set<Long> set = new java.util.HashSet<>(ids);
            List<SshConnection> filtered = new ArrayList<>();
            for (SshConnection c : list) {
                if (set.contains(c.getId())) {
                    filtered.add(c);
                }
            }
            list = filtered;
        }
        ArrayNode arr = om.createArrayNode();
        long now = System.currentTimeMillis();
        int order = 0;
        for (SshConnection c : list) {
            ObjectNode n = om.createObjectNode();
            n.put("forwarding_auto_reconnect", false);
            n.put("custom_size", false);
            n.put("delete_time", 0);
            n.put("secret_key_id", "");
            n.put("user_name", c.getUsername() == null ? "" : c.getUsername());
            n.putObject("remote_port_forwarding");
            n.put("conection_type", 100);
            n.put("sort_time", 0);
            String desc = c.getRemark() == null ? "" : c.getRemark();
            if ("KEY".equalsIgnoreCase(c.getAuthType())) {
                desc = desc.isEmpty() ? "[私钥认证] 导入后请在客户端配置密钥" : desc + "（私钥认证，导入后请配置密钥）";
            }
            n.put("description", desc);
            n.put("proxy_id", "0");
            n.put("authentication_type", 1);
            n.put("drivestoredirect", true);
            n.put("delete_key_sequence", 0);
            String plain = cryptoService.decrypt(c.getPasswordEnc());
            n.put("password", plain == null || plain.isEmpty() ? "" : ConnFileCrypto.encode(plain));
            n.put("modified_time", now);
            n.put("host", c.getHost());
            n.put("accelerate", false);
            n.put("id", randomId());
            n.put("height", 0);
            n.put("order", order++);
            n.put("create_time", now);
            n.putArray("port_forwarding_list");
            n.put("parent_update_time", 0);
            n.put("rename_time", 0);
            n.put("backspace_key_sequence", 2);
            n.put("fullscreen", false);
            n.put("port", c.getPort() == null ? 22 : c.getPort());
            n.put("terminal_encoding", "UTF-8");
            n.put("parent_id", "root");
            n.put("exec_channel_enable", true);
            n.put("width", 0);
            n.put("name", c.getName());
            n.put("access_time", 0);
            arr.add(n);
        }
        return om.writerWithDefaultPrettyPrinter().writeValueAsString(arr);
    }

    public Map<String, Object> importJson(byte[] bytes) throws Exception {
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) {
            byte[] noBom = new byte[bytes.length - 3];
            System.arraycopy(bytes, 3, noBom, 0, noBom.length);
            bytes = noBom;
        }
        JsonNode root = om.readTree(bytes);
        List<JsonNode> nodes = new ArrayList<>();
        if (root.isArray()) {
            root.forEach(nodes::add);
        } else if (root.isObject()) {
            if (root.has("connections") && root.get("connections").isArray()) {
                root.get("connections").forEach(nodes::add);
            } else {
                nodes.add(root);
            }
        }
        int imported = 0;
        int noPassword = 0;
        int skipped = 0;
        int failed = 0;
        for (JsonNode n : nodes) {
            try {
                String host = text(n, "host", "#host");
                if (host == null || host.trim().isEmpty()) {
                    skipped++;
                    continue;
                }
                String name = text(n, "name", "#name");
                SshConnection c = new SshConnection();
                c.setName(name == null || name.trim().isEmpty() ? host.trim() : name.trim());
                c.setHost(host.trim());
                c.setPort(parseInt(text(n, "port", "#port"), 22));
                String user = text(n, "user_name", "#user_name", "user", "#user");
                c.setUsername(user == null ? "" : user.trim());
                int authType = parseInt(text(n, "authentication_type", "#authentication_type"), 1);
                c.setAuthType(authType == 2 ? "KEY" : "PASSWORD");
                c.setRemark(text(n, "description", "#description"));

                String encPwd = text(n, "password", "#password");
                if (encPwd != null && !encPwd.trim().isEmpty()) {
                    String pwd = encPwd.trim();
                    String plain = null;
                    try {
                        plain = ConnFileCrypto.decode(pwd);
                    } catch (Exception ignore) {
                    }
                    if (plain == null || plain.isEmpty() || !printable(plain)) {
                        plain = pwd;
                    }
                    c.setPasswordEnc(cryptoService.encrypt(plain));
                } else {
                    noPassword++;
                }
                if ("KEY".equals(c.getAuthType())) {
                    String r = c.getRemark();
                    c.setRemark(r == null || r.isEmpty() ? "[需配置私钥]" : r + "（需配置私钥）");
                }
                repo.save(c);
                imported++;
            } catch (Exception e) {
                failed++;
                log.warn("导入连接失败: {}", e.getMessage());
            }
        }
        Map<String, Object> r = new HashMap<>();
        r.put("total", nodes.size());
        r.put("imported", imported);
        r.put("skipped", skipped);
        r.put("failed", failed);
        r.put("noPassword", noPassword);
        StringBuilder msg = new StringBuilder("导入完成：成功 " + imported + " 条");
        if (noPassword > 0) {
            msg.append("，无密码 ").append(noPassword).append(" 条（导入后请编辑补全）");
        }
        if (skipped > 0) {
            msg.append("，跳过无效 ").append(skipped).append(" 条");
        }
        if (failed > 0) {
            msg.append("，失败 ").append(failed).append(" 条");
        }
        r.put("message", msg.toString());
        return r;
    }

    private static String text(JsonNode n, String... keys) {
        for (String k : keys) {
            JsonNode v = n.get(k);
            if (v != null && !v.isNull() && !v.asText().isEmpty()) {
                return v.asText();
            }
        }
        return null;
    }

    private static int parseInt(String s, int def) {
        try {
            return Integer.parseInt(s == null ? "" : s.trim());
        } catch (Exception e) {
            return def;
        }
    }

    private static boolean printable(String s) {
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch < 32 || ch == 127) {
                return false;
            }
        }
        return true;
    }

    private static String randomId() {
        SecureRandom rnd = new SecureRandom();
        StringBuilder sb = new StringBuilder(16);
        for (int i = 0; i < 16; i++) {
            sb.append(ID_CHARS[rnd.nextInt(ID_CHARS.length)]);
        }
        return sb.toString();
    }
}
