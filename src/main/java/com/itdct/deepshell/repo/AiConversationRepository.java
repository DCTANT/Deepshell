package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.AiConversation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AiConversationRepository extends JpaRepository<AiConversation, Long> {

    List<AiConversation> findByConnectionId(Long connectionId);
}
