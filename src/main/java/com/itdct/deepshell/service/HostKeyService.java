package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.KnownHost;
import com.itdct.deepshell.repo.KnownHostRepository;
import com.jcraft.jsch.HostKey;
import com.jcraft.jsch.HostKeyRepository;
import com.jcraft.jsch.UserInfo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * SSH 主机指纹管理：首次连接必须由用户确认指纹，后续指纹变化默认拒绝。
 * 不使用 JSch 的 known_hosts 文件，而是跟随数据目录存入 SQLite。
 */
@Slf4j
@Service
public class HostKeyService {

    private final KnownHostRepository repo;
    private final AuditService audit;

    public HostKeyService(KnownHostRepository repo, AuditService audit) {
        this.repo = repo;
        this.audit = audit;
    }

    public List<KnownHost> list() {
        return repo.findAllByOrderByHostAscPortAscKeyTypeAsc();
    }

    /** 为一次 SSH 连接创建固定端点的校验仓库（JSch 传入的 host 参数会被忽略） */
    public Repository repository(String host, int port, String role, String roleLabel) {
        return new Repository(host, port, role, roleLabel);
    }

    public KnownHost trust(String host, int port, String keyType, String keyBase64,
                           boolean replace, String role, String roleLabel) {
        String h = require(host, "主机地址不能为空");
        int p = port < 1 || port > 65535 ? 22 : port;
        String type = require(keyType, "缺少密钥类型");
        String b64 = require(keyBase64, "缺少主机密钥");
        byte[] key;
        try {
            key = Base64.getDecoder().decode(b64);
        } catch (Exception e) {
            throw new IllegalArgumentException("主机密钥格式不正确");
        }
        String fingerprint = fingerprint(key);
        Optional<KnownHost> existing = repo.findFirstByHostAndPortAndKeyTypeOrderByIdAsc(h, p, type);
        KnownHost entry;
        String result;
        if (existing.isPresent()) {
            entry = existing.get();
            if (!replace && !b64.equals(entry.getKeyBase64())) {
                throw new IllegalArgumentException("该主机已保存其他指纹，请在确认风险后选择更新");
            }
            result = replace && !b64.equals(entry.getKeyBase64()) ? "REPLACE" : "OK";
            entry.setKeyBase64(b64);
            entry.setFingerprint(fingerprint);
            entry = repo.save(entry);
        } else {
            entry = new KnownHost();
            entry.setHost(h);
            entry.setPort(p);
            entry.setKeyType(type);
            entry.setKeyBase64(b64);
            entry.setFingerprint(fingerprint);
            entry = repo.save(entry);
            result = "TRUST";
        }
        audit.record("HOST_KEY", h + ":" + p, result,
                (roleLabel == null ? role : roleLabel) + " " + type + " " + fingerprint);
        return entry;
    }

    public void delete(Long id) {
        Optional<KnownHost> entry = repo.findById(id);
        if (entry.isPresent()) {
            KnownHost k = entry.get();
            repo.delete(k);
            audit.record("HOST_KEY", k.getHost() + ":" + k.getPort(), "DELETE",
                    k.getKeyType() + " " + k.getFingerprint());
        }
    }

