package com.itdct.deepshell.config;

import com.itdct.deepshell.entity.CommonDir;
import com.itdct.deepshell.repo.CommonDirRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 一次性迁移：旧版常用目录是全局共享的，无法判断原本属于哪台主机，
 * 直接清理；新版常用目录按连接（主机）隔离保存。
 */
@Slf4j
@Component
public class CommonDirMigrator implements ApplicationRunner {

    private final CommonDirRepository repo;

    public CommonDirMigrator(CommonDirRepository repo) {
        this.repo = repo;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            List<CommonDir> legacy = repo.findByConnectionIdIsNull();
            if (!legacy.isEmpty()) {
                repo.deleteAll(legacy);
                log.info("已清理 {} 条旧版全局常用目录（新版按连接隔离，无法归属到具体主机）", legacy.size());
            }
        } catch (Exception e) {
            log.warn("常用目录迁移未执行（不影响使用）: {}", e.getMessage());
        }
    }
}
