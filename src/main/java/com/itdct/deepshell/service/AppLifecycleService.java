package com.itdct.deepshell.service;

import com.itdct.deepshell.common.AppRestartSupport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.stereotype.Service;

/** DeepShell 进程自身的关闭与重启（区别于 PowerService 对远端服务器的关机 / 重启）。 */
@Service
public class AppLifecycleService {

    private static final Logger log = LoggerFactory.getLogger(AppLifecycleService.class);

    private final ApplicationArguments applicationArguments;

    public AppLifecycleService(ApplicationArguments applicationArguments) {
        this.applicationArguments = applicationArguments;
    }

    public void shutdown() {
        log.info("收到界面关闭请求，DeepShell 即将退出");
        AppRestartSupport.exitAfter(600);
    }

    /** 启动重启助手；助手拉起失败时抛错，当前进程保持运行。 */
    public void restart() throws Exception {
        AppRestartSupport.launchRestart(applicationArguments.getSourceArgs());
        log.info("收到界面重启请求，DeepShell 即将退出并自动重新启动");
        AppRestartSupport.exitAfter(600);
    }
}
