package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.AiTokenUsage;
import com.itdct.deepshell.repo.AiTokenUsageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDate;

/** AI token 用量记录与按天统计；记录失败不影响模型调用本身 */
@Service
public class AiUsageService {

    private static final Logger log = LoggerFactory.getLogger(AiUsageService.class);

    private final AiTokenUsageRepository repo;
    private final AiConfigService config;

    public AiUsageService(AiTokenUsageRepository repo, AiConfigService config) {
        this.repo = repo;
        this.config = config;
    }

    /** 一次成功的模型调用完成后记录用量（含厂商未返回 usage 时的字符估算） */
    public void record(AiChatClient.Usage usage) {
        if (usage == null) {
            return;
        }
        try {
            AiTokenUsage row = new AiTokenUsage();
            row.setDay(LocalDate.now().toString());
            String provider = config.provider();
            row.setProvider(provider.isEmpty() ? "custom" : provider);
            row.setModel(config.model());
            long input = nullToZero(usage.promptTokens);
            long output = nullToZero(usage.completionTokens);
            row.setInputTokens(input);
            row.setOutputTokens(output);
            row.setTotalTokens(usage.totalTokens == null ? input + output : usage.totalTokens.longValue());
            row.setEstimated(usage.estimated);
            row.setCreatedAt(System.currentTimeMillis());
            repo.save(row);
        } catch (Exception e) {
            log.warn("记录 AI token 用量失败：{}", e.getMessage());
        }
    }

    public Summary summary() {
        LocalDate today = LocalDate.now();
        Summary s = new Summary();
        s.today = bucket(today.toString());
        s.last7Days = bucket(today.minusDays(6).toString());
        s.last30Days = bucket(today.minusDays(29).toString());
        s.allTime = bucket(null);
        return s;
    }

    private Bucket bucket(String fromDay) {
        AiTokenUsageRepository.UsageSum row = fromDay == null ? repo.sumAll() : repo.sumSince(fromDay);
        Bucket b = new Bucket();
        if (row != null) {
            b.inputTokens = toLong(row.getInputTokens());
            b.outputTokens = toLong(row.getOutputTokens());
            b.totalTokens = toLong(row.getTotalTokens());
            b.calls = toLong(row.getCalls());
        }
        b.estimatedCalls = fromDay == null
                ? repo.countByEstimatedTrue()
                : repo.countByDayGreaterThanEqualAndEstimatedTrue(fromDay);
        return b;
    }

    private static long nullToZero(Integer v) {
        return v == null ? 0L : v.longValue();
    }

    private static long toLong(Long v) {
        return v == null ? 0L : v;
    }

    public static class Summary {
        public Bucket today;
        public Bucket last7Days;
        public Bucket last30Days;
        public Bucket allTime;
    }

    public static class Bucket {
        public long inputTokens;
        public long outputTokens;
        public long totalTokens;
        public long calls;
        /** 其中由字符数估算（厂商未返回 usage）的调用次数 */
        public long estimatedCalls;
    }
}
