package com.itdct.deepshell.dto;

import lombok.Data;

/**
 * JumpServer / 运维门户通过 HTTP 接口新增或更新连接，并请求打开连接标签。
 * password / keyPath 等字段只用于建连，不会出现在响应、事件或日志中。
 */
@Data
public class IntegrationOpenReq {

    /** 已保存连接 ID；与 connectionId 等价 */
    private Long id;
    private Long connectionId;

    private String name;
    private String host;
    private Integer port;
    private String username;
    private String password;
    /** PASSWORD / KEY；不填时沿用已有认证方式或根据 keyPath 推断 */
    private String authType;
    private String keyPath;
    private String passphrase;

    private String groupName;
    private String remark;

    /** desktop / workbench；为空时沿用当前用户「连接后进入桌面」设置 */
    private String view;
    /** 调用方名称，默认 external-api */
    private String source;

    /** 是否通知已打开的工作台页面自动打开标签，默认 true */
    private Boolean open;
    /** 没有在线页面时，是否在 DeepShell 所在机器打开浏览器，默认 false */
    private Boolean openInBrowser;
}
