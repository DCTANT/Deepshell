package com.itdct.deepshell.entity;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;

/**
 * AI 终端对话：按连接归属；消息数组以 JSON 文本整体读写（会话内消息只整体增改，无按条查询需求）
 */
@Getter
@Setter
@Entity
@Table(name = "ai_conversation")
public class AiConversation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long connectionId;

    @Column(length = 120)
    private String title;

    /** AI 跟踪的工作目录，下一条命令在此目录执行 */
    @Column(length = 500)
    private String cwd;

    /** 该连接下当前选中的对话（每个连接最多一个 true） */
    private Boolean active = false;

    /** 消息数组 JSON 文本 */
    @Column(columnDefinition = "TEXT")
    private String msgsJson;

    /** epoch millis */
    private Long createdAt;

    private Long updatedAt;
}
