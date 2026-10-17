package com.itdct.deepshell.entity;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.time.LocalDateTime;

/** 审计日志：登录、AI 命令、文件操作、连接与设置变更 */
@Getter
@Setter
@Entity
@Table(name = "audit_log")
public class AuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(length = 100)
    private String username;

    @Column(length = 64)
    private String clientIp;

    @Column(nullable = false, length = 40)
    private String action;

    @Column(length = 1000)
    private String target;

    @Column(length = 2000)
    private String detail;

    @Column(length = 16)
    private String result;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
