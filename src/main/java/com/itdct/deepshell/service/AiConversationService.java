package com.itdct.deepshell.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.itdct.deepshell.entity.AiConversation;
import com.itdct.deepshell.repo.AiConversationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * AI 终端对话的 SQLite 持久化：每连接多个对话，消息以 JSON 文本整体保存，
 * 服务端统一做数量与长度钳制（客户端刷新恢复时状态归一化也在这里）
 */
@Service
public class AiConversationService {

    public static final int MAX_CONVS_PER_CONN = 15;
    /** 单轮 50 步约产生 100 条消息，保留多轮长任务的完整现场 */
    public static final int MAX_MSGS = 160;
    public static final int MAX_CHARS = 4000;
    /** 命令输出与思考过程单独放宽，避免长输出在刷新后只剩开头 */
    public static final int MAX_OUTPUT_CHARS = 10000;
    public static final int MAX_REASONING_CHARS = 12000;
    public static final int MAX_TITLE = 60;

    private final AiConversationRepository repo;
    private final ObjectMapper mapper = new ObjectMapper();

    public AiConversationService(AiConversationRepository repo) {
        this.repo = repo;
    }

    /** 单条对话（msgs 为结构化 JSON 数组） */
    public static class ConvDto {
        public Long id;
        public String title;
        public String cwd;
        public boolean active;
        public boolean pinned;
        public boolean unread;
        public Long parentId;
        public Integer forkPoint;
        public Long createdAt;
        public Long updatedAt;
        public JsonNode msgs;
    }

    public static class ConvForm {
        public String title;
        public String cwd;
        public Boolean active;
        public Boolean pinned;
        public Boolean unread;
        public JsonNode msgs;
    }

    public ConvDto get(Long id) {
        return toDto(getEntity(id));
    }

    public List<ConvDto> list(Long connId) {
        return repo.findByConnectionId(connId).stream()
                .sorted(Comparator.comparing((AiConversation c) -> !Boolean.TRUE.equals(c.getPinned()))
                        .thenComparing(Comparator.comparingLong(
                                (AiConversation c) -> orZero(c.getUpdatedAt())).reversed())
                        .thenComparing(AiConversation::getId, Comparator.reverseOrder()))
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    @Transactional
    public ConvDto create(Long connId) {
        if (connId == null) {
            throw new IllegalArgumentException("缺少连接 ID");
        }
        enforceCap(connId, null);
        deactivateAll(connId);
        AiConversation c = new AiConversation();
        c.setConnectionId(connId);
        c.setTitle("新对话");
        c.setActive(true);
        c.setPinned(false);
        c.setMsgsJson("[]");
        long now = System.currentTimeMillis();
        c.setCreatedAt(now);
        c.setUpdatedAt(now);
        return toDto(repo.save(c));
    }

    /** 从指定对话分叉：默认复制全部消息，也可只复制到某条消息（msgIndex 从 0 起） */
    @Transactional
    public ConvDto fork(Long id, Integer msgIndex) {
        AiConversation src = getEntity(id);
        ArrayNode all = readMsgs(src);
        if (all.size() == 0) {
            throw new IllegalArgumentException("当前对话为空，无法分叉");
        }
        int count = msgIndex == null || msgIndex < 0
                ? all.size() : Math.min(all.size(), msgIndex + 1);
        ArrayNode copy = JsonNodeFactory.instance.arrayNode();
        for (int i = 0; i < count; i++) {
            copy.add(all.get(i).deepCopy());
        }
        enforceCap(src.getConnectionId(), src.getId());
        deactivateAll(src.getConnectionId());

        AiConversation c = new AiConversation();
        c.setConnectionId(src.getConnectionId());
        c.setTitle(forkTitle(src.getTitle()));
        c.setCwd(src.getCwd());
        c.setActive(true);
        c.setPinned(false);
        c.setParentId(src.getId());
        c.setForkPoint(count);
        c.setMsgsJson(clampMsgs(copy).toString());
        long now = System.currentTimeMillis();
        c.setCreatedAt(now);
        c.setUpdatedAt(now);
        return toDto(repo.save(c));
    }

    /** 只更新传入的字段；active=true 时把同连接其他对话置为非选中；纯切换不刷新 updatedAt */
    @Transactional
    public ConvDto save(Long id, ConvForm form) {
        AiConversation c = getEntity(id);
        boolean touch = false;
        if (form.title != null) {
            c.setTitle(clip(form.title, MAX_TITLE));
            touch = true;
        }
        if (form.cwd != null) {
            c.setCwd(clip(form.cwd, 500));
            touch = true;
        }
        if (form.msgs != null) {
            c.setMsgsJson(clampMsgs(form.msgs).toString());
            touch = true;
        }
        if (form.pinned != null) {
            c.setPinned(form.pinned);
        }
        if (form.unread != null) {
            c.setUnread(form.unread);
        }
        if (Boolean.TRUE.equals(form.active)) {
            deactivateAll(c.getConnectionId());
            c.setActive(true);
        } else if (form.active != null) {
            c.setActive(form.active);
        }
        if (touch) {
            c.setUpdatedAt(System.currentTimeMillis());
        }
        return toDto(repo.save(c));
    }

    /** 自动总结的标题：仅当标题仍是占位值或请求发起时的预期标题才替换，避免覆盖用户刚改的名字 */
    @Transactional
    public ConvDto applyAutoTitle(Long id, String title, String expectedTitle) {
        AiConversation c = getEntity(id);
        String current = c.getTitle();
        boolean placeholder = current == null || current.trim().isEmpty() || "新对话".equals(current.trim());
        boolean expected = expectedTitle != null && !expectedTitle.trim().isEmpty()
                && current != null && expectedTitle.trim().equals(current.trim());
        if (!placeholder && !expected) {
            return toDto(c);
        }
        c.setTitle(clip(title, MAX_TITLE));
        return toDto(repo.save(c));
    }

    /** 用户确认后的重新总结：无条件覆盖当前标题 */
    @Transactional
    public ConvDto forceTitle(Long id, String title) {
        AiConversation c = getEntity(id);
        c.setTitle(clip(title, MAX_TITLE));
        c.setUpdatedAt(System.currentTimeMillis());
        return toDto(repo.save(c));
    }

    public void delete(Long id) {
        repo.deleteById(id);
    }

    /** 连接删除时清理其全部对话 */
    public void deleteByConnection(Long connId) {
        repo.deleteAll(repo.findByConnectionId(connId));
    }

    private void enforceCap(Long connId, Long protectId) {
        List<AiConversation> rows = new ArrayList<>(repo.findByConnectionId(connId));
        while (rows.size() >= MAX_CONVS_PER_CONN) {
            AiConversation victim = null;
            for (AiConversation r : rows) {
                if (Boolean.TRUE.equals(r.getActive()) || Boolean.TRUE.equals(r.getPinned())
                        || (protectId != null && protectId.equals(r.getId()))) {
                    continue;
                }
                if (victim == null || orZero(r.getUpdatedAt()) < orZero(victim.getUpdatedAt())) {
                    victim = r;
                }
            }
            if (victim == null) {
                break;
            }
            repo.delete(victim);
            rows.remove(victim);
        }
    }

    private AiConversation getEntity(Long id) {
        return repo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("对话不存在: " + id));
    }

