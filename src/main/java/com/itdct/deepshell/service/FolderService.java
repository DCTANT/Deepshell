package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.ConnFolder;
import com.itdct.deepshell.entity.SshConnection;
import com.itdct.deepshell.repo.ConnFolderRepository;
import com.itdct.deepshell.repo.SshConnectionRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class FolderService {

    private final ConnFolderRepository folderRepo;
    private final SshConnectionRepository connRepo;

    public FolderService(ConnFolderRepository folderRepo, SshConnectionRepository connRepo) {
        this.folderRepo = folderRepo;
        this.connRepo = connRepo;
    }

    public List<ConnFolder> list() {
        return folderRepo.findAllByOrderBySortOrderAscIdAsc();
    }

    public ConnFolder create(String name, Long parentId) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("文件夹名称不能为空");
        }
        if (parentId != null) {
            folderRepo.findById(parentId).orElseThrow(() -> new IllegalArgumentException("上级文件夹不存在"));
        }
        ConnFolder f = new ConnFolder();
        f.setName(name.trim());
        f.setParentId(parentId);
        return folderRepo.save(f);
    }

    public ConnFolder rename(Long id, String name) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("文件夹名称不能为空");
        }
        ConnFolder f = folderRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("文件夹不存在"));
        f.setName(name.trim());
        return folderRepo.save(f);
    }

    /** 删除文件夹：其中的子文件夹与连接全部上移到父级（不丢数据） */
    public void delete(Long id) {
        ConnFolder f = folderRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("文件夹不存在"));
        Long parent = f.getParentId();
        for (ConnFolder child : folderRepo.findByParentId(id)) {
            child.setParentId(parent);
            folderRepo.save(child);
        }
        for (SshConnection c : connRepo.findByFolderId(id)) {
            c.setFolderId(parent);
            connRepo.save(c);
        }
        folderRepo.delete(f);
    }
}
