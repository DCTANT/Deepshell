package com.itdct.deepshell.dto;

/**
 * 文件内容搜索结果：命中的文件路径、行号与该行文本。
 */
public class FileContentMatch {

    private String name;
    private String path;
    private int line;
    private String text;

    public FileContentMatch() {
    }

    public FileContentMatch(String path, int line, String text) {
        this.path = path;
        this.line = line;
        this.text = text;
        int idx = path == null ? -1 : path.lastIndexOf('/');
        this.name = idx >= 0 ? path.substring(idx + 1) : path;
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

    public int getLine() {
        return line;
    }

    public void setLine(int line) {
        this.line = line;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }
}
