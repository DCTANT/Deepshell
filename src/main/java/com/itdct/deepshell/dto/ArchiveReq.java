package com.itdct.deepshell.dto;

import java.util.List;

/**
 * 远程压缩请求（可视化桌面右键「压缩」）
 */
public class ArchiveReq {

    private String sessionId;
    private String destDir;
    private List<String> paths;
    private String name;
    /** zip / tar / tar.gz / tar.bz2 / tar.xz / 7z */
    private String format;
    /** store / fastest / normal / max */
    private String level;
    private boolean overwrite;

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public String getDestDir() {
        return destDir;
    }

    public void setDestDir(String destDir) {
        this.destDir = destDir;
    }

    public List<String> getPaths() {
        return paths;
    }

    public void setPaths(List<String> paths) {
        this.paths = paths;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getFormat() {
        return format;
    }

    public void setFormat(String format) {
        this.format = format;
    }

    public String getLevel() {
        return level;
    }

    public void setLevel(String level) {
        this.level = level;
    }

    public boolean isOverwrite() {
        return overwrite;
    }

    public void setOverwrite(boolean overwrite) {
        this.overwrite = overwrite;
    }
}
