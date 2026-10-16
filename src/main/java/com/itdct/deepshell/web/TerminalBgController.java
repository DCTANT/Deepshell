package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;

/**
 * 终端背景图片：上传到 ~/.deepshell/bg（替换旧图），通过 /img 提供访问
 */
@RestController
@RequestMapping("/api/terminal-bg")
public class TerminalBgController {

    private static final List<String> ALLOWED = Arrays.asList("png", "jpg", "jpeg", "gif", "webp", "bmp");

    private Path dir() {
        return Paths.get(System.getProperty("user.home"), ".deepshell", "bg");
    }

    @PostMapping
    public R<String> upload(@RequestParam("file") MultipartFile file) throws Exception {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("文件为空");
        }
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : "";
        if (!ALLOWED.contains(ext)) {
            throw new IllegalArgumentException("仅支持图片格式: " + ALLOWED);
        }
        Path d = dir();
        Files.createDirectories(d);
        try (Stream<Path> s = Files.list(d)) {
            s.forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (Exception ignore) {
                }
            });
        }
        Files.copy(file.getInputStream(), d.resolve("bg." + ext), StandardCopyOption.REPLACE_EXISTING);
        return R.ok("/api/terminal-bg/img");
    }

    @GetMapping("/img")
    public ResponseEntity<byte[]> img() throws Exception {
        Path d = dir();
        if (!Files.isDirectory(d)) {
            return ResponseEntity.notFound().build();
        }
        Path f;
        try (Stream<Path> s = Files.list(d)) {
            f = s.filter(p -> p.getFileName().toString().startsWith("bg.")).findFirst().orElse(null);
        }
        if (f == null) {
            return ResponseEntity.notFound().build();
        }
        byte[] data = Files.readAllBytes(f);
        String fname = f.getFileName().toString();
        String ext = fname.substring(fname.lastIndexOf('.') + 1);
        MediaType mt = MediaType.APPLICATION_OCTET_STREAM;
        if ("png".equals(ext)) {
            mt = MediaType.IMAGE_PNG;
        } else if ("gif".equals(ext)) {
            mt = MediaType.IMAGE_GIF;
        } else if ("jpg".equals(ext) || "jpeg".equals(ext)) {
            mt = MediaType.IMAGE_JPEG;
        } else if ("webp".equals(ext)) {
            mt = MediaType.parseMediaType("image/webp");
        } else if ("bmp".equals(ext)) {
            mt = MediaType.parseMediaType("image/bmp");
        }
        HttpHeaders h = new HttpHeaders();
        h.setContentType(mt);
        h.setCacheControl("no-cache");
        return new ResponseEntity<>(data, h, HttpStatus.OK);
    }
}
