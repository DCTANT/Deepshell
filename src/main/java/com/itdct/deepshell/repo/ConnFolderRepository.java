package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.ConnFolder;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ConnFolderRepository extends JpaRepository<ConnFolder, Long> {

    List<ConnFolder> findAllByOrderBySortOrderAscIdAsc();

    List<ConnFolder> findByParentId(Long parentId);

    List<ConnFolder> findByName(String name);
}
