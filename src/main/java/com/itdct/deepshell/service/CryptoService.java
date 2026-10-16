package com.itdct.deepshell.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * 连接密码的本地加密存储：AES/GCM，密钥首启自动生成于 ~/.deepshell/secret.key
 */
@Slf4j
@Service
public class CryptoService {

    private static final int IV_LEN = 12;
    private static final int TAG_BITS = 128;

    private final SecretKeySpec key;

    public CryptoService() throws Exception {
        Path dir = Paths.get(System.getProperty("user.home"), ".deepshell");
        Files.createDirectories(dir);
        Path keyFile = dir.resolve("secret.key");
        byte[] keyBytes;
        if (Files.exists(keyFile)) {
            keyBytes = Base64.getDecoder().decode(new String(Files.readAllBytes(keyFile), StandardCharsets.UTF_8).trim());
        } else {
            keyBytes = new byte[32];
            new SecureRandom().nextBytes(keyBytes);
            Files.write(keyFile, Base64.getEncoder().encodeToString(keyBytes).getBytes(StandardCharsets.UTF_8));
            log.info("已生成本地加密密钥: {}", keyFile);
        }
        this.key = new SecretKeySpec(keyBytes, "AES");
    }

    public String encrypt(String plain) {
        if (plain == null || plain.isEmpty()) {
            return null;
        }
        try {
            byte[] iv = new byte[IV_LEN];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return Base64.getEncoder().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("加密失败: " + e.getMessage(), e);
        }
    }

    public String decrypt(String enc) {
        if (enc == null || enc.isEmpty()) {
            return null;
        }
        try {
            byte[] all = Base64.getDecoder().decode(enc);
            byte[] iv = new byte[IV_LEN];
            System.arraycopy(all, 0, iv, 0, IV_LEN);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] plain = cipher.doFinal(all, IV_LEN, all.length - IV_LEN);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.warn("解密失败（密钥文件可能已变更）: {}", e.getMessage());
            return null;
        }
    }
}
