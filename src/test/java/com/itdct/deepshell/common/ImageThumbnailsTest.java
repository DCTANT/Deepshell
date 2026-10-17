package com.itdct.deepshell.common;

import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ImageThumbnailsTest {

    @Test
    void scalesJpegDownPreservingAspectRatio() throws Exception {
        byte[] source = image("jpeg", 1000, 500, false);
        ImageThumbnails.Thumb thumb = ImageThumbnails.create(source, 200);

        assertEquals("image/jpeg", thumb.getContentType());
        BufferedImage out = ImageIO.read(new ByteArrayInputStream(thumb.getData()));
        assertEquals(200, out.getWidth());
        assertEquals(100, out.getHeight());
        assertTrue(thumb.getData().length < source.length, "缩略图应小于原图");
    }

    @Test
    void doesNotUpscaleSmallImages() throws Exception {
        byte[] source = image("jpeg", 120, 80, false);
        ImageThumbnails.Thumb thumb = ImageThumbnails.create(source, 200);

        BufferedImage out = ImageIO.read(new ByteArrayInputStream(thumb.getData()));
        assertEquals(120, out.getWidth());
        assertEquals(80, out.getHeight());
    }

    @Test
    void keepsTransparencyAsPng() throws Exception {
        byte[] source = image("png", 300, 200, true);
        ImageThumbnails.Thumb thumb = ImageThumbnails.create(source, 200);

        assertEquals("image/png", thumb.getContentType());
        BufferedImage out = ImageIO.read(new ByteArrayInputStream(thumb.getData()));
        assertEquals(200, out.getWidth());
        assertEquals(133, out.getHeight());
        assertTrue(out.getColorModel().hasAlpha(), "PNG 缩略图应保留透明通道");
    }

    @Test
    void rejectsUndecodableBytes() {
        byte[] garbage = new byte[128];
        for (int i = 0; i < garbage.length; i++) {
            garbage[i] = (byte) (i * 31);
        }
        assertThrows(UnsupportedOperationException.class, () -> ImageThumbnails.create(garbage, 200));
    }

    @Test
    void preservesExifMetadataForOrientation() throws Exception {
        byte[] source = withExif(image("jpeg", 400, 300, false));
        ImageThumbnails.Thumb thumb = ImageThumbnails.create(source, 200);

        assertTrue(indexOf(thumb.getData(), "Exif".getBytes("ISO-8859-1")) >= 0,
                "缩略图应保留 EXIF，浏览器才能按拍摄方向旋转");
    }

    private static byte[] withExif(byte[] jpeg) {
        byte[] payload = new byte[32];
        int p = 0;
        payload[p++] = 'E'; payload[p++] = 'x'; payload[p++] = 'i'; payload[p++] = 'f';
        payload[p++] = 0; payload[p++] = 0;
        payload[p++] = 'M'; payload[p++] = 'M';
        payload[p++] = 0; payload[p++] = 0x2A;
        payload[p++] = 0; payload[p++] = 0; payload[p++] = 0; payload[p++] = 8;
        payload[p++] = 0; payload[p++] = 1;
        payload[p++] = 0x01; payload[p++] = 0x12; // Orientation
        payload[p++] = 0; payload[p++] = 3;      // SHORT
        payload[p++] = 0; payload[p++] = 0; payload[p++] = 0; payload[p++] = 1;
        payload[p++] = 0; payload[p++] = 6; payload[p++] = 0; payload[p++] = 0; // 顺时针 90°
        payload[p++] = 0; payload[p++] = 0; payload[p++] = 0; payload[p++] = 0;

        int at = 2;
        if (jpeg.length >= 6 && (jpeg[2] & 0xFF) == 0xFF && (jpeg[3] & 0xFF) == 0xE0) {
            int segLen = ((jpeg[4] & 0xFF) << 8) | (jpeg[5] & 0xFF);
            at = 2 + 2 + segLen;
        }
        byte[] out = new byte[jpeg.length + payload.length + 4];
        System.arraycopy(jpeg, 0, out, 0, at);
        out[at] = (byte) 0xFF;
        out[at + 1] = (byte) 0xE1;
        int len = payload.length + 2;
        out[at + 2] = (byte) (len >>> 8);
        out[at + 3] = (byte) len;
        System.arraycopy(payload, 0, out, at + 4, payload.length);
        System.arraycopy(jpeg, at, out, at + payload.length + 4, jpeg.length - at);
        return out;
    }

    private static int indexOf(byte[] data, byte[] needle) {
        outer:
        for (int i = 0; i <= data.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (data[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return i;
        }
        return -1;
    }

    private static byte[] image(String format, int width, int height, boolean alpha) throws IOException {
        BufferedImage img = new BufferedImage(width, height,
                alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        try {
            g.setColor(new Color(200, 80, 40));
            g.fillRect(0, 0, width, height);
        } finally {
            g.dispose();
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, format, out);
        return out.toByteArray();
    }
}
