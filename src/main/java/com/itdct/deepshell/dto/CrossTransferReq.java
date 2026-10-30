package com.itdct.deepshell.dto;

import lombok.Data;

import java.util.List;

@Data
public class CrossTransferReq {
    private String sessionId;
    private List<String> paths;
    private List<Long> connectionIds;
    private String targetPath;
    /** 同名文件策略：overwrite / skip / rename */
    private String conflict;
}
