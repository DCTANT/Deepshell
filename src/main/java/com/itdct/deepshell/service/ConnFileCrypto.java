package com.itdct.deepshell.service;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

/**
 * FinalShell 连接文件的密码兼容加解密（导入其配置文件 / 兼容导出所需）：
 * 密文 = 8 字节随机头 + DES 密文；DES 密钥由头部字节经 java.util.Random 模拟派生，取 MD5 前 8 字节。
 */
public final class ConnFileCrypto {

    private ConnFileCrypto() {
    }

    private static final long MULT = 0x5DEECE66DL;
    private static final long ADD = 0xBL;
    private static final long MASK = (1L << 48) - 1;

    private static final class JR {
        long seed;

        JR(long s) {
            seed = (s ^ MULT) & MASK;
        }

        int next(int bits) {
            seed = (seed * MULT + ADD) & MASK;
            return (int) (seed >>> (48 - bits));
        }

        long nextLong() {
            return ((long) next(32) << 32) + next(32);
        }

        int nextInt(int bound) {
            int r = next(31);
            int m = bound - 1;
            if ((bound & m) == 0) {
                r = (int) ((bound * (long) r) >> 31);
            } else {
                int u = r;
                r = u % bound;
                while (u - r + m < 0) {
                    u = next(31);
                    r = u % bound;
                }
            }
            return r;
        }
    }

    private static byte[] randomKey(byte[] head) throws Exception {
        long divisor = new JR(head[5]).nextInt(127);
        if (divisor == 0) {
            divisor = 1;
        }
        long ks = 3680984568597093857L / divisor;
        JR random = new JR(ks);
        int t = head[0];
        for (int i = 0; i < t; i++) {
            random.nextLong();
        }
        long n = random.nextLong();
        JR r2 = new JR(n);
        long[] ld = {head[4], r2.nextLong(), head[7], head[3], r2.nextLong(), head[1], random.nextLong(), head[2]};
        ByteBuffer buf = ByteBuffer.allocate(64);
        for (long l : ld) {
            buf.putLong(l);
        }
        byte[] md5 = MessageDigest.getInstance("MD5").digest(buf.array());
        return Arrays.copyOf(md5, 8);
    }

    public static String decode(String base64Cipher) throws Exception {
        byte[] all = Base64.getDecoder().decode(base64Cipher);
        if (all.length < 16) {
            throw new IllegalArgumentException("密文长度不合法");
        }
        byte[] head = Arrays.copyOfRange(all, 0, 8);
        byte[] data = Arrays.copyOfRange(all, 8, all.length);
        Cipher cipher = Cipher.getInstance("DES/ECB/PKCS5Padding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(randomKey(head), "DES"));
        return new String(cipher.doFinal(data), StandardCharsets.UTF_8);
    }

    public static String encode(String plain) throws Exception {
        byte[] head = new byte[8];
        SecureRandom rnd = new SecureRandom();
        for (int i = 0; i < 8; i++) {
            head[i] = (byte) rnd.nextInt(127);
        }
        Cipher cipher = Cipher.getInstance("DES/ECB/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(randomKey(head), "DES"));
        byte[] ct = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] out = new byte[8 + ct.length];
        System.arraycopy(head, 0, out, 0, 8);
        System.arraycopy(ct, 0, out, 8, ct.length);
        return Base64.getEncoder().encodeToString(out);
    }
}
