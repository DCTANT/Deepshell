package com.itdct.deepshell.service;

import com.itdct.deepshell.dto.GatewayForm;
import com.itdct.deepshell.entity.GatewayEndpoint;
import com.itdct.deepshell.repo.GatewayEndpointRepository;
import com.itdct.deepshell.repo.SshConnectionRepository;
import org.springframework.stereotype.Service;

import javax.net.ssl.SSLException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 本地 DeepShell 侧的网关配置：增删改查、连通性测试与被引用保护。
 */
@Service
public class GatewayEndpointService {

    private final GatewayEndpointRepository repo;
    private final SshConnectionRepository connectionRepo;
    private final CryptoService cryptoService;
    private final GatewayClient client;
    private final AuditService audit;

    public GatewayEndpointService(GatewayEndpointRepository repo, SshConnectionRepository connectionRepo,
                                  CryptoService cryptoService, GatewayClient client, AuditService audit) {
        this.repo = repo;
        this.connectionRepo = connectionRepo;
        this.cryptoService = cryptoService;
        this.client = client;
        this.audit = audit;
    }

    public List<GatewayEndpoint> list() {
        return repo.findAllByOrderByIdAsc();
    }

    public GatewayEndpoint get(Long id) {
        return repo.findById(id).orElseThrow(() -> new IllegalArgumentException("执行网关不存在: " + id));
    }

    public String tokenOf(GatewayEndpoint gateway) {
        return cryptoService.decrypt(gateway.getTokenEnc());
    }

    public GatewayEndpoint create(GatewayForm form) {
        GatewayEndpoint g = new GatewayEndpoint();
        apply(g, form, true);
        GatewayEndpoint saved = repo.save(g);
        audit.record("GATEWAY_CREATE", saved.getName(), "OK", saved.getBaseUrl());
        return saved;
    }

    public GatewayEndpoint update(Long id, GatewayForm form) {
        GatewayEndpoint g = get(id);
        apply(g, form, false);
        GatewayEndpoint saved = repo.save(g);
        audit.record("GATEWAY_UPDATE", saved.getName(), "OK", saved.getBaseUrl());
        return saved;
    }

    public void delete(Long id) {
        GatewayEndpoint g = get(id);
        List<com.itdct.deepshell.entity.SshConnection> used = connectionRepo.findByGatewayId(id);
        if (!used.isEmpty()) {
            String names = used.size() > 3
                    ? used.get(0).getName() + " 等 " + used.size() + " 条连接"
                    : joinNames(used);
            throw new IllegalArgumentException("该网关正被 " + names + " 使用，请先把这些连接的网关改为直连");
        }
        repo.delete(g);
        audit.record("GATEWAY_DELETE", g.getName(), "OK", g.getBaseUrl());
    }

    private static String joinNames(List<com.itdct.deepshell.entity.SshConnection> list) {
        List<String> names = new ArrayList<>();
        for (com.itdct.deepshell.entity.SshConnection c : list) {
            names.add(c.getName());
        }
        return String.join("、", names);
    }

    /**
     * 测试网关可用性；编辑态留空 Token 时沿用已保存的 Token。
     */
    public Map<String, Object> test(GatewayForm form) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            String baseUrl = normalizeBaseUrl(form.getBaseUrl());
            String token = form.getToken();
            if (isBlank(token) && form.getId() != null) {
                token = tokenOf(get(form.getId()));
            }
            if (isBlank(token)) {
                throw new IllegalArgumentException("请填写网关注入 Token（在对方 DeepShell 的「执行网关」中查看）");
            }
            boolean insecure = form.getInsecureTls() != null && form.getInsecureTls();
            Map<String, Object> info = client.info(baseUrl, token.trim(), insecure);
            result.put("ok", true);
            result.put("message", "网关可用" + (String.valueOf(info.get("version")).isEmpty()
                    ? "" : "，版本 " + info.get("version")));
            result.putAll(info);
            return result;
        } catch (IllegalArgumentException e) {
            return failure(result, e.getMessage());
        } catch (UnknownHostException e) {
            return failure(result, "无法解析网关地址，请检查地址填写");
        } catch (ConnectException | NoRouteToHostException e) {
            return failure(result, "无法连接网关，请检查地址、端口与防火墙");
        } catch (SocketTimeoutException e) {
            return failure(result, "连接网关超时，请检查网络");
        } catch (SSLException e) {
            return failure(result, "网关 HTTPS 证书不受信任；自签证书请勾选「跳过证书校验」");
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            return failure(result, msg);
        }
    }

    private static Map<String, Object> failure(Map<String, Object> result, String message) {
        result.put("ok", false);
        result.put("message", message == null ? "网关测试失败" : message);
        return result;
    }

    private void apply(GatewayEndpoint g, GatewayForm f, boolean creating) {
        if (isBlank(f.getName())) {
            throw new IllegalArgumentException("请填写网关名称");
        }
        String baseUrl = normalizeBaseUrl(f.getBaseUrl());
        if (creating && isBlank(f.getToken())) {
            throw new IllegalArgumentException("请填写网关注入 Token");
        }
        g.setName(f.getName().trim());
        g.setBaseUrl(baseUrl);
        g.setInsecureTls(f.getInsecureTls() != null && f.getInsecureTls());
        g.setEnabled(f.getEnabled() == null || f.getEnabled());
        if (!isBlank(f.getToken())) {
            g.setTokenEnc(cryptoService.encrypt(f.getToken().trim()));
        }
    }

    private static String normalizeBaseUrl(String raw) {
        if (isBlank(raw)) {
            throw new IllegalArgumentException("请填写网关地址，例如 https://192.168.0.20:17777");
        }
        String value = raw.trim();
        URI uri;
        try {
            uri = URI.create(value);
        } catch (Exception e) {
            throw new IllegalArgumentException("网关地址格式不正确");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            throw new IllegalArgumentException("网关地址需以 http:// 或 https:// 开头");
        }
        if (uri.getHost() == null || uri.getHost().isEmpty()) {
            throw new IllegalArgumentException("网关地址缺少主机名");
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }
}
