package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.DesktopIconLayout;
import com.itdct.deepshell.repo.DesktopIconLayoutRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class DesktopIconLayoutService {

    private static final int MAX_ITEMS = 2000;

    private final DesktopIconLayoutRepository repo;

    public DesktopIconLayoutService(DesktopIconLayoutRepository repo) {
        this.repo = repo;
    }

    public List<DesktopIconLayout> list(Long connId) {
        requireConnId(connId);
        return repo.findByConnectionIdOrderBySortOrderAscIdAsc(connId);
    }

    @Transactional
    public List<DesktopIconLayout> saveLayout(Long connId, List<Map<String, Object>> items) {
        requireConnId(connId);
        repo.deleteByConnectionId(connId);
        LinkedHashMap<String, DesktopIconLayout> unique = new LinkedHashMap<>();
        if (items != null) {
            for (Map<String, Object> item : items) {
                if (item == null || unique.size() >= MAX_ITEMS) {
                    continue;
                }
                String key = str(item.get("iconKey")).trim();
                if (key.isEmpty() || key.length() > 500 || unique.containsKey(key)) {
                    continue;
                }
                DesktopIconLayout row = new DesktopIconLayout();
                row.setConnectionId(connId);
                row.setIconKey(key);
                row.setSortOrder(intVal(item.get("sortOrder"), unique.size()));
                row.setHidden(boolVal(item.get("hidden")));
                unique.put(key, row);
            }
        }
        return repo.saveAll(new ArrayList<>(unique.values()));
    }

    private static String str(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static int intVal(Object value, int fallback) {
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        try {
            return Integer.parseInt(str(value));
        } catch (Exception e) {
            return fallback;
        }
    }

    private static boolean boolVal(Object value) {
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        return "true".equalsIgnoreCase(str(value)) || "1".equals(str(value));
    }

    private static void requireConnId(Long connId) {
        if (connId == null) {
            throw new IllegalArgumentException("缺少连接 ID");
        }
    }
}
