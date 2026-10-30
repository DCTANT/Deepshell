package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.ConnectionForm;
import com.itdct.deepshell.entity.SshConnection;
import com.itdct.deepshell.repo.AiConversationRepository;
import com.itdct.deepshell.repo.CommonDirRepository;
import com.itdct.deepshell.repo.ConnFolderRepository;
import com.itdct.deepshell.repo.PortForwardRuleRepository;
import com.itdct.deepshell.repo.SshConnectionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class ConnectionService {

    private final SshConnectionRepository repo;
    private final ConnFolderRepository folderRepo;
    private final AiConversationRepository aiConvRepo;
    private final CommonDirRepository commonDirRepo;
    private final PortForwardRuleRepository portForwardRepo;
    private final CryptoService cryptoService;
    private final GatewayEndpointService gatewayService;

    public ConnectionService(SshConnectionRepository repo, ConnFolderRepository folderRepo,
                             AiConversationRepository aiConvRepo, CommonDirRepository commonDirRepo,
                             PortForwardRuleRepository portForwardRepo, CryptoService cryptoService,
                             GatewayEndpointService gatewayService) {
        this.repo = repo;
        this.folderRepo = folderRepo;
        this.aiConvRepo = aiConvRepo;
        this.commonDirRepo = commonDirRepo;
        this.portForwardRepo = portForwardRepo;
        this.cryptoService = cryptoService;
        this.gatewayService = gatewayService;
    }

    public List<SshConnection> list() {
        return repo.findAllByOrderBySortOrderAscIdAsc();
    }

    public SshConnection get(Long id) {
        return repo.findById(id).orElseThrow(() -> new IllegalArgumentException("连接不存在: " + id));
    }

    public SshConnection create(ConnectionForm form) {
        SshConnection c = new SshConnection();
        apply(c, form);
        return repo.save(c);
    }

    public SshConnection update(Long id, ConnectionForm form) {
        SshConnection c = get(id);
        apply(c, form);
        return repo.save(c);
    }

    /** 复制连接：保留主机、认证方式与已加密的密码/私钥口令，名称追加「-4位uuid」 */
    public SshConnection duplicate(Long id) {
        SshConnection src = get(id);
        SshConnection c = new SshConnection();
        c.setName(duplicateName(src.getName()));
        c.setGroupName(src.getGroupName());
        c.setHost(src.getHost());
        c.setPort(src.getPort());
        c.setUsername(src.getUsername());
        c.setAuthType(src.getAuthType());
        c.setPasswordEnc(src.getPasswordEnc());
        c.setKeyPath(src.getKeyPath());
        c.setPassphraseEnc(src.getPassphraseEnc());
        c.setRemark(src.getRemark());
        c.setProxyType(src.getProxyType());
        c.setProxyHost(src.getProxyHost());
        c.setProxyPort(src.getProxyPort());
        c.setProxyUsername(src.getProxyUsername());
        c.setProxyPasswordEnc(src.getProxyPasswordEnc());
        c.setJumpConnectionId(src.getJumpConnectionId());
        c.setGatewayId(src.getGatewayId());
        c.setPersistSession(src.getPersistSession());
        c.setFolderId(src.getFolderId());
        c.setSortOrder(src.getSortOrder());
        return repo.save(c);
    }

    private static String duplicateName(String name) {
        String suffix = "-" + UUID.randomUUID().toString().substring(0, 4);
        String base = name == null ? "" : name;
        int maxBase = 100 - suffix.length();
        if (base.length() > maxBase) {
            base = base.substring(0, maxBase);
        }
        return base + suffix;
    }

    /** 按传入顺序重写同组连接的排序值 */
    @Transactional
    public void reorder(List<Long> ids) {
        List<SshConnection> list = new ArrayList<>(ids.size());
        for (int i = 0; i < ids.size(); i++) {
            SshConnection c = get(ids.get(i));
            c.setSortOrder(i);
            list.add(c);
        }
        repo.saveAll(list);
    }

    public void delete(Long id) {
        List<SshConnection> dependents = repo.findByJumpConnectionId(id);
        if (!dependents.isEmpty()) {
            String names = dependents.size() > 3
                    ? dependents.get(0).getName() + " 等 " + dependents.size() + " 条连接"
                    : dependents.stream().map(SshConnection::getName).reduce((a, b) -> a + "、" + b).orElse("");
            throw new IllegalArgumentException("该连接正被 " + names + " 用作跳板机，请先调整这些连接");
        }
        // 一并清理该连接的 AI 终端对话、常用目录与端口转发规则
        aiConvRepo.deleteAll(aiConvRepo.findByConnectionId(id));
        commonDirRepo.deleteAll(commonDirRepo.findByConnectionIdOrderByIdAsc(id));
        portForwardRepo.deleteByConnectionId(id);
        repo.deleteById(id);
    }

    /** 更新置顶 / 收藏标记 */
    public SshConnection updateFlags(Long id, Boolean favorite, Boolean pinned) {
        SshConnection c = get(id);
        if (favorite != null) {
            c.setFavorite(favorite);
        }
        if (pinned != null) {
            c.setPinned(pinned);
        }
        return repo.save(c);
    }

    /** 记录最近打开时间 */
    public SshConnection touch(Long id) {
        SshConnection c = get(id);
        c.setLastUsedAt(System.currentTimeMillis());
        return repo.save(c);
    }

    /** 仅调整所属文件夹（folderId 为 null 表示移到根目录） */
    public SshConnection move(Long id, Long folderId) {
        SshConnection c = get(id);
        if (folderId != null) {
            folderRepo.findById(folderId).orElseThrow(() -> new IllegalArgumentException("目标文件夹不存在"));
        }
        c.setFolderId(folderId);
        return repo.save(c);
    }

    private void apply(SshConnection c, ConnectionForm f) {
        if (isBlank(f.getName())) {
            throw new IllegalArgumentException("连接名称不能为空");
        }
        if (isBlank(f.getHost())) {
            throw new IllegalArgumentException("主机地址不能为空");
        }
        int port = f.getPort() == null ? 22 : f.getPort();
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("端口范围不正确");
        }
        if (isBlank(f.getUsername())) {
            throw new IllegalArgumentException("用户名不能为空");
        }
        String authType = isBlank(f.getAuthType()) ? "PASSWORD" : f.getAuthType().toUpperCase();
        if (!"PASSWORD".equals(authType) && !"KEY".equals(authType)) {
            throw new IllegalArgumentException("认证方式仅支持 PASSWORD / KEY");
        }
        c.setName(f.getName().trim());
        c.setHost(f.getHost().trim());
        c.setPort(port);
        c.setUsername(f.getUsername().trim());
        c.setAuthType(authType);
        c.setGroupName(trimOrNull(f.getGroupName()));
        c.setKeyPath(trimOrNull(f.getKeyPath()));
        c.setRemark(trimOrNull(f.getRemark()));
        // 编辑表单不携带排序值，缺省时保留现有顺序
        if (f.getSortOrder() != null) {
            c.setSortOrder(f.getSortOrder());
        }
        // 前端表单总是携带 folderId（null 表示根目录），可直接覆盖
        c.setFolderId(f.getFolderId());
        if (f.getFavorite() != null) {
            c.setFavorite(f.getFavorite());
        }
        if (f.getPinned() != null) {
            c.setPinned(f.getPinned());
        }

        if (!isBlank(f.getPassword())) {
            c.setPasswordEnc(cryptoService.encrypt(f.getPassword()));
        }
        if (!isBlank(f.getPassphrase())) {
            c.setPassphraseEnc(cryptoService.encrypt(f.getPassphrase()));
        }

        String proxyType = isBlank(f.getProxyType()) ? "NONE" : f.getProxyType().trim().toUpperCase();
        if (!"NONE".equals(proxyType) && !"HTTP".equals(proxyType) && !"SOCKS5".equals(proxyType)) {
            throw new IllegalArgumentException("代理类型仅支持 HTTP / SOCKS5");
        }
        c.setProxyType(proxyType);
        if ("NONE".equals(proxyType)) {
            c.setProxyHost(null);
            c.setProxyPort(null);
            c.setProxyUsername(null);
            c.setProxyPasswordEnc(null);
        } else {
            if (isBlank(f.getProxyHost())) {
                throw new IllegalArgumentException("请填写代理地址");
            }
            int proxyPort = f.getProxyPort() == null
                    ? ("SOCKS5".equals(proxyType) ? 1080 : 8080) : f.getProxyPort();
            if (proxyPort < 1 || proxyPort > 65535) {
                throw new IllegalArgumentException("代理端口范围不正确");
            }
            c.setProxyHost(f.getProxyHost().trim());
            c.setProxyPort(proxyPort);
            c.setProxyUsername(trimOrNull(f.getProxyUsername()));
            if (!isBlank(f.getProxyPassword())) {
                c.setProxyPasswordEnc(cryptoService.encrypt(f.getProxyPassword()));
            }
        }

        Long selfId = c.getId();
        Long jumpId = f.getJumpConnectionId();
        if (jumpId != null) {
            if (selfId != null && jumpId.equals(selfId)) {
                throw new IllegalArgumentException("跳板机不能选择当前连接自身");
            }
            validateJumpChain(jumpId, selfId);
        }
        c.setJumpConnectionId(jumpId);
        Long gatewayId = f.getGatewayId();
        if (gatewayId != null) {
            gatewayService.get(gatewayId);
            if (!"NONE".equals(proxyType)) {
                throw new IllegalArgumentException("使用执行网关时不能同时设置代理；如需代理请在网关侧配置出口");
            }
        }
        c.setGatewayId(gatewayId);
        if (f.getPersistSession() != null) {
            c.setPersistSession(f.getPersistSession());
        } else if (c.getPersistSession() == null) {
            c.setPersistSession(Boolean.TRUE);
        }
    }

    /** 校验跳板机链路：必须存在、不能包含自身、不能循环、层级不超过 10 */
    private void validateJumpChain(Long startId, Long selfId) {
        java.util.Set<Long> seen = new java.util.HashSet<>();
        Long cur = startId;
        int depth = 0;
        while (cur != null) {
            if (selfId != null && cur.equals(selfId)) {
                throw new IllegalArgumentException("跳板机链路不能包含当前连接自身");
            }
            if (!seen.add(cur)) {
                throw new IllegalArgumentException("跳板机链路存在循环引用");
            }
            if (++depth > 10) {
                throw new IllegalArgumentException("跳板机层级过深（最多 10 级）");
            }
            SshConnection next = get(cur);
            cur = next.getJumpConnectionId();
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    private static String trimOrNull(String s) {
        return isBlank(s) ? null : s.trim();
    }
}
