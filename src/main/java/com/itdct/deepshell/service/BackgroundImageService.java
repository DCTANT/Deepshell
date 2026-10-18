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

    /** AI 桌面背景按连接分目录存放；connId 为空时使用旧的全局目录 */
    private Path desktopDir(Long connId) {
        Path base = dir("desktop");
        return connId == null ? base : base.resolve(String.valueOf(connId));
    }

    private String url(String scope, Long connId) {
        if ("terminal".equals(scope)) {
            return "/api/terminal-bg/img";
        }
        return connId == null ? "/api/desktop-bg/img" : "/api/desktop-bg/img?connId=" + connId;
    }

    public String upload(String scope, Long connId, MultipartFile file) throws Exception {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("文件为空");
        }
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : "";
        if (!ALLOWED.contains(ext)) {
            throw new IllegalArgumentException("仅支持图片格式: " + ALLOWED);
        }
        Path d = "desktop".equals(scope) ? desktopDir(connId) : dir(scope);
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
        return url(scope, connId);
    }

    public ResponseEntity<byte[]> image(String scope, Long connId) throws Exception {
        Path d = "desktop".equals(scope) ? desktopDir(connId) : dir(scope);
        Path f = findImage(d);
        if (f == null && "desktop".equals(scope) && connId != null) {
            // 该连接还没有独立背景时沿用旧的全局背景
            f = findImage(dir("desktop"));
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

    private Path findImage(Path d) throws Exception {
        if (!Files.isDirectory(d)) {
            return null;
        }
        try (Stream<Path> s = Files.list(d)) {
            return s.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().startsWith("bg."))
                    .findFirst().orElse(null);
        }
    }
}