    private ArrayNode readMsgs(AiConversation c) {
        try {
            JsonNode n = mapper.readTree(c.getMsgsJson() == null || c.getMsgsJson().isEmpty()
                    ? "[]" : c.getMsgsJson());
            return n != null && n.isArray() ? (ArrayNode) n : JsonNodeFactory.instance.arrayNode();
        } catch (Exception e) {
            return JsonNodeFactory.instance.arrayNode();
        }
    }

    /** 分叉标题递增：X · 分叉 → X · 分叉2；普通标题追加「 · 分叉」 */
    static String forkTitle(String sourceTitle) {
        String base = sourceTitle == null || sourceTitle.trim().isEmpty() ? "新对话" : sourceTitle.trim();
        Matcher m = Pattern.compile("^(.*) · 分叉(\\d*)$").matcher(base);
        if (m.matches()) {
            String stem = m.group(1);
            int n = m.group(2).isEmpty() ? 1 : Integer.parseInt(m.group(2));
            return clip(stem + " · 分叉" + (n + 1), MAX_TITLE);
        }
        return clip(base + " · 分叉", MAX_TITLE);
    }

    private void deactivateAll(Long connId) {
        for (AiConversation c : repo.findByConnectionId(connId)) {
            if (Boolean.TRUE.equals(c.getActive())) {
                c.setActive(false);
                repo.save(c);
            }
        }
    }

    private ConvDto toDto(AiConversation c) {
        ConvDto d = new ConvDto();
        d.id = c.getId();
        d.title = c.getTitle();
        d.cwd = c.getCwd();
        d.active = Boolean.TRUE.equals(c.getActive());
        d.pinned = Boolean.TRUE.equals(c.getPinned());
        d.unread = Boolean.TRUE.equals(c.getUnread());
        d.parentId = c.getParentId();
        d.forkPoint = c.getForkPoint();
        d.createdAt = c.getCreatedAt();
        d.updatedAt = c.getUpdatedAt();
        try {
            d.msgs = mapper.readTree(c.getMsgsJson() == null || c.getMsgsJson().isEmpty() ? "[]" : c.getMsgsJson());
        } catch (Exception e) {
            d.msgs = JsonNodeFactory.instance.arrayNode();
        }
        return d;
    }

    /**
     * 消息钳制：只保留最后 MAX_MSGS 条；字符串字段超长截断；
     * running / confirm 状态的卡片（上次刷新时中断）归一化为 skipped
     */
    static ArrayNode clampMsgs(JsonNode msgs) {
        ArrayNode out = JsonNodeFactory.instance.arrayNode();
        if (msgs == null || !msgs.isArray()) {
            return out;
        }
        int from = Math.max(0, msgs.size() - MAX_MSGS);
        for (int i = from; i < msgs.size(); i++) {
            JsonNode n = msgs.get(i);
            if (n == null || !n.isObject()) {
                continue;
            }
            ObjectNode copy = ((ObjectNode) n).deepCopy();
            String state = copy.path("state").asText("");
            if ("running".equals(state) || "confirm".equals(state)) {
                copy.put("state", "skipped");
            }
            List<String> names = new ArrayList<>();
            copy.fieldNames().forEachRemaining(names::add);
            for (String name : names) {
                JsonNode v = copy.get(name);
                int limit = fieldLimit(name);
                if (v.isTextual() && v.asText().length() > limit) {
                    copy.put(name, v.asText().substring(0, limit) + "…（已截断）");
                }
            }
            out.add(copy);
        }
        return out;
    }

    private static int fieldLimit(String name) {
        if ("output".equals(name)) {
            return MAX_OUTPUT_CHARS;
        }
        if ("reasoning".equals(name)) {
            return MAX_REASONING_CHARS;
        }
        return MAX_CHARS;
    }

    private static String clip(String s, int max) {
        String t = s == null ? "" : s.trim();
        return t.length() <= max ? t : t.substring(0, max);
    }

    private static long orZero(Long v) {
        return v == null ? 0L : v;
    }
}
