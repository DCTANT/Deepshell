package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.entity.KnownHost;
import com.itdct.deepshell.service.HostKeyService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/known-hosts")
public class KnownHostController {

    private final HostKeyService service;

    public KnownHostController(HostKeyService service) {
        this.service = service;
    }

    @GetMapping
    public R<List<KnownHost>> list() {
        return R.ok(service.list());
    }

    /** 用户确认指纹后写入信任；replace=true 表示确认替换已变更的旧指纹 */
    @PostMapping("/trust")
    public R<KnownHost> trust(@RequestBody Map<String, Object> body) {
        String host = str(body.get("host"));
        int port = body.get("port") instanceof Number ? ((Number) body.get("port")).intValue() : 22;
        String keyType = str(body.get("keyType"));
        String keyBase64 = str(body.get("keyBase64"));
        boolean replace = Boolean.parseBoolean(String.valueOf(body.get("replace")));
        String role = str(body.get("role"));
        String roleLabel = str(body.get("roleLabel"));
        return R.ok(service.trust(host, port, keyType, keyBase64, replace, role, roleLabel));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable("id") Long id) {
        service.delete(id);
        return R.ok();
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
