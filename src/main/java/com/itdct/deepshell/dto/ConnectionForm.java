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
    private Integer sortOrder;
    /** 所属文件夹（null 为根目录） */
    private Long folderId;
    private Boolean favorite;
    private Boolean pinned;
}
