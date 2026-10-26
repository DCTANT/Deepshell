package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.AiTokenUsage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** token 用量的区间汇总 */
public interface AiTokenUsageRepository extends JpaRepository<AiTokenUsage, Long> {

    @Query("select sum(u.inputTokens) as inputTokens, sum(u.outputTokens) as outputTokens, "
            + "sum(u.totalTokens) as totalTokens, count(u) as calls "
            + "from AiTokenUsage u where u.day >= :fromDay")
    UsageSum sumSince(@Param("fromDay") String fromDay);

    @Query("select sum(u.inputTokens) as inputTokens, sum(u.outputTokens) as outputTokens, "
            + "sum(u.totalTokens) as totalTokens, count(u) as calls from AiTokenUsage u")
    UsageSum sumAll();

    long countByDayGreaterThanEqualAndEstimatedTrue(String fromDay);

    long countByEstimatedTrue();

    interface UsageSum {
        /** 空表时 sum 为 null */
        Long getInputTokens();

        Long getOutputTokens();

        Long getTotalTokens();

        Long getCalls();
    }
}
