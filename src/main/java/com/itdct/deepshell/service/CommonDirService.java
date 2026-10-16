package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.CommonDir;
import com.itdct.deepshell.repo.CommonDirRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class CommonDirService {

    private final CommonDirRepository repo;

    public CommonDirService(CommonDirRepository repo) {
        this.repo = repo;
    }

    public List<CommonDir> list() {
        return repo.findAllByOrderByIdAsc();
    }

    public CommonDir add(String path) {
        if (path == null || path.trim().isEmpty()) {
            throw new IllegalArgumentException("目录路径不能为空");
        }
        String p = path.trim();
        if (p.length() > 500) {
            throw new IllegalArgumentException("目录路径过长");
        }
        if (repo.findByPath(p).isPresent()) {
            throw new IllegalArgumentException("该目录已在常用目录中");
        }
        CommonDir d = new CommonDir();
        d.setPath(p);
        return repo.save(d);
    }

    public void delete(Long id) {
        repo.deleteById(id);
    }
}
