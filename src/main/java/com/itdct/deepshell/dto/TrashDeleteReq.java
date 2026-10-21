package com.itdct.deepshell.dto;

import lombok.Data;

import java.util.List;

@Data
public class TrashDeleteReq {

    private String sessionId;
    private List<Item> items;

    @Data
    public static class Item {
        private String path;
        private String name;
        private boolean dir;
        private long size;
    }
}
