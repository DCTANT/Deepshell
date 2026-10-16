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
