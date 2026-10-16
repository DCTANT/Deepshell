package com.itdct.deepshell.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class SftpEntry {

    private String name;
    private boolean dir;
    private boolean link;
    private long size;
    private long mtime;
    private String perms;
}
