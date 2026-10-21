package com.itdct.deepshell.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class TrashDeleteResult {
    private String path;
    private boolean ok;
    private String error;
}
