package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.AuditLog;
import com.itdct.deepshell.repo.AuditLogRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import javax.servlet.http.HttpServletRequest;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 审计日志：只记录“谁在什么时候做了什么”，不记录密码与完整命令输出。
 * 默认最多保留 5 万条，写满后按 id 从旧到新清理。
 */
@Slf4j
@Service
public class AuditService {

    private static final int MAX_ROWS = 50_000;
    private static final int MAX_TARGET = 1000;
    private static final int MAX_DETAIL = 2000;
    private static final DateTimeFormatter CSV_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final AuditLogRepository repo;
    private final AuthService auth;
    private final AtomicLong writeCounter = new AtomicLong();

    public AuditService(AuditLogRepository repo, AuthService auth) {
        this.repo = repo;
        this.auth = auth;
    }

    /** 记录一条审计；异常只写应用日志，不影响业务操作 */
    public void record(String action, String target, String result, String detail) {
        try {
            AuditLog entry = new AuditLog();
            entry.setUsername(auth.isEnabled() ? auth.getUsername() : "local");
            entry.setClientIp(currentIp());
            entry.setAction(truncate(action, 40));
            entry.setTarget(truncate(target, MAX_TARGET));
            entry.setDetail(truncate(detail, MAX_DETAIL));
            entry.setResult(truncate(result, 16));
            repo.save(entry);
            if (writeCounter.incrementAndGet() % 500 == 0) {
                trim();
            }
        } catch (Exception e) {
            log.warn("写入审计日志失败: {}", e.getMessage());
        }
    }

    public Map<String, Object> search(String action, String keyword, int page, int size) {
        int safePage = Math.max(1, page);
        int safeSize = Math.max(1, Math.min(200, size));
        String kw = keyword == null ? "" : keyword.trim().toLowerCase();
        Page<AuditLog> result = repo.search(
                action == null ? "" : action.trim(),
                kw.isEmpty() ? "" : "%" + kw + "%",
                PageRequest.of(safePage - 1, safeSize, Sort.by(Sort.Direction.DESC, "id")));

        List<Map<String, Object>> items = new ArrayList<>();
        for (AuditLog entry : result.getContent()) {
            items.add(item(entry));
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", items);
        data.put("total", result.getTotalElements());
        data.put("page", safePage);
        data.put("size", safeSize);
        return data;
    }

    /** 导出当前筛选条件下的最近 5000 条为 CSV（带 BOM，Excel 直接打开不乱码） */
    public String exportCsv(String action, String keyword) {
        String kw = keyword == null ? "" : keyword.trim().toLowerCase();
        Page<AuditLog> result = repo.search(
                action == null ? "" : action.trim(),
                kw.isEmpty() ? "" : "%" + kw + "%",
                PageRequest.of(0, 5000, Sort.by(Sort.Direction.DESC, "id")));
        StringBuilder sb = new StringBuilder("\uFEFF");
        sb.append("时间,用户,IP,操作,目标,结果,详情\r\n");
        for (AuditLog entry : result.getContent()) {
            sb.append(csv(entry.getCreatedAt() == null ? "" : entry.getCreatedAt().format(CSV_TIME))).append(',')
                    .append(csv(entry.getUsername())).append(',')
                    .append(csv(entry.getClientIp())).append(',')
                    .append(csv(entry.getAction())).append(',')
                    .append(csv(entry.getTarget())).append(',')
                    .append(csv(entry.getResult())).append(',')
                    .append(csv(entry.getDetail())).append("\r\n");
        }
        return sb.toString();
    }

    private Map<String, Object> item(AuditLog entry) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", entry.getId());
        m.put("createdAt", entry.getCreatedAt() == null ? null
                : entry.getCreatedAt().atZone(ZoneId.systemDefault()).toInstant().toEpochMilli());
        m.put("username", entry.getUsername());
        m.put("clientIp", entry.getClientIp());
        m.put("action", entry.getAction());
        m.put("target", entry.getTarget());
        m.put("result", entry.getResult());
        m.put("detail", entry.getDetail());
        return m;
    }

    private void trim() {
        try {
            long count = repo.count();
            if (count > MAX_ROWS) {
                repo.deleteOldest((int) (count - MAX_ROWS));
            }
        } catch (Exception e) {
            log.warn("清理审计日志失败: {}", e.getMessage());
        }
    }

    private static String currentIp() {
        try {
            RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
            if (attributes instanceof ServletRequestAttributes) {
                HttpServletRequest request = ((ServletRequestAttributes) attributes).getRequest();
                String ip = request.getRemoteAddr();
                if ("0:0:0:0:0:0:0:1".equals(ip) || "::1".equals(ip)) {
                    return "127.0.0.1";
                }
                if (ip != null && ip.startsWith("::ffff:")) {
                    return ip.substring(7);
                }
                return ip == null ? "system" : ip;
            }
        } catch (Exception ignore) {
            // 异步线程没有请求上下文
        }
        return "system";
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max - 1) + "…";
    }

    private static String csv(String value) {
        if (value == null) {
            return "\"\"";
        }
        String clean = value.replace("\r", " ").replace("\n", " ").replace("\"", "\"\"");
        return "\"" + clean + "\"";
    }
}
