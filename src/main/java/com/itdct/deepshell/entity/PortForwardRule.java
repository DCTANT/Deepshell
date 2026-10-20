package com.itdct.deepshell.entity;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.time.LocalDateTime;

/**
 * 端口转发规则：LOCAL = 本机监听并转发到服务器可达的目标，REMOTE = 服务器监听并转发到本机可达的目标。
 */
@Getter
@Setter
@Entity
@Table(name = "port_forward_rule")
public class PortForwardRule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long connectionId;

    /** LOCAL / REMOTE */
    @Column(nullable = false, length = 10)
    private String direction = "LOCAL";

    @Column(nullable = false, length = 255)
    private String bindHost = "127.0.0.1";

    @Column(nullable = false)
    private Integer bindPort;

    @Column(nullable = false, length = 255)
    private String destHost;

    @Column(nullable = false)
    private Integer destPort;

    @Column(nullable = false)
    private Boolean autoStart = true;

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
