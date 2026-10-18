package com.itdct.deepshell.service;

import com.itdct.deepshell.common.DataDir;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;

/** 背景图片存储：终端使用数据目录 bg/（兼容旧文件），AI 桌面使用 bg/desktop/ */
@Service
public class BackgroundImageService {

    private static final List<String> ALLOWED = Arrays.asList("png", "jpg", "jpeg", "gif", "webp", "bmp");

    private Path dir(String scope) {
        Path base = DataDir.root().resolve("bg");
        if ("terminal".equals(scope)) {
            return base;
        }
        if ("desktop".equals(scope)) {
            return base.resolve("desktop");
        }
        throw new IllegalArgumentException("未知背景类型");
    }

    private String url(String scope) {
        return "terminal".equals(scope) ? "/api/terminal-bg/img" : "/api/desktop-bg/img";
    }

    public String upload(String scope, MultipartFile file) throws Exception {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("文件为空");
        }
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : "";
        if (!ALLOWED.contains(ext)) {
            throw new IllegalArgumentException("仅支持图片格式: " + ALLOWED);
        }
        Path d = dir(scope);
        Files.createDirectories(d);
        try (Stream<Path> s = Files.list(d)) {
            s.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().startsWith("bg."))
                    .forEach(p -> {
                        try {
                            Files.deleteIfExists(p);
                        } catch (Exception ignore) {
                        }
                    });
        }
        Files.copy(file.getInputStream(), d.resolve("bg." + ext), StandardCopyOption.REPLACE_EXISTING);
        return url(scope);
    }

    public ResponseEntity<byte[]> image(String scope) throws Exception {
        Path d = dir(scope);
        if (!Files.isDirectory(d)) {
            return ResponseEntity.notFound().build();
        }
        Path f;
        try (Stream<Path> s = Files.list(d)) {
            f = s.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().startsWith("bg."))
                    .findFirst().orElse(null);
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
