package com.itdct.deepshell.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.time.LocalDateTime;

/**
 * 执行网关：本地 DeepShell 通过它把 SSH 字节流透传到目标机。
 * Token 加密存储，接口返回时只给「是否已配置」。
 */
@Getter
@Setter
@Entity
@Table(name = "gateway_endpoint")
public class GatewayEndpoint {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    /** 例如 https://192.168.0.20:17777 */
    @Column(nullable = false, length = 500)
    private String baseUrl;

    @JsonIgnore
    @Column(length = 2000)
    private String tokenEnc;

    /** 网关使用自签证书时跳过校验（仅 HTTPS 需要） */
    private Boolean insecureTls = Boolean.FALSE;

    private Boolean enabled = Boolean.TRUE;

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
