package com.itdct.deepshell.entity;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.time.LocalDateTime;

/** 已确认信任的 SSH 主机密钥（按 host + port + 密钥类型区分） */
@Getter
@Setter
@Entity
@Table(name = "known_host",
        uniqueConstraints = @UniqueConstraint(name = "uk_known_host", columnNames = {"host", "port", "key_type"}))
public class KnownHost {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 255)
    private String host;

    @Column(nullable = false)
    private Integer port = 22;

    @Column(name = "key_type", nullable = false, length = 40)
    private String keyType;

    @Column(name = "key_base64", nullable = false, length = 8000)
    private String keyBase64;

    @Column(length = 200)
    private String fingerprint;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        createdAt = updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
