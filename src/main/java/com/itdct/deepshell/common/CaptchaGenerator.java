package com.itdct.deepshell.common;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.security.SecureRandom;

/**
 * 图形验证码生成器：移植自 OnFlow-framework 的 CaptchaGenerator。
 *
 * <p>随机背景、干扰线/干扰点、扭曲字符；字符池排除 0/O、1/I/l 等易混淆字符。
 * 只依赖 JDK 自带的 AWT/ImageIO，生成 BufferedImage 由上层编码为 Base64。</p>
 */
public final class CaptchaGenerator {

    /** 排除易混淆字符（与 OnFlow CaptchaGenerator 保持一致） */
    public static final String CHAR_POOL =
            "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";

    public static final int WIDTH = 160;
    public static final int HEIGHT = 56;
    public static final int LENGTH = 4;

    private static final SecureRandom RANDOM = new SecureRandom();

    private CaptchaGenerator() {
    }

    public static Generated generate() {
        return generate(WIDTH, HEIGHT, LENGTH);
    }

    public static Generated generate(int width, int height, int length) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

            // 浅色随机背景，保证深色字符对比度
            g.setColor(new Color(rand(200, 255), rand(200, 255), rand(200, 255)));
            g.fillRect(0, 0, width, height);

            for (int i = 0; i < 20; i++) {
                drawRandomLine(g, width, height);
            }
            for (int i = 0; i < 100; i++) {
                drawRandomDot(g, width, height);
            }

            StringBuilder code = new StringBuilder(length);
            for (int i = 0; i < length; i++) {
                char ch = CHAR_POOL.charAt(RANDOM.nextInt(CHAR_POOL.length()));
                code.append(ch);
                drawDistortedChar(g, ch, i, length, width, height);
            }
            return new Generated(code.toString(), image);
        } finally {
            g.dispose();
        }
    }

    private static void drawDistortedChar(Graphics2D g, char ch, int index, int length,
                                          int width, int height) {
        int fontSize = Math.max(18, (int) (height * 0.55f));
        int step = (width - 16) / Math.max(1, length);
        int x = 10 + index * step;
        int y = height / 2 + fontSize / 3;

        g.setFont(new Font("Arial", Font.BOLD | Font.ITALIC, fontSize));
        g.setColor(new Color(rand(0, 120), rand(0, 120), rand(0, 120)));

        // 以字符自身基点为原点做剪切/缩放/旋转，避免旋转把字符甩出画布
        AffineTransform transform = new AffineTransform();
        transform.translate(x, y);
        transform.rotate(-0.2 + RANDOM.nextDouble() * 0.4);
        transform.shear(-0.3 + RANDOM.nextDouble() * 0.6, -0.1 + RANDOM.nextDouble() * 0.2);
        transform.scale(0.8 + RANDOM.nextDouble() * 0.4, 0.85 + RANDOM.nextDouble() * 0.35);
        g.setTransform(transform);
        g.drawString(String.valueOf(ch), 0, 0);
    }

    private static void drawRandomLine(Graphics2D g, int width, int height) {
        int x1 = RANDOM.nextInt(width);
        int y1 = RANDOM.nextInt(height);
        int x2 = RANDOM.nextInt(width);
        int y2 = RANDOM.nextInt(height);

        g.setColor(new Color(rand(0, 255), rand(0, 255), rand(0, 255), rand(50, 220)));
        g.setStroke(new BasicStroke(1f + RANDOM.nextFloat() * 2f));
        g.drawLine(x1, y1, x2, y2);
    }

    private static void drawRandomDot(Graphics2D g, int width, int height) {
        int x = RANDOM.nextInt(width);
        int y = RANDOM.nextInt(height);

        g.setColor(new Color(rand(150, 255), rand(150, 255), rand(150, 255), rand(150, 255)));
        int size = 1 + RANDOM.nextInt(4);
        g.fillRect(x, y, size, size);
    }

    /** 闭区间随机数 */
    private static int rand(int min, int max) {
        return min + RANDOM.nextInt(max - min + 1);
    }

    /** 验证码文本与图片 */
    public static final class Generated {
        public final String code;
        public final BufferedImage image;

        Generated(String code, BufferedImage image) {
            this.code = code;
            this.image = image;
        }
    }
}
