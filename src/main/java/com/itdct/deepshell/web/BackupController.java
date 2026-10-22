package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.BackupService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.InputStream;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;

/** 系统备份 / 还原：导出配置 ZIP，导入后整体覆盖当前配置。 */
@RestController
@RequestMapping("/api/backup")
public class BackupController {

    private final BackupService service;

    public BackupController(BackupService service) {
        this.service = service;
    }

    @PostMapping("/export")
    public ResponseEntity<StreamingResponseBody> export(@RequestBody(required = false) Map<String, Object> body)
            throws Exception {
        Map<String, Object> browser = null;
        if (body != null) {
            Object value = body.get("browser");
            if (value != null) {
                if (!(value instanceof Map)) {
                    throw new IllegalArgumentException("浏览器设置格式不正确");
                }
                @SuppressWarnings("unchecked")
                Map<String, Object> map = (Map<String, Object>) value;
                browser = map;
            }
        }
        BackupService.BackupExport export = service.createExport(browser);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("application/zip"));
        headers.setContentDisposition(ContentDisposition.builder("attachment")
                .filename(export.getFileName()).build());
        headers.setContentLength(export.getSize());
        headers.setCacheControl("no-store");
        if (!export.getWarnings().isEmpty()) {
            List<String> warnings = export.getWarnings().size() > 10
                    ? export.getWarnings().subList(0, 10) : export.getWarnings();
            String joined = String.join("\n", warnings);
            headers.set("X-Backup-Warnings", java.util.Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(joined.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
        StreamingResponseBody stream = outputStream -> {
            try (InputStream in = Files.newInputStream(export.getFile())) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) >= 0) {
                    outputStream.write(buffer, 0, read);
                }
                outputStream.flush();
            } finally {
                Files.deleteIfExists(export.getFile());
            }
        };
        return new ResponseEntity<>(stream, headers, HttpStatus.OK);
    }

    @PostMapping("/import")
    public R<Map<String, Object>> importBackup(@RequestParam("file") MultipartFile file) throws Exception {
        return R.ok(service.importBackup(file));
    }
}
