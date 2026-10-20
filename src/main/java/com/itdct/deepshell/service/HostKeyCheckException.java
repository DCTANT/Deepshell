package com.itdct.deepshell.service;

import java.util.Map;

/** 主机密钥未信任或已变更；info 直接返回给前端展示指纹确认框 */
public class HostKeyCheckException extends Exception {

    private final Map<String, Object> info;

    public HostKeyCheckException(Map<String, Object> info) {
        super(info == null ? "主机密钥校验失败" : String.valueOf(info.get("message")));
        this.info = info;
    }

    public Map<String, Object> getInfo() {
        return info;
    }
}
