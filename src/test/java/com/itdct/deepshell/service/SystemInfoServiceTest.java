package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SystemInfoServiceTest {

    @SuppressWarnings("unchecked")
    private static List<Map<String, String>> rows(Map<String, Object> info, String section) {
        return (List<Map<String, String>>) info.get(section);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> objects(Map<String, Object> info, String section) {
        return (List<Map<String, Object>>) info.get(section);
    }

    private static String valueOf(List<Map<String, String>> rows, String label) {
        for (Map<String, String> r : rows) {
            if (label.equals(r.get("label"))) {
                return r.get("value");
            }
        }
        return null;
    }

    private static String raw() {
        return "hostname=web-01\n"
                + "os=Ubuntu 22.04.3 LTS\n"
                + "kernel=5.15.0-91-generic\n"
                + "arch=x86_64\n"
                + "cpu=Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz\n"
                + "cores=8\n"
                + "mhz=2399.996\n"
                + "cache=35840 KB\n"
                + "bogo=4788.16\n"
                + "memtotal=16267296\n"
                + "memavail=12000000\n"
                + "swaptotal=2097148\n"
                + "swapfree=1048574\n"
                + "uptime=112345\n"
                + "load=0.15 0.10 0.05\n"
                + "ips=10.0.0.8 172.17.0.1\n"
                + "time=2026-10-16 16:20:31\n"
                + "ts1 1700000000\n"
                + "s1 cpu  100 20 50 800 30 5 5 0 0 0\n"
                + "n1 eth0 1000000 2000000\n"
                + "ts2 1700000001\n"
                + "s2 cpu  150 30 80 1040 50 8 8 0 0 0\n"
                + "n2 eth0 1002048 2001024\n"
                + "df /dev/sda1 41126400 12632000 26394400 33 /\n"
                + "df /dev/sdb1 104857600 52428800 52428800 50 /data\n";
    }

    @Test
    void parsesAllSections() {
        Map<String, Object> info = SystemInfoService.format(raw());

        List<Map<String, String>> basic = rows(info, "basic");
        assertEquals("web-01", valueOf(basic, "主机名"));
        assertEquals("Ubuntu 22.04.3 LTS", valueOf(basic, "操作系统"));
        assertEquals("5.15.0-91-generic", valueOf(basic, "内核版本"));
        assertEquals("x86_64", valueOf(basic, "硬件架构"));
        assertEquals("10.0.0.8 172.17.0.1", valueOf(basic, "IP 地址"));
        assertEquals("1 天 7 小时 12 分", valueOf(basic, "运行时长"));
        assertEquals("0.15 0.10 0.05", valueOf(basic, "负载（1/5/15 分钟）"));

        List<Map<String, String>> cpu = rows(info, "cpu");
        assertEquals("Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz", valueOf(cpu, "CPU 型号"));
        assertEquals("8 核", valueOf(cpu, "核心数"));
        assertEquals("2399.996 MHz", valueOf(cpu, "主频"));
        assertEquals("35840 KB", valueOf(cpu, "缓存"));
        assertEquals("4788.16", valueOf(cpu, "BogoMIPS"));
    }

    @Test
    void computesCpuUsageBreakdown() {
        Map<String, Object> info = SystemInfoService.format(raw());
        List<Map<String, String>> usage = rows(info, "cpuUsage");
        // 增量: user50 nice10 system30 idle240 iowait20 irq3 softirq3 -> total356
        assertEquals("32.6%", valueOf(usage, "实时占用"));
        assertEquals("14.0%", valueOf(usage, "用户"));
        assertEquals("2.8%", valueOf(usage, "Nice"));
        assertEquals("8.4%", valueOf(usage, "系统"));
        assertEquals("67.4%", valueOf(usage, "空闲"));
        assertEquals("5.6%", valueOf(usage, "IO 等待"));
        assertEquals("0.8%", valueOf(usage, "硬中断"));
        assertEquals("0.8%", valueOf(usage, "软中断"));
    }

    @Test
    void parsesMemorySwapNetDisk() {
        Map<String, Object> info = SystemInfoService.format(raw());
        List<Map<String, String>> memory = rows(info, "memory");
        // 16267296KB ≈ 15.5GB，已用 4267296KB ≈ 4.1GB -> 26%
        assertEquals("已用 4.1 GB / 共 15.5 GB (26%)", valueOf(memory, "物理内存"));
        assertEquals("11.4 GB", valueOf(memory, "物理内存剩余"));
        // 交换 2.0GB 中已用 1.0GB -> 50%
        assertEquals("已用 1.0 GB / 共 2.0 GB (50%)", valueOf(memory, "交换分区"));
        assertEquals("1.0 GB", valueOf(memory, "交换分区剩余"));

        List<Map<String, Object>> net = objects(info, "net");
        assertEquals(1, net.size());
        assertEquals("eth0", net.get(0).get("name"));
        assertEquals(1002048L, net.get(0).get("rxBytes"));
        assertEquals(2048L, net.get(0).get("rxRate"));
        assertEquals(1024L, net.get(0).get("txRate"));

        List<Map<String, Object>> disk = objects(info, "disk");
        assertEquals(2, disk.size());
        assertEquals("/dev/sda1", disk.get(0).get("fs"));
        assertEquals(33L, disk.get(0).get("pct"));
        assertEquals("/", disk.get(0).get("mount"));
        assertEquals("/data", disk.get(1).get("mount"));
    }

    @Test
    void missingFieldsTolerated() {
        Map<String, Object> info = SystemInfoService.format("hostname=old-box\narch=x86_64\nmemtotal=1048576\n");
        List<Map<String, String>> basic = rows(info, "basic");
        assertEquals("old-box", valueOf(basic, "主机名"));
        // 无 MemAvailable 时只显示总量
        assertEquals("共 1.0 GB", valueOf(rows(info, "memory"), "物理内存"));
        // 无交换 -> 未启用；无采样行 -> 占用明细为空
        assertEquals("未启用", valueOf(rows(info, "memory"), "交换分区"));
        assertTrue(rows(info, "cpuUsage").isEmpty());
        assertTrue(objects(info, "net").isEmpty());
        assertTrue(objects(info, "disk").isEmpty());
    }

    @Test
    void garbageInputGivesEmptySections() {
        Map<String, Object> info = SystemInfoService.format("'hostname' is not recognized\r\n");
        assertTrue(rows(info, "basic").isEmpty());
    }

    @Test
    void uptimeFormatting() {
        assertEquals("12 分", SystemInfoService.formatUptime("725"));
        assertEquals("2 小时 5 分", SystemInfoService.formatUptime("7500"));
        assertEquals("3 天 5 小时 12 分", SystemInfoService.formatUptime("277920"));
    }
}
