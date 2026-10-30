package com.itdct.deepshell.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@Table(name = "ssh_connection")
public class SshConnection {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 100)
    private String groupName;

    @Column(nullable = false, length = 255)
    private String host;

    @Column(nullable = false)
    private Integer port = 22;

    @Column(length = 100)
    private String username;

    /** PASSWORD / KEY */
    @Column(length = 20, nullable = false)
    private String authType = "PASSWORD";

    @JsonIgnore
    @Column(length = 2000)
    private String passwordEnc;

    @Column(length = 500)
    private String keyPath;

    @JsonIgnore
    @Column(length = 2000)
    private String passphraseEnc;

    @Column(length = 500)
    private String remark;

    /** 出口代理：NONE / HTTP / SOCKS5；仅作用于链路最外层连接 */
    @Column(length = 20)
    private String proxyType = "NONE";

    @Column(length = 255)
    private String proxyHost;

    private Integer proxyPort;

    @Column(length = 100)
    private String proxyUsername;

    @JsonIgnore
    @Column(length = 2000)
    private String proxyPasswordEnc;

    /** 通过哪个已保存连接作为跳板机（可递归成链） */
    private Long jumpConnectionId;

    /** 经哪个执行网关转发（null 表示直连）；网关只做 TCP 隧道，目标凭据仍保存在本机 */
    private Long gatewayId;

    /** 持久会话：可用时自动以 tmux 新建/附着，程序重启后仍可恢复 */
    private Boolean persistSession = Boolean.TRUE;

    /** 所属文件夹，null 表示根目录 */
    private Long folderId;

    /** 收藏 */
    private Boolean favorite = false;

    /** 置顶 */
    private Boolean pinned = false;

    /** 最近一次打开时间（epoch millis），用于「最近连接」排序 */
    private Long lastUsedAt;

    private Integer sortOrder = 0;

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
