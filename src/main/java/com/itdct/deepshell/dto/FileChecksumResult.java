package com.itdct.deepshell.dto;

/**
 * 文件校验和结果。
 */
public class FileChecksumResult {

    private String path;
    private String algorithm;
    private String value;

    public FileChecksumResult() {
    }

    public FileChecksumResult(String path, String algorithm, String value) {
        this.path = path;
        this.algorithm = algorithm;
        this.value = value;
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getAlgorithm() {
        return algorithm;
    }

    public void setAlgorithm(String algorithm) {
        this.algorithm = algorithm;
    }

    public String getValue() {
        return value;
    }

    public void setValue(String value) {
        this.value = value;
    }
}
