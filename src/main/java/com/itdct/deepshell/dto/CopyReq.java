package com.itdct.deepshell.dto;

import lombok.Data;

import java.util.List;

/** 远程文件/文件夹复制请求（资源管理器右键复制/粘贴） */
@Data
public class CopyReq {

    private String sessionId;
    private String destDir;
    private List<String> paths;
}
