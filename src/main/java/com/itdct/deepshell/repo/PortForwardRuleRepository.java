package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.PortForwardRule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PortForwardRuleRepository extends JpaRepository<PortForwardRule, Long> {

    List<PortForwardRule> findByConnectionIdOrderByIdAsc(Long connectionId);

    void deleteByConnectionId(Long connectionId);
}
