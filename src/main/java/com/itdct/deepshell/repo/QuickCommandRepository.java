package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.QuickCommand;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface QuickCommandRepository extends JpaRepository<QuickCommand, Long> {

    List<QuickCommand> findAllByOrderBySortOrderAscIdAsc();
}
