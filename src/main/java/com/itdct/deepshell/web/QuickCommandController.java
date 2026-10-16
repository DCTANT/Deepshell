package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.entity.QuickCommand;
import com.itdct.deepshell.service.QuickCommandService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/quick-commands")
public class QuickCommandController {

    private final QuickCommandService service;

    public QuickCommandController(QuickCommandService service) {
        this.service = service;
    }

    @GetMapping
    public R<List<QuickCommand>> list() {
        return R.ok(service.list());
    }

    @PostMapping
    public R<QuickCommand> create(@RequestBody QuickCommand form) {
        return R.ok(service.save(null, form));
    }

    @PutMapping("/{id}")
    public R<QuickCommand> update(@PathVariable Long id, @RequestBody QuickCommand form) {
        return R.ok(service.save(id, form));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return R.ok();
    }
}
