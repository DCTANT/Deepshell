package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.entity.ConnFolder;
import com.itdct.deepshell.service.FolderService;
import lombok.Data;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/folders")
public class FolderController {

    private final FolderService service;

    public FolderController(FolderService service) {
        this.service = service;
    }

    @GetMapping
    public R<List<ConnFolder>> list() {
        return R.ok(service.list());
    }

    @PostMapping
    public R<ConnFolder> create(@RequestBody FolderForm form) {
        return R.ok(service.create(form.getName(), form.getParentId()));
    }

    @PutMapping("/{id}")
    public R<ConnFolder> rename(@PathVariable Long id, @RequestBody FolderForm form) {
        return R.ok(service.rename(id, form.getName()));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return R.ok();
    }

    @Data
    public static class FolderForm {
        private String name;
        private Long parentId;
    }
}
