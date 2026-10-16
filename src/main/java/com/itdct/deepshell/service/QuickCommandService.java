package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.QuickCommand;
import com.itdct.deepshell.repo.QuickCommandRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class QuickCommandService {

    private final QuickCommandRepository repo;

    public QuickCommandService(QuickCommandRepository repo) {
        this.repo = repo;
    }

    public List<QuickCommand> list() {
        return repo.findAllByOrderBySortOrderAscIdAsc();
    }

    public QuickCommand save(Long id, QuickCommand form) {
        if (form.getName() == null || form.getName().trim().isEmpty()) {
            throw new IllegalArgumentException("名称不能为空");
        }
        if (form.getCommand() == null || form.getCommand().trim().isEmpty()) {
            throw new IllegalArgumentException("命令内容不能为空");
        }
        QuickCommand c = id == null ? new QuickCommand() : repo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("快捷命令不存在: " + id));
        c.setName(form.getName().trim());
        c.setCommand(form.getCommand());
        c.setSortOrder(form.getSortOrder() == null ? 0 : form.getSortOrder());
        return repo.save(c);
    }

    public void delete(Long id) {
        repo.deleteById(id);
    }
}
