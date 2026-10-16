package com.itdct.deepshell.dto;

import lombok.Data;

/**
 * 服务器监控快照（CPU/内存/网络），首轮采样或数据源不可用的指标为 null
 */
@Data
public class StatsSnapshot {

    /** CPU 使用率（%），首轮或不可用时为 null；Android/Termux 上为 cpufreq 频率估算值 */
    private Integer cpu;
    /** 内存使用率（%） */
    private Integer memPct;
    private Long memUsedMb;
    private Long memTotalMb;
    /** 交换分区使用率（%），未启用为 0 */
    private Integer swapPct;
    private Long swapUsedMb;
    private Long swapTotalMb;
    /** 网络下行速率（字节/秒），首轮或不可用（如 Android）为 null */
    private Long rxRate;
    /** 网络上行速率（字节/秒），首轮或不可用（如 Android）为 null */
    private Long txRate;
    private String load1;
    private Long uptimeSecs;
    private String host;
    /** 非 null 表示监控不可用（如 Windows 服务器） */
    private String error;

    public static StatsSnapshot ofError(String message) {
        StatsSnapshot s = new StatsSnapshot();
        s.setError(message);
        return s;
    }
}
