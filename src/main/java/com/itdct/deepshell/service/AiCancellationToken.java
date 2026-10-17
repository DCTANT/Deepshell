package com.itdct.deepshell.service;

import java.net.HttpURLConnection;

/**
 * AI 请求取消令牌：前端点「停止」或 SSE 连接断开时置位，
 * 同时断开正在读取的模型 HTTP 连接，避免后台继续生成。
 */
public class AiCancellationToken {

    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;

    public boolean isCancelled() {
        return cancelled;
    }

    public void cancel() {
        cancelled = true;
        HttpURLConnection conn = connection;
        if (conn != null) {
            try {
                conn.disconnect();
            } catch (Exception ignore) {
                // 连接可能已被关闭
            }
        }
    }

    void bind(HttpURLConnection conn) {
        this.connection = conn;
        if (cancelled) {
            try {
                conn.disconnect();
            } catch (Exception ignore) {
                // 已取消时立即断开
            }
        }
    }

    void clear() {
        this.connection = null;
    }

    /** 取消时抛出的受控异常，用于从模型读取/命令执行中快速退出 */
    public static class CancelledException extends RuntimeException {
        public CancelledException() {
            super("AI 请求已停止");
        }
    }
}
