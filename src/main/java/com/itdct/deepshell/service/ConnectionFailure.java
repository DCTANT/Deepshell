package com.itdct.deepshell.service;

import java.util.Map;

/** 带排查建议的 SSH 连接失败；测试连接与终端 WebSocket 共用同一份诊断信息。 */
public class ConnectionFailure extends RuntimeException {

    private final Map<String, Object> diagnosis;

    public ConnectionFailure(Map<String, Object> diagnosis) {
        super(diagnosis == null ? "连接失败" : String.valueOf(diagnosis.get("title")));
        this.diagnosis = diagnosis;
    }

    public Map<String, Object> getDiagnosis() {
        return diagnosis;
    }
}
