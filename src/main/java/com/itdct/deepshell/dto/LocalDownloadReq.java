package com.itdct.deepshell.dto;

import java.util.List;

/** 下载到本机目录请求（仅本机访问；token 由目录选择接口签发） */
public class LocalDownloadReq {

    private String token;
    private String sessionId;
    private String dir;
    private List<String> paths;

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public String getDir() {
        return dir;
    }

    public void setDir(String dir) {
        this.dir = dir;
    }

    public List<String> getPaths() {
        return paths;
    }

    public void setPaths(List<String> paths) {
        this.paths = paths;
    }
}
