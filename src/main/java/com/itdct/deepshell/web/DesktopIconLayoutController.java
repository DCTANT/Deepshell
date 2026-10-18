package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.entity.DesktopIconLayout;
import com.itdct.deepshell.service.DesktopIconLayoutService;
import org.springframework.web.bind.annotation.*;

import java.util.Collections;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/desktop-icons")
public class DesktopIconLayoutController {

    private final DesktopIconLayoutService service;

    public DesktopIconLayoutController(DesktopIconLayoutService service) {
        this.service = service;
    }

    @GetMapping
    public R<List<DesktopIconLayout>> list(@RequestParam("connId") Long connId) {
        return R.ok(service.list(connId));
    }

    @PutMapping
    @SuppressWarnings("unchecked")
    public R<List<DesktopIconLayout>> save(@RequestBody Map<String, Object> body) {
        Object cid = body.get("connId");
        Long connId = cid == null ? null : Long.valueOf(String.valueOf(cid));
        Object raw = body.get("items");
        List<Map<String, Object>> items = Collections.emptyList();
        if (raw instanceof List) {
            items = (List<Map<String, Object>>) raw;
        }
        return R.ok(service.saveLayout(connId, items));
    }
}
