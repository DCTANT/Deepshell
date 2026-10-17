package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.entity.CommonDir;
import com.itdct.deepshell.service.CommonDirService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/common-dirs")
public class CommonDirController {

    private final CommonDirService service;

    public CommonDirController(CommonDirService service) {
        this.service = service;
    }

    @GetMapping
    public R<List<CommonDir>> list(@RequestParam Long connId) {
        return R.ok(service.list(connId));
    }

    @PostMapping
    public R<CommonDir> add(@RequestBody Map<String, Object> body) {
        Object cid = body.get("connId");
        Long connId = cid == null ? null : Long.valueOf(String.valueOf(cid));
        return R.ok(service.add(connId, (String) body.get("path")));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id, @RequestParam Long connId) {
        service.delete(connId, id);
        return R.ok();
    }
}
