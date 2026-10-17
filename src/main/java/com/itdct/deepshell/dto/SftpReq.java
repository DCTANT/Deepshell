package com.itdct.deepshell.dto;

import lombok.Data;

@Data
public class SftpReq {

    private String sessionId;
    private String path;
    private String newName;
    private String content;
    /** 移动目标目录（拖拽移动） */
    private String destDir;
    /** 权限模式（八进制，如 644 / 755） */
    private Integer mode;
}
