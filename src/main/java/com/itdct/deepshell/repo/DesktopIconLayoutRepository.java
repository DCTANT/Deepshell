package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.DesktopIconLayout;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DesktopIconLayoutRepository extends JpaRepository<DesktopIconLayout, Long> {

    List<DesktopIconLayout> findByConnectionIdOrderBySortOrderAscIdAsc(Long connectionId);

    void deleteByConnectionId(Long connectionId);
}
