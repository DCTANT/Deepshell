package com.itdct.deepshell.entity;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.time.LocalDateTime;

/** AI 桌面图标布局：按连接隔离，保存图标顺序与内置图标隐藏状态 */
@Getter
@Setter
@Entity
@Table(name = "desktop_icon_layout",
        uniqueConstraints = @UniqueConstraint(columnNames = {"connection_id", "icon_key"}))
public class DesktopIconLayout {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "connection_id", nullable = false)
    private Long connectionId;

    /** app:explorer / app:settings / app:ai / file:/absolute/path */
    @Column(name = "icon_key", nullable = false, length = 500)
    private String iconKey;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder;

    @Column(nullable = false)
    private Boolean hidden;

    private LocalDateTime updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = LocalDateTime.now();
    }
}
