package com.itdct.deepshell.dto;

import lombok.Data;

import java.util.List;

/** 上传前同名冲突预检请求：远端按 sessionId + dir 校验，本地桌面只用 dir（沙箱内虚拟路径） */
@Data
public class UploadConflictReq {

    private String sessionId;
    private String dir;
    private List<FileItem> files;

    @Data
    public static class FileItem {
        /** 相对目标目录的路径（文件夹上传时可能包含多级目录） */
        private String relativePath;
        /** 原始文件名，relativePath 为空时作为兜底 */
        private String name;
        private long size;
    }
}
