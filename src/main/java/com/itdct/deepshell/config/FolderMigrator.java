package com.itdct.deepshell.config;

import com.itdct.deepshell.entity.ConnFolder;
import com.itdct.deepshell.entity.SshConnection;
import com.itdct.deepshell.repo.ConnFolderRepository;
import com.itdct.deepshell.repo.SshConnectionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 一次性迁移：把旧的“分组”文本（groupName）转为真正的文件夹，并挂到对应连接上。
 * 幂等：仅处理 folderId 为空且 groupName 非空的连接，处理完后不再触发。
 */
@Slf4j
@Component
public class FolderMigrator implements ApplicationRunner {

    private final SshConnectionRepository connRepo;
    private final ConnFolderRepository folderRepo;

    public FolderMigrator(SshConnectionRepository connRepo, ConnFolderRepository folderRepo) {
        this.connRepo = connRepo;
        this.folderRepo = folderRepo;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            Map<String, Long> byName = new HashMap<>();
            for (ConnFolder f : folderRepo.findAll()) {
                byName.putIfAbsent(f.getName(), f.getId());
            }
            int migrated = 0;
            for (SshConnection c : connRepo.findAll()) {
                if (c.getFolderId() != null || c.getGroupName() == null || c.getGroupName().trim().isEmpty()) {
                    continue;
                }
                String g = c.getGroupName().trim();
                Long fid = byName.get(g);
                if (fid == null) {
                    ConnFolder f = new ConnFolder();
                    f.setName(g);
                    fid = folderRepo.save(f).getId();
                    byName.put(g, fid);
                }
                c.setFolderId(fid);
                connRepo.save(c);
                migrated++;
            }
            if (migrated > 0) {
                log.info("已将 {} 条连接的分组文本迁移为文件夹", migrated);
            }
        } catch (Exception e) {
            log.warn("分组迁移未执行（不影响使用）: {}", e.getMessage());
        }
    }
}
