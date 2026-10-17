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

    public List<CommonDir> list(Long connId) {
        requireConnId(connId);
        return repo.findByConnectionIdOrderByIdAsc(connId);
    }

    public CommonDir add(Long connId, String path) {
        requireConnId(connId);
        if (path == null || path.trim().isEmpty()) {
            throw new IllegalArgumentException("目录路径不能为空");
        }
        String p = path.trim();
        if (p.length() > 500) {
            throw new IllegalArgumentException("目录路径过长");
        }
        if (repo.findByConnectionIdAndPath(connId, p).isPresent()) {
            throw new IllegalArgumentException("该目录已在当前主机的常用目录中");
        }
        CommonDir d = new CommonDir();
        d.setConnectionId(connId);
        d.setPath(p);
        return repo.save(d);
    }

    public void delete(Long connId, Long id) {
        requireConnId(connId);
        CommonDir d = repo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("常用目录不存在"));
        if (!connId.equals(d.getConnectionId())) {
            throw new IllegalArgumentException("该常用目录不属于当前主机");
        }
        repo.delete(d);
    }

    private static void requireConnId(Long connId) {
        if (connId == null) {
            throw new IllegalArgumentException("缺少连接 ID");
        }
    }
}
