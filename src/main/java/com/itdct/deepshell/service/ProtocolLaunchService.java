package com.itdct.deepshell.service;

import com.itdct.deepshell.config.BrowserLauncher;
import com.itdct.deepshell.config.LocalServerInfo;
import com.itdct.deepshell.protocol.ProtocolFiles;
import com.itdct.deepshell.protocol.ProtocolRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

/**
 * 外部调用编排：解析链接 → 落库到连接 → 打开工作台新标签页。
 * 成功与失败都会给浏览器一个结果页；失败时不会把密码写进日志 / 审计。
 */
@Slf4j
@Service
public class ProtocolLaunchService {

    private final ProtocolOpenService openService;
    private final BrowserLauncher browserLauncher;
    private final LocalServerInfo serverInfo;
    private final AuditService audit;

    public ProtocolLaunchService(ProtocolOpenService openService, BrowserLauncher browserLauncher,
                                 LocalServerInfo serverInfo, AuditService audit) {
        this.openService = openService;
        this.browserLauncher = browserLauncher;
        this.serverInfo = serverInfo;
        this.audit = audit;
    }

    public ProtocolOpenService.Result openFromProtocol(String rawUri, String client) {
        ProtocolRequest request = null;
        try {
            request = ProtocolRequest.parse(rawUri);
            ProtocolOpenService.Result result = openService.open(request, client);
            String url = serverInfo.baseUrl() + result.getWorkspacePath();
            browserLauncher.openUrl(url);
            ProtocolFiles.log("已打开连接「" + result.getConnectionName() + "」(#"
                    + result.getConnectionId() + ")" + (result.isCreated() ? "，新建连接" : ""));
            return result;
        } catch (Exception e) {
            String message = e.getMessage() == null ? "外部调用处理失败" : e.getMessage();
            String target = request == null ? "外部调用" : request.describeTarget();
            audit.record("PROTOCOL_OPEN", target, "FAIL", message);
            ProtocolFiles.log("外部调用失败（" + target + "）：" + message);
            log.warn("外部调用失败（{}）: {}", target, message);
            openErrorPage(message);
            throw e instanceof IllegalArgumentException
                    ? (IllegalArgumentException) e
                    : new IllegalArgumentException(message, e);
        }
    }

    private void openErrorPage(String message) {
        String text = message == null ? "外部调用处理失败" : message;
        if (text.length() > 500) {
            text = text.substring(0, 500) + "…";
        }
        try {
            String url = serverInfo.baseUrl() + "/workspace?protocolError="
                    + URLEncoder.encode(text, "UTF-8");
            browserLauncher.openUrl(url);
        } catch (UnsupportedEncodingException e) {
            ProtocolFiles.log("生成错误提示页失败: " + e.getMessage());
        }
    }
}
