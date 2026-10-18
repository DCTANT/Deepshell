package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.DesktopIconLayout;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface DesktopIconLayoutRepository extends JpaRepository<DesktopIconLayout, Long> {

    List<DesktopIconLayout> findByConnectionIdOrderBySortOrderAscIdAsc(Long connectionId);

    /* 批量删除会立即执行；派生删除只是把实体排队，Hibernate 会先 insert 后 delete 而撞唯一键 */
    @Modifying
    @Query("delete from DesktopIconLayout d where d.connectionId = :connectionId")
    void deleteByConnectionId(@Param("connectionId") Long connectionId);
}
