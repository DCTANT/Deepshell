package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.SshConnection;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SshConnectionRepository extends JpaRepository<SshConnection, Long> {

    List<SshConnection> findAllByOrderBySortOrderAscIdAsc();

    List<SshConnection> findByFolderId(Long folderId);

    List<SshConnection> findByJumpConnectionId(Long jumpConnectionId);
}
