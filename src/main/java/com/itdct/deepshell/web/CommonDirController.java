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
    public R<List<CommonDir>> list() {
        return R.ok(service.list());
    }

    @PostMapping
    public R<CommonDir> add(@RequestBody Map<String, String> body) {
        return R.ok(service.add(body.get("path")));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return R.ok();
    }
}
