package com.itdct.deepshell.dto;

import lombok.Data;

@Data
public class GatewayForm {

    /** 仅「测试」使用：编辑态留空 Token 时沿用已保存的值 */
    private Long id;
    private String name;
    /** http(s)://host:port，可带路径前缀（反向代理场景） */
    private String baseUrl;
    /** 明文 Token，仅提交时传输；为空表示不修改 */
    private String token;
    private Boolean insecureTls;
    private Boolean enabled;
}
