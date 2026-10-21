package com.itdct.deepshell.dto;

import lombok.Data;

import java.util.List;

@Data
public class TrashReq {
    private String sessionId;
    private String id;
    private List<String> ids;
}
