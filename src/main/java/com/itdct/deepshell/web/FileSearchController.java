package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.ContentSearchReq;
import com.itdct.deepshell.dto.FileChecksumResult;
import com.itdct.deepshell.dto.FileContentMatch;
import com.itdct.deepshell.dto.FileSearchEntry;
import com.itdct.deepshell.service.FileSearchService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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

    /** 资源管理器：在当前目录的子树中搜索文件内容 */
    @PostMapping("/content-search")
    public R<List<FileContentMatch>> contentSearch(@RequestBody ContentSearchReq req) throws Exception {
        if (req == null) {
            throw new IllegalArgumentException("请求参数缺失");
        }
        return R.ok(service.contentSearch(req.getSessionId(), req.getRoot(), req.getKeyword(),
                req.getInclude(), req.isCaseSensitive(), req.getMaxResults()));
    }

    /** 资源管理器：计算远程文件 MD5 / SHA-1 / SHA-256 */
    @GetMapping("/checksum")
    public R<FileChecksumResult> checksum(@RequestParam("sessionId") String sessionId,
                                          @RequestParam("path") String path,
                                          @RequestParam(value = "algorithm", defaultValue = "sha256")
                                                  String algorithm) throws Exception {
        return R.ok(service.checksum(sessionId, path, algorithm));
    }
}
