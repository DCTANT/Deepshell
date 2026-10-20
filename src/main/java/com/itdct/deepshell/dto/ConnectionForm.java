package com.itdct.deepshell.dto;

import lombok.Data;

@Data
public class ConnectionForm {

    private String name;
    private String groupName;
    private String host;
    private Integer port;
    private String username;
    /** PASSWORD / KEY */
    private String authType;
    /** 明文密码：仅提交时传输，服务端加密存储；为空表示不修改 */
    private String password;
    private String keyPath;
    /** 私钥口令：同上 */
    private String passphrase;
    private String remark;
    /** NONE / HTTP / SOCKS5 */
    private String proxyType;
    private String proxyHost;
    private Integer proxyPort;
    private String proxyUsername;
    /** 明文代理密码：仅提交时传输，服务端加密存储；为空表示不修改 */
    private String proxyPassword;
    /** 跳板机连接 id（必须是另一条已保存连接） */
    private Long jumpConnectionId;
    /** 持久会话（tmux） */
    private Boolean persistSession;
    private Integer sortOrder;
    /** 仅「测试连接」使用：编辑态据此回退已保存的密码 / 私钥口令；保存接口忽略 */
    private Long id;
    /** 所属文件夹（null 为根目录） */
    private Long folderId;
    private Boolean favorite;
    private Boolean pinned;
}
