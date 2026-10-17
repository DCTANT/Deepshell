package com.itdct.deepshell.common;

import org.w3c.dom.NodeList;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.metadata.IIOMetadata;
import javax.imageio.metadata.IIOMetadataNode;
import javax.imageio.plugins.jpeg.JPEGImageWriteParam;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Iterator;
import java.util.Locale;

/**
 * 服务端图片缩略图：解码远端原图并缩放到指定尺寸后输出。
 * 大图标视图用它替代“浏览器直接拉原图”，避免超高分辨率照片把页面主线程和 SFTP 通道拖死。
 */
public final class ImageThumbnails {

    /** 非 JPEG 格式全量解码前的像素上限，防止超大 PNG 等把服务端内存打爆 */
    private static final long MAX_FULL_DECODE_PIXELS = 20_000_000L;
    /** JPEG 降采样倍数上限（108MP 手机照片也能压到可接受尺寸） */
    private static final int MAX_SOURCE_STEP = 16;
    private static final float JPEG_QUALITY = 0.82f;

    private ImageThumbnails() {
    }

    public static Thumb create(byte[] source, int maxSize) throws IOException {
        if (source == null || source.length == 0) {
            throw new IOException("图片内容为空");
        }
        int target = Math.max(32, Math.min(512, maxSize));
        BufferedImage image;
        byte[] exif;
        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(source))) {
            if (iis == null) {
                throw new IOException("无法读取图片");
            }
            Iterator<ImageReader> readers = ImageIO.getImageReaders(iis);
            if (!readers.hasNext()) {
                throw new UnsupportedOperationException("不支持的图片格式");
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(iis, true, false);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width <= 0 || height <= 0) {
                    throw new IOException("图片尺寸无效");
                }
                String format = reader.getFormatName() == null
                        ? "" : reader.getFormatName().toLowerCase(Locale.ROOT);
                boolean jpeg = "jpeg".equals(format) || "jpg".equals(format);
                if (!jpeg && (long) width * height > MAX_FULL_DECODE_PIXELS) {
                    throw new IOException("图片像素过大");
                }
                ImageReadParam param = reader.getDefaultReadParam();
                if (jpeg) {
                    // JPEG 支持按整数倍降采样解码，大幅降低服务端解码耗时与内存占用
                    int maxDim = Math.max(width, height);
                    if (maxDim > target * 2) {
                        int step = Math.min(MAX_SOURCE_STEP, maxDim / (target * 2));
                        if (step > 1) {
                            param.setSourceSubsampling(step, step, 0, 0);
                        }
                    }
                }
                // 元数据要在读取像素前取，降采样读取后部分 reader 不再提供 marker 信息
                IIOMetadata metadata = null;
                if (jpeg) {
                    try {
                        metadata = reader.getImageMetadata(0);
                    } catch (Exception ignore) {
                        // 元数据读取失败不影响缩略图生成
                    }
                }
                image = reader.read(0, param);
                exif = jpeg ? exifSegment(metadata) : null;
            } finally {
                reader.dispose();
            }
        }
        if (image == null) {
            throw new IOException("图片解码失败");
        }

        boolean alpha = image.getColorModel() != null && image.getColorModel().hasAlpha();
        BufferedImage scaled = scale(image, target, alpha);
        if (alpha) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (!ImageIO.write(scaled, "png", out)) {
                throw new IOException("PNG 编码失败");
            }
            return new Thumb(out.toByteArray(), "image/png");
        }
        byte[] jpeg = writeJpeg(scaled);
        if (exif != null) {
            // 保留 EXIF（含拍摄方向），浏览器渲染缩略图时会自动旋转
            jpeg = insertExif(jpeg, exif);
        }
        return new Thumb(jpeg, "image/jpeg");
    }

    private static BufferedImage scale(BufferedImage source, int target, boolean alpha) {
        int width = source.getWidth();
        int height = source.getHeight();
        double ratio = Math.min(1.0, Math.min((double) target / width, (double) target / height));
        int outWidth = Math.max(1, (int) Math.round(width * ratio));
        int outHeight = Math.max(1, (int) Math.round(height * ratio));
        BufferedImage out = new BufferedImage(outWidth, outHeight,
                alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                    RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.drawImage(source, 0, 0, outWidth, outHeight, null);
        } finally {
            g.dispose();
        }
        return out;
    }

    private static byte[] writeJpeg(BufferedImage image) throws IOException {
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("jpeg");
        if (!writers.hasNext()) {
            throw new IOException("JPEG 编码器不可用");
        }
        ImageWriter writer = writers.next();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageOutputStream ios = null;
        try {
            ios = ImageIO.createImageOutputStream(out);
            writer.setOutput(ios);
            JPEGImageWriteParam param = new JPEGImageWriteParam(Locale.ROOT);
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(JPEG_QUALITY);
            writer.write(null, new IIOImage(image, null, null), param);
            ios.flush();
            return out.toByteArray();
        } finally {
            writer.dispose();
            if (ios != null) {
                try {
                    ios.close();
                } catch (IOException ignore) {
                    // ignore
                }
            }
        }
    }

    /** 取原 JPEG 的 EXIF APP1 段，没有则返回 null */
    private static byte[] exifSegment(IIOMetadata metadata) {
        if (metadata == null) {
            return null;
        }
        try {
            IIOMetadataNode root = (IIOMetadataNode) metadata.getAsTree("javax_imageio_jpeg_image_1.0");
            // JDK 的 JPEG 元数据把未解析的 APP1 放在 <unknown MarkerTag="225"> 节点下
            NodeList markers = root.getElementsByTagName("unknown");
            if (markers.getLength() == 0) {
                markers = root.getElementsByTagName("marker");
            }
            for (int i = 0; i < markers.getLength(); i++) {
                IIOMetadataNode marker = (IIOMetadataNode) markers.item(i);
                String tag = marker.getAttribute("MarkerTag");
                if (tag == null || tag.isEmpty()) {
                    tag = marker.getAttribute("markerTag");
                }
                if (!"225".equals(tag) && !"0xE1".equalsIgnoreCase(tag)) {
                    continue;
                }
                Object userObject = marker.getUserObject();
                if (!(userObject instanceof byte[])) {
                    continue;
                }
                byte[] payload = (byte[]) userObject;
                if (payload.length < 6 || payload[0] != 'E' || payload[1] != 'x'
                        || payload[2] != 'i' || payload[3] != 'f') {
                    continue;
                }
                int len = payload.length + 2;
                if (len > 0xFFFF) {
                    return null;
                }
                byte[] segment = new byte[payload.length + 4];
                segment[0] = (byte) 0xFF;
                segment[1] = (byte) 0xE1;
                segment[2] = (byte) (len >>> 8);
                segment[3] = (byte) len;
                System.arraycopy(payload, 0, segment, 4, payload.length);
                return segment;
            }
        } catch (Exception ignore) {
            // EXIF 只影响显示方向，解析失败时直接输出无 EXIF 的缩略图
        }
        return null;
    }

    private static byte[] insertExif(byte[] jpeg, byte[] exif) {
        if (jpeg.length < 2) {
            return jpeg;
        }
        int at = 2;
        // ImageIO 输出通常以 APP0/JFIF 开头，把 EXIF 插到 APP0 之后更规范
        if (jpeg.length >= 6 && (jpeg[2] & 0xFF) == 0xFF && (jpeg[3] & 0xFF) == 0xE0) {
            int len = ((jpeg[4] & 0xFF) << 8) | (jpeg[5] & 0xFF);
            int next = 2 + 2 + len;
            if (next > 2 && next < jpeg.length) {
                at = next;
            }
        }
        byte[] out = new byte[jpeg.length + exif.length];
        System.arraycopy(jpeg, 0, out, 0, at);
        System.arraycopy(exif, 0, out, at, exif.length);
        System.arraycopy(jpeg, at, out, at + exif.length, jpeg.length - at);
        return out;
    }

    public static final class Thumb {

        private final byte[] data;
        private final String contentType;

        public Thumb(byte[] data, String contentType) {
            this.data = data;
            this.contentType = contentType;
        }

        public byte[] getData() {
            return data;
        }

        public String getContentType() {
            return contentType;
        }
    }
}
