package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.AuditLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuditLogRepository extends JpaRepository<AuditLog, Long> {

    @Query("select a from AuditLog a where (:action = '' or a.action = :action) "
            + "and (:kw = '' or lower(a.target) like :kw or lower(a.detail) like :kw "
            + "or lower(a.username) like :kw) order by a.id desc")
    Page<AuditLog> search(@Param("action") String action,
                          @Param("kw") String kw,
                          Pageable pageable);

    @Modifying
    @Query(value = "delete from audit_log where id in "
            + "(select id from audit_log order by id asc limit ?1)", nativeQuery = true)
    int deleteOldest(int count);
}
