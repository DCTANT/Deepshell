package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.ConnectionForm;
import com.itdct.deepshell.entity.SshConnection;
import com.itdct.deepshell.service.AuditService;
import com.itdct.deepshell.service.ConnectionService;
import com.itdct.deepshell.service.ConnectionTransferService;
import com.itdct.deepshell.service.SshSessionManager;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/connections")
public class ConnectionController {

    private final ConnectionService service;
    private final ConnectionTransferService transferService;
    private final SshSessionManager sessionManager;
    private final AuditService audit;

    public ConnectionController(ConnectionService service, ConnectionTransferService transferService,
                                SshSessionManager sessionManager, AuditService audit) {
        this.service = service;
        this.transferService = transferService;
        this.sessionManager = sessionManager;
        this.audit = audit;
    }

    @GetMapping
    public R<List<SshConnection>> list() {
        return R.ok(service.list());
    }

    @GetMapping("/{id}")
    public R<SshConnection> get(@PathVariable Long id) {
        return R.ok(service.get(id));
    }

    /** 测试连接参数是否可用（不保存）；编辑时留空的密码 / 私钥口令沿用已保存值 */
    @PostMapping("/test")
    public R<Map<String, Object>> test(@RequestBody ConnectionForm form) {
        return R.ok(sessionManager.test(form));
    }

    @PostMapping
    public R<SshConnection> create(@RequestBody ConnectionForm form) {
        SshConnection saved = service.create(form);
        audit.record("CONNECTION_CREATE", saved.getName(), "OK",
                saved.getUsername() + "@" + saved.getHost() + ":" + saved.getPort());
        return R.ok(saved);
    }

    @PutMapping("/{id}")
    public R<SshConnection> update(@PathVariable Long id, @RequestBody ConnectionForm form) {
        SshConnection saved = service.update(id, form);
        audit.record("CONNECTION_UPDATE", saved.getName(), "OK",
                saved.getUsername() + "@" + saved.getHost() + ":" + saved.getPort());
        return R.ok(saved);
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        String name = "";
        try {
            name = service.get(id).getName();
        } catch (Exception ignore) {
            // 连接已不存在时仍继续删除
        }
        service.delete(id);
        audit.record("CONNECTION_DELETE", name, "OK", "id=" + id);
        return R.ok();
    }

    /** 快捷设置置顶 / 收藏 */
    @PostMapping("/{id}/flags")
    public R<SshConnection> flags(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        Boolean fav = body.containsKey("favorite") ? Boolean.parseBoolean(String.valueOf(body.get("favorite"))) : null;
        Boolean pin = body.containsKey("pinned") ? Boolean.parseBoolean(String.valueOf(body.get("pinned"))) : null;
        return R.ok(service.updateFlags(id, fav, pin));
    }

    /** 记录「最近打开」时间 */
    @PostMapping("/{id}/touch")
    public R<SshConnection> touch(@PathVariable Long id) {
        return R.ok(service.touch(id));
    }

    /** 移动到指定文件夹（folderId 为 null 表示移到根目录） */
    @PostMapping("/{id}/move")
    public R<SshConnection> move(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        Object v = body.get("folderId");
        Long folderId = v == null ? null : ((Number) v).longValue();
        return R.ok(service.move(id, folderId));
    }

    /** 导出连接（含加密密码）；ids 可选（逗号分隔），缺省导出全部 */
    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@RequestParam(value = "ids", required = false) String ids) throws Exception {
        List<Long> idList = null;
        if (ids != null && !ids.trim().isEmpty()) {
            idList = new java.util.ArrayList<>();
            for (String s : ids.split(",")) {
                try {
                    idList.add(Long.parseLong(s.trim()));
                } catch (NumberFormatException ignore) {
                    // 忽略非法 id
                }
            }
        }
        byte[] body = transferService.exportJson(idList).getBytes(StandardCharsets.UTF_8);
        String fileName = "deepshell_connections_"
                + new SimpleDateFormat("yyyyMMddHHmmss").format(new Date()) + ".json";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setContentDispositionFormData("attachment", fileName);
        audit.record("CONNECTION_EXPORT", fileName, "OK",
                idList == null ? "全部连接" : (idList.size() + " 条"));
        return new ResponseEntity<>(body, headers, org.springframework.http.HttpStatus.OK);
    }

    /** 导入连接（兼容 FinalShell 连接文件：数组、单对象、加密码或明文），支持一次多个文件 */
    @PostMapping("/import")
    public R<Map<String, Object>> importConns(@RequestParam("file") MultipartFile[] files) throws Exception {
        int total = 0;
        int imported = 0;
        int noPwd = 0;
        int skipped = 0;
        int failed = 0;
        int fileFail = 0;
        for (MultipartFile f : files) {
            try {
                Map<String, Object> r = transferService.importJson(f.getBytes());
                total += num(r.get("total"));
                imported += num(r.get("imported"));
                noPwd += num(r.get("noPassword"));
                skipped += num(r.get("skipped"));
                failed += num(r.get("failed"));
            } catch (Exception e) {
                fileFail++;
            }
        }
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("total", total);
        m.put("imported", imported);
        m.put("skipped", skipped);
        m.put("failed", failed);
        m.put("noPassword", noPwd);
        m.put("fileFail", fileFail);
        StringBuilder msg = new StringBuilder();
        if (files.length > 1) {
            msg.append("共 ").append(files.length).append(" 个文件，");
        }
        msg.append("导入完成：成功 ").append(imported).append(" 条");
        if (noPwd > 0) {
            msg.append("，无密码 ").append(noPwd).append(" 条（导入后请编辑补全）");
        }
        if (skipped > 0) {
            msg.append("，跳过无效 ").append(skipped).append(" 条");
        }
        if (failed > 0) {
            msg.append("，失败 ").append(failed).append(" 条");
        }
        if (fileFail > 0) {
            msg.append("，无法解析的文件 ").append(fileFail).append(" 个");
        }
        m.put("message", msg.toString());
        audit.record("CONNECTION_IMPORT", files.length + " 个文件", imported > 0 ? "OK" : "FAIL",
                "成功 " + imported + " 条，失败 " + failed + " 条，跳过 " + skipped + " 条");
        return R.ok(m);
    }

    private static int num(Object o) {
        return o instanceof Number ? ((Number) o).intValue() : 0;
    }
}
