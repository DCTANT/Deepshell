package com.itdct.deepshell.dto;

/**
 * 服务器文件搜索结果（开始菜单搜索用）
 */
public class FileSearchEntry {

    private String name;
    private String path;
    private boolean dir;

    public FileSearchEntry() {
    }

    public FileSearchEntry(String name, String path, boolean dir) {
        this.name = name;
        this.path = path;
        this.dir = dir;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public boolean isDir() {
        return dir;
    }

    public void setDir(boolean dir) {
        this.dir = dir;
    }
}
