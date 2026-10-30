package com.itdct.deepshell.entity;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;

/** 一次模型调用的 token 用量：用于 AI 设置中的今天 / 近 7 天 / 近 30 天 / 累计统计 */
@Getter
@Setter
@Entity
@Table(name = "ai_token_usage")
public class AiTokenUsage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 本机日期 yyyy-MM-dd，按天聚合查询 */
    @Column(name = "usage_day", nullable = false, length = 10)
    private String day;

    @Column(length = 40)
    private String provider;

    @Column(length = 120)
    private String model;

    @Column(name = "input_tokens", nullable = false)
    private Long inputTokens = 0L;

    @Column(name = "output_tokens", nullable = false)
    private Long outputTokens = 0L;

    @Column(name = "total_tokens", nullable = false)
    private Long totalTokens = 0L;

    /** 厂商未返回 usage，数量由字符数估算 */
    @Column(nullable = false)
    private Boolean estimated = false;

    @Column(name = "created_at", nullable = false)
    private Long createdAt;
}
