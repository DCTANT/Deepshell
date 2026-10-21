package com.itdct.deepshell.dto;

import lombok.Data;

@Data
public class TrashItem {

    private String id;
    private String name;
    private String originalPath;
    private String storedPath;
    private long deletedAt;
    private boolean dir;
    private long size;
}
