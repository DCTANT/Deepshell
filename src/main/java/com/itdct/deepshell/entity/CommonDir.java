package com.itdct.deepshell.entity;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.time.LocalDateTime;

/** 常用目录（按连接隔离；点击后在终端执行 cd 并联动文件面板） */
@Getter
@Setter
@Entity
@Table(name = "common_dir")
public class CommonDir {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 所属连接；旧版本的全局记录为 null，启动时由迁移器清理 */
    private Long connectionId;

    @Column(nullable = false, length = 500)
    private String path;

    private LocalDateTime createdAt;

    @PrePersist
    void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
