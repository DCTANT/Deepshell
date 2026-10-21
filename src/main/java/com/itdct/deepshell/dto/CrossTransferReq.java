package com.itdct.deepshell.dto;

import lombok.Data;

import java.util.List;

@Data
public class CrossTransferReq {
    private String sessionId;
    private List<String> paths;
    private List<Long> connectionIds;
    private String targetPath;
}
