package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NetworkTrafficServiceTest {

    private static final String SAMPLE_1 =
            "@@UID 0\n"
            + "@@DEV\n"
            + "Inter-|   Receive                                                |  Transmit\n"
            + " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n"
            + "    lo: 1000 1 0 0 0 0 0 0 1000 1 0 0 0 0 0 0\n"
            + "enp6s18: 100000 100 0 0 0 0 0 0 200000 200 0 0 0 0 0 0\n"
            + "@@SPEED\n"
            + "enp6s18 1000\n"
            + "lo \n"
            + "@@SS\n"
            + "Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n"
            + "tcp ESTAB 0 0 192.168.0.34:50000 8.8.8.8:443 users:((\"curl\",pid=123,fd=4)) ino:1001 sk:1 <->\n"
            + "\t cubic wscale:7,7 bytes_sent:1000 bytes_received:5000\n"
            + "tcp ESTAB 0 0 192.168.0.34:9200 192.168.0.34:50001 users:((\"java\",pid=200,fd=5),(\"java\",pid=201,fd=6)) ino:1002 sk:2 <->\n"
            + "\t cubic wscale:7,7 bytes_sent:2000 bytes_received:3000\n"
            + "udp ESTAB 0 0 192.168.0.34:68 192.168.0.1:67 users:((\"NetworkManager\",pid=300,fd=30))\n"
            + "@@PS\n"
            + "  123 root curl\n"
            + "  200 root java\n"
            + "  201 root java\n"
            + "  300 root NetworkManager\n";

    private static final String SAMPLE_2 =
            "@@UID 0\n"
            + "@@DEV\n"
            + "    lo: 9000 1 0 0 0 0 0 0 9000 1 0 0 0 0 0 0\n"
            + "enp6s18: 110000 110 0 0 0 0 0 0 200500 210 0 0 0 0 0 0\n"
            + "@@SPEED\n"
            + "enp6s18 1000\n"
            + "@@SS\n"
            + "Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n"
            + "tcp ESTAB 0 0 192.168.0.34:50000 8.8.8.8:443 users:((\"curl\",pid=123,fd=4)) ino:1001 sk:1 <->\n"
            + "\t cubic bytes_sent:3000 bytes_received:9000\n"
            + "tcp ESTAB 0 0 192.168.0.34:9200 192.168.0.34:50001 users:((\"java\",pid=200,fd=5),(\"java\",pid=201,fd=6)) ino:1002 sk:2 <->\n"
            + "\t cubic bytes_sent:2500 bytes_received:4000\n"
            + "udp ESTAB 0 0 192.168.0.34:68 192.168.0.1:67 users:((\"NetworkManager\",pid=300,fd=30))\n"
            + "@@PS\n"
            + "  123 root curl\n"
            + "  200 root java\n"
            + "  201 root java\n"
            + "  300 root NetworkManager\n";

    @Test
    void parsesSocketsDevicesAndUsers() {
        NetworkTrafficService.Parsed p = NetworkTrafficService.parse(SAMPLE_1);
        assertTrue(p.ssAvailable);
        assertFalse(p.restricted);
        assertEquals(1, p.dev.size(), "lo 不应计入网卡总量");
        assertEquals(100000L, p.dev.get("enp6s18")[0]);
        assertEquals(200000L, p.dev.get("enp6s18")[1]);
        assertEquals(1000L, p.speedMbps.get("enp6s18").longValue());
        assertEquals(3, p.sockets.size());
        assertEquals(123L, p.sockets.get(0).pid);
        assertEquals("curl", p.sockets.get(0).name);
        assertEquals(5000L, p.sockets.get(0).rx);
        assertEquals(1000L, p.sockets.get(0).tx);
        assertFalse(p.sockets.get(0).loopback);
        assertEquals(200L, p.sockets.get(1).pid, "共享套接字归属第一个进程");
        assertTrue(p.sockets.get(1).loopback, "同主机地址之间的连接视为回环");
        assertTrue(p.sockets.get(2).key.contains("udp"));
        assertEquals("root", p.users.get(200L));
    }

    @Test
    @SuppressWarnings("unchecked")
    void computesRatesTotalsAndUnattributed() {
        NetworkTrafficService.State state = new NetworkTrafficService.State();
        Map<String, Object> first = NetworkTrafficService.apply(
                state, NetworkTrafficService.parse(SAMPLE_1), 100000L, false);
        assertTrue((Boolean) first.get("firstSample"));
        assertEquals(3L, ((Number) first.get("connectionCount")).longValue(),
                "首帧仍应列出当前连接");
        assertEquals(3, ((List<?>) first.get("programs")).size());
        Map<String, Object> firstSystem = (Map<String, Object>) first.get("system");
        assertEquals(0L, ((Number) firstSystem.get("rxRate")).longValue());

        Map<String, Object> second = NetworkTrafficService.apply(
                state, NetworkTrafficService.parse(SAMPLE_2), 102000L, false);
        assertFalse((Boolean) second.get("firstSample"));
        assertEquals(2000L, ((Number) second.get("intervalMs")).longValue());

        List<Map<String, Object>> programs = (List<Map<String, Object>>) second.get("programs");
        Map<String, Object> curl = byPid(programs, 123);
        assertEquals(2000L, ((Number) curl.get("rxRate")).longValue());
        assertEquals(1000L, ((Number) curl.get("txRate")).longValue());
        assertEquals(2000L, ((Number) curl.get("extRxRate")).longValue());
        assertEquals(4000L, ((Number) curl.get("rxTotal")).longValue());
        assertEquals(2000L, ((Number) curl.get("txTotal")).longValue());
        assertEquals(1, ((Number) curl.get("conns")).intValue());

        Map<String, Object> java = byPid(programs, 200);
        assertEquals(500L, ((Number) java.get("rxRate")).longValue());
        assertEquals(250L, ((Number) java.get("txRate")).longValue());
        assertEquals(0L, ((Number) java.get("extRxRate")).longValue());
        assertEquals(1000L, ((Number) java.get("rxTotal")).longValue());
        assertEquals(500L, ((Number) java.get("txTotal")).longValue());
        assertEquals(1, ((Number) java.get("loopbackConns")).intValue());
        assertEquals(0, ((Number) java.get("extConns")).intValue());

        Map<String, Object> system = (Map<String, Object>) second.get("system");
        assertEquals(5000L, ((Number) system.get("rxRate")).longValue());
        assertEquals(250L, ((Number) system.get("txRate")).longValue());
        assertEquals(10000L, ((Number) system.get("rxTotal")).longValue());
        assertEquals(500L, ((Number) system.get("txTotal")).longValue());
        List<Map<String, Object>> ifaces = (List<Map<String, Object>>) system.get("interfaces");
        assertEquals(1, ifaces.size());
        assertEquals(5000L, ((Number) ifaces.get(0).get("rxRate")).longValue());

        Map<String, Object> un = (Map<String, Object>) second.get("unattributed");
        assertEquals(3000L, ((Number) un.get("rxRate")).longValue(), "系统接收 5000 - 已归属 2000");
        assertEquals(0L, ((Number) un.get("txRate")).longValue(), "已归属发送大于总量时归零");
        assertEquals(3L, ((Number) second.get("connectionCount")).longValue());

        Map<String, Object> reset = NetworkTrafficService.apply(
                state, NetworkTrafficService.parse(SAMPLE_2), 104000L, true);
        assertTrue((Boolean) reset.get("firstSample"));
        List<Map<String, Object>> resetRows = (List<Map<String, Object>>) reset.get("programs");
        assertEquals(0L, ((Number) byPid(resetRows, 123).get("rxTotal")).longValue());
        assertEquals(0L, ((Number) byPid(resetRows, 123).get("rxRate")).longValue());
    }

    @Test
    void reportsMissingSsButKeepsDeviceTotals() {
        String raw = "@@UID 1000\n"
                + "@@DEV\n"
                + "eth0: 100 1 0 0 0 0 0 0 200 2 0 0 0 0 0 0\n"
                + "@@SPEED\n"
                + "eth0 100\n"
                + "@@SS\n"
                + "@@NO_SS\n"
                + "@@PS\n";
        NetworkTrafficService.Parsed p = NetworkTrafficService.parse(raw);
        assertFalse(p.ssAvailable);
        assertTrue(p.restricted);
        Map<String, Object> data = NetworkTrafficService.apply(
                new NetworkTrafficService.State(), p, 1000L, false);
        assertFalse((Boolean) data.get("ssAvailable"));
        assertTrue(String.valueOf(data.get("note")).contains("ss"));
        assertEquals(0, ((List<?>) data.get("programs")).size());
        Map<String, Object> system = (Map<String, Object>) data.get("system");
        assertEquals(100L, ((Number) system.get("rxBytes")).longValue());
    }

    @Test
    void hidesProcessWhenUserCannotReadIt() {
        String raw = "@@UID 1000\n"
                + "@@SS\n"
                + "Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n"
                + "tcp ESTAB 0 0 10.0.0.2:50000 1.1.1.1:443\n"
                + "\t cubic bytes_sent:10 bytes_received:20\n";
        NetworkTrafficService.Parsed p = NetworkTrafficService.parse(raw);
        assertTrue(p.restricted);
        assertEquals(1, p.sockets.size());
        assertEquals(0L, p.sockets.get(0).pid);
        assertEquals("未知进程", p.sockets.get(0).name);
    }

    @Test
    void normalizesAddressesForLoopbackDetection() {
        assertTrue(NetworkTrafficService.isLoopback("127.0.0.1:3306"));
        assertTrue(NetworkTrafficService.isLoopback("[::1]:9200"));
        assertTrue(NetworkTrafficService.isLoopback("[::ffff:127.0.0.1]:9200"));
        assertFalse(NetworkTrafficService.isLoopback("192.168.0.34:9200"));
        assertEquals("192.168.0.34", NetworkTrafficService.hostOf("[::ffff:192.168.0.34]:9200"));
        assertEquals("fe80::1", NetworkTrafficService.hostOf("[fe80::1%eth0]:9200"));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> byPid(List<Map<String, Object>> rows, long pid) {
        for (Map<String, Object> row : rows) {
            if (((Number) row.get("pid")).longValue() == pid) {
                return row;
            }
        }
        throw new AssertionError("找不到 PID " + pid);
    }
}
