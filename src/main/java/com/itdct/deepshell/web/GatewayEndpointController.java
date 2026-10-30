package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.GatewayForm;
import com.itdct.deepshell.entity.GatewayEndpoint;
import com.itdct.deepshell.service.GatewayEndpointService;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 本机使用的执行网关列表。Token 加密保存，只在创建/修改时单向传入。
 */
@RestController
@RequestMapping("/api/gateways")
public class GatewayEndpointController {

    private final GatewayEndpointService service;

    public GatewayEndpointController(GatewayEndpointService service) {
        this.service = service;
    }

    @GetMapping
    public R<List<Map<String, Object>>> list() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (GatewayEndpoint g : service.list()) {
            out.add(view(g));
        }
        return R.ok(out);
    }

    @PostMapping
    public R<Map<String, Object>> create(@RequestBody GatewayForm form) {
        return R.ok(view(service.create(form)));
    }

    @PutMapping("/{id}")
    public R<Map<String, Object>> update(@PathVariable Long id, @RequestBody GatewayForm form) {
        return R.ok(view(service.update(id, form)));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return R.ok();
    }

    /** 测试网关地址与 Token；编辑态留空 Token 时沿用已保存的值 */
    @PostMapping("/test")
    public R<Map<String, Object>> test(@RequestBody GatewayForm form) {
        return R.ok(service.test(form));
    }

    private static Map<String, Object> view(GatewayEndpoint g) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", g.getId());
        m.put("name", g.getName());
        m.put("baseUrl", g.getBaseUrl());
        m.put("insecureTls", g.getInsecureTls() != null && g.getInsecureTls());
        m.put("enabled", g.getEnabled() == null || g.getEnabled());
        m.put("hasToken", g.getTokenEnc() != null && !g.getTokenEnc().isEmpty());
        return m;
    }
}
