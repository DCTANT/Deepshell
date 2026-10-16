package com.itdct.deepshell.dto;

import lombok.Data;

/**
 * 服务器进程信息（PS 快照 + 差分瞬时 CPU）
 */
@Data
public class ProcessEntry {

    private long pid;
    private long ppid;
    private String user;
    /** 瞬时 CPU 占用（% 整机，来自两次 /proc 快照差分；首轮为 null） */
    private Double cpu;
    /** ps 自带 CPU（进程生命周期平均值，%） */
    private Double cpuAvg;
    /** 物理内存占比（%） */
    private Double memPct;
    /** 常驻内存（MB） */
    private long rssMb;
    /** 状态码：R/S/D/Z/T/I...（进程名） */
    private String state;
    /** 已运行秒数（ps aux 回退时不可知，为 -1） */
    private long elapsedSecs;
    /** 进程名 */
    private String comm;
    /** 完整命令行 */
    private String args;
}
