package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.service.RedisClientService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** AI 桌面内置 Redis 插件使用的数据访问 API。 */
@RestController
@RequestMapping("/api/desktop/redis")
public class DesktopRedisController {

    private final RedisClientService service;

    public DesktopRedisController(RedisClientService service) {
        this.service = service;
    }

    @PostMapping("/connect")
    public R<Map<String, Object>> connect(@RequestBody ConnectReq req) {
        return R.ok(service.connect(req.host, req.port == null ? 6379 : req.port,
                req.username, req.password, req.db == null ? 0 : req.db,
                req.timeoutMs == null ? 5000 : req.timeoutMs));
    }

    @PostMapping("/disconnect")
    public R<Void> disconnect(@RequestBody ConnReq req) {
        service.disconnect(req.connectionId);
        return R.ok();
    }

    @PostMapping("/select")
    public R<Map<String, Object>> select(@RequestBody SelectReq req) {
        return R.ok(service.select(req.connectionId, req.db == null ? 0 : req.db));
    }

    @PostMapping("/scan")
    public R<Map<String, Object>> scan(@RequestBody ScanReq req) {
        return R.ok(service.scan(req.connectionId, req.cursor, req.match,
                req.count == null ? 100 : req.count));
    }

    @PostMapping("/key")
    public R<Map<String, Object>> key(@RequestBody KeyReq req) {
        return R.ok(service.key(req.connectionId, req.key, req.limit == null ? 500 : req.limit));
    }

    @PostMapping("/key/string")
    public R<Map<String, Object>> setString(@RequestBody StringReq req) {
        return R.ok(service.setString(req.connectionId, req.key, req.value));
    }

    @PostMapping("/key/ttl")
    public R<Map<String, Object>> ttl(@RequestBody TtlReq req) {
        return R.ok(service.setTtl(req.connectionId, req.key, req.ttl == null ? -1 : req.ttl));
    }

    @PostMapping("/key/rename")
    public R<Map<String, Object>> rename(@RequestBody RenameReq req) {
        return R.ok(service.rename(req.connectionId, req.key, req.newKey));
    }

    @PostMapping("/key/delete")
    public R<Map<String, Object>> delete(@RequestBody KeyReq req) {
        return R.ok(service.delete(req.connectionId, req.key));
    }

    @PostMapping("/key/hash")
    public R<Map<String, Object>> editHash(@RequestBody HashReq req) {
        return R.ok(service.editHash(req.connectionId, req.key, req.op, req.field, req.value));
    }

    @PostMapping("/key/list")
    public R<Map<String, Object>> editList(@RequestBody ListReq req) {
        return R.ok(service.editList(req.connectionId, req.key, req.op,
                req.index == null ? -1 : req.index, req.value));
    }

    @PostMapping("/key/set")
    public R<Map<String, Object>> editSet(@RequestBody SetReq req) {
        return R.ok(service.editSet(req.connectionId, req.key, req.op, req.member));
    }

    @PostMapping("/key/zset")
    public R<Map<String, Object>> editZset(@RequestBody ZsetReq req) {
        return R.ok(service.editZset(req.connectionId, req.key, req.op, req.member,
                req.score == null ? 0D : req.score));
    }

    @PostMapping("/command")
    public R<Map<String, Object>> command(@RequestBody CommandReq req) {
        return R.ok(service.command(req.connectionId, req.command));
    }

    @PostMapping("/info")
    public R<Map<String, Object>> info(@RequestBody ConnReq req) {
        return R.ok(service.info(req.connectionId));
    }

    public static class ConnReq {
        public String connectionId;
    }

    public static class ConnectReq extends ConnReq {
        public String host;
        public Integer port;
        public String username;
        public String password;
        public Integer db;
        public Integer timeoutMs;
    }

    public static class SelectReq extends ConnReq {
        public Integer db;
    }

    public static class ScanReq extends ConnReq {
        public String cursor;
        public String match;
        public Integer count;
    }

    public static class KeyReq extends ConnReq {
        public String key;
        public Integer limit;
    }

    public static class StringReq extends KeyReq {
        public String value;
    }

    public static class TtlReq extends KeyReq {
        public Long ttl;
    }

    public static class RenameReq extends KeyReq {
        public String newKey;
    }

    public static class HashReq extends KeyReq {
        public String op;
        public String field;
        public String value;
    }

    public static class ListReq extends KeyReq {
        public String op;
        public Integer index;
        public String value;
    }

    public static class SetReq extends KeyReq {
        public String op;
        public String member;
    }

    public static class ZsetReq extends KeyReq {
        public String op;
        public String member;
        public Double score;
    }

    public static class CommandReq extends ConnReq {
        public String command;
    }
}