    static String fingerprint(byte[] key) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(key);
            return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception e) {
            return "SHA256:unknown";
        }
    }

    private static String require(String v, String message) {
        String s = v == null ? null : v.trim();
        if (s == null || s.isEmpty()) {
            throw new IllegalArgumentException(message);
        }
        return s;
    }

    static Map<String, Object> hostKeyInfo(String host, int port, String role, String roleLabel,
                                           String keyType, byte[] key, boolean changed,
                                           String knownFingerprint) {
        String b64 = Base64.getEncoder().encodeToString(key);
        String fp = fingerprint(key);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("host", host);
        m.put("port", port);
        m.put("role", role);
        m.put("roleLabel", roleLabel);
        m.put("keyType", keyType);
        m.put("keyBase64", b64);
        m.put("fingerprint", fp);
        m.put("changed", changed);
        if (knownFingerprint != null) {
            m.put("knownFingerprint", knownFingerprint);
        }
        m.put("message", changed
                ? "这台服务器的「身份证」和上次保存的不一样。若你最近没有重装系统或更换 SSH 密钥，请不要信任，先通过云控制台 VNC 核对。"
                : "第一次见这台服务器。先核对它的「身份证」（SSH 主机指纹），确认是本人后再保存。");
        m.put("verifyCommand", verifyCommand(keyType));
        return m;
    }

    /** 给新手直接照着执行的指纹核对命令。 */
    private static String verifyCommand(String keyType) {
        String type = keyType == null ? "" : keyType.toLowerCase(Locale.ROOT);
        String file;
        if (type.contains("ed25519")) {
            file = "/etc/ssh/ssh_host_ed25519_key.pub";
        } else if (type.contains("ecdsa")) {
            file = "/etc/ssh/ssh_host_ecdsa_key.pub";
        } else if (type.contains("rsa")) {
            file = "/etc/ssh/ssh_host_rsa_key.pub";
        } else {
            file = "/etc/ssh/ssh_host_*_key.pub";
        }
        return "sudo ssh-keygen -lf " + file;
    }

    /** JSch 的 HostKeyRepository 适配：端点固定，未知/变更时记录最后见到的密钥供上层抛出确认框 */
    public final class Repository implements HostKeyRepository {

        private final String host;
        private final int port;
        private final String role;
        private final String roleLabel;
        private volatile Map<String, Object> lastProblem;

        Repository(String host, int port, String role, String roleLabel) {
            this.host = host;
            this.port = port;
            this.role = role;
            this.roleLabel = roleLabel == null ? (("jump".equals(role)) ? "跳板机" : "目标主机") : roleLabel;
        }

        public Map<String, Object> getLastProblem() {
            return lastProblem;
        }

        @Override
        public int check(String ignoredHost, byte[] key) {
            String keyType = "unknown";
            try {
                keyType = new HostKey(host, key).getType();
                String b64 = Base64.getEncoder().encodeToString(key);
                List<KnownHost> known = repo.findByHostAndPortOrderByIdAsc(host, port);
                KnownHost sameType = null;
                for (KnownHost k : known) {
                    if (b64.equals(k.getKeyBase64())) {
                        lastProblem = null;
                        return OK;
                    }
                    if (keyType.equalsIgnoreCase(k.getKeyType())) {
                        sameType = k;
                    }
                }
                boolean changed = sameType != null;
                lastProblem = hostKeyInfo(host, port, role, roleLabel, keyType, key,
                        changed, changed ? sameType.getFingerprint() : null);
                return changed ? CHANGED : NOT_INCLUDED;
            } catch (Exception e) {
                log.warn("主机密钥校验失败 {}:{}: {}", host, port, e.getMessage());
                try {
                    lastProblem = hostKeyInfo(host, port, role, roleLabel, keyType, key, false, null);
                } catch (Exception ignore) {
                    lastProblem = null;
                }
                return NOT_INCLUDED;
            }
        }

        @Override
        public void add(HostKey hostkey, UserInfo ui) {
            // 只允许通过显式信任接口写入，避免 SSH 握手过程中静默信任
        }

        @Override
        public void remove(String h, String type) {
            if (type == null || type.isEmpty()) {
                repo.findByHostAndPortOrderByIdAsc(host, port).forEach(repo::delete);
            } else {
                repo.deleteByHostAndPortAndKeyType(host, port, type);
            }
        }

        @Override
        public void remove(String h, String type, byte[] key) {
            remove(h, type);
        }

        @Override
        public String getKnownHostsRepositoryID() {
            return "deepshell";
        }

        @Override
        public HostKey[] getHostKey() {
            return toHostKeys(repo.findAllByOrderByHostAscPortAscKeyTypeAsc());
        }

        @Override
        public HostKey[] getHostKey(String h, String type) {
            List<KnownHost> list = repo.findByHostAndPortOrderByIdAsc(host, port);
            List<KnownHost> filtered = new ArrayList<>();
            for (KnownHost k : list) {
                if (type == null || type.isEmpty() || type.equalsIgnoreCase(k.getKeyType())) {
                    filtered.add(k);
                }
            }
            return toHostKeys(filtered);
        }

        private HostKey[] toHostKeys(List<KnownHost> list) {
            List<HostKey> out = new ArrayList<>();
            for (KnownHost k : list) {
                try {
                    out.add(new HostKey(k.getHost(), Base64.getDecoder().decode(k.getKeyBase64())));
                } catch (Exception ignore) {
                    // 跳过损坏的旧记录
                }
            }
            return out.toArray(new HostKey[0]);
        }
    }

}
