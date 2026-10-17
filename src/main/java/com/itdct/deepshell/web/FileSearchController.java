package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.FileSearchEntry;
import com.itdct.deepshell.service.FileSearchService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/files")
public class FileSearchController {

    private final FileSearchService service;

    public FileSearchController(FileSearchService service) {
        this.service = service;
    }

    /** 开始菜单：在指定目录的子树中按名称搜索文件 / 文件夹 */
    @GetMapping("/search")
    public R<List<FileSearchEntry>> search(@RequestParam("sessionId") String sessionId,
                                           @RequestParam(value = "root", required = false) String root,
                                           @RequestParam("keyword") String keyword,
                                           @RequestParam(value = "limit", defaultValue = "100") int limit) throws Exception {
        return R.ok(service.search(sessionId, root, keyword, limit));
    }
}
