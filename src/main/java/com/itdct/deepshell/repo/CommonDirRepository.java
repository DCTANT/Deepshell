package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.CommonDir;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CommonDirRepository extends JpaRepository<CommonDir, Long> {

    List<CommonDir> findByConnectionIdOrderByIdAsc(Long connectionId);

    Optional<CommonDir> findByConnectionIdAndPath(Long connectionId, String path);

    List<CommonDir> findByConnectionIdIsNull();
}
