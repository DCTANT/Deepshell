package com.itdct.deepshell.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

class DesktopPluginServiceTest {

    @TempDir
    Path temp;

    private DesktopPluginService service;

    @BeforeEach
    void setUp() throws Exception {
        service = new DesktopPluginService(mock(AuditService.class));
        service.initAt(temp.resolve("plugins"), temp.resolve("staging"));
    }

    @Test
    void installsListAndDeletesPlugin() throws Exception {
        MockMultipartFile zip = zip("hello.zip", pluginEntries("com.example.hello", "Hello 插件", "1.0.0"));
        DesktopPluginService.PluginInfo info = service.install(zip);

        assertEquals("com.example.hello", info.getId());
        assertEquals("Hello 插件", info.getName());
        assertEquals("1.0.0", info.getVersion());
        assertEquals(800, info.getWindowWidth());
        assertEquals(600, info.getWindowHeight());
        assertEquals("Hello", info.getTitle());
        assertEquals(4, info.getFileCount());
        assertTrue(info.getTotalBytes() > 0);
        assertFalse(info.isUpdated());
        assertTrue(info.getIconUrl().startsWith("/plugin-assets/com.example.hello/"));
        assertTrue(info.getEntryUrl().startsWith("/plugin-assets/com.example.hello/index.html"));

        List<DesktopPluginService.PluginInfo> list = service.list();
        assertEquals(1, list.size());
        assertEquals("Hello 插件", list.get(0).getName());

        Path pluginDir = temp.resolve("plugins").resolve("com.example.hello");
        assertTrue(Files.isRegularFile(pluginDir.resolve("index.html")));
        assertTrue(Files.isRegularFile(pluginDir.resolve("icon.svg")));
        assertTrue(Files.isRegularFile(pluginDir.resolve("assets/app.js")));

        service.delete("com.example.hello");
        assertTrue(service.list().isEmpty());
        assertFalse(Files.exists(pluginDir));
        assertThrows(IllegalArgumentException.class, () -> service.delete("missing"));
    }

    @Test
    void supportsSingleTopLevelFolder() throws Exception {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("demo/plugin.json", manifest("demo.one", "Demo", "1.0.0"));
        entries.put("demo/index.html", html("demo"));
        entries.put("demo/icon.svg", svg());
        MockMultipartFile zip = zip("demo.zip", entries);

        DesktopPluginService.PluginInfo info = service.install(zip);
        assertEquals("demo.one", info.getId());
        assertEquals("Demo", info.getName());
        assertTrue(Files.isRegularFile(temp.resolve("plugins/demo.one/index.html")));
    }

    @Test
    void updatesExistingPluginAndKeepsSingleEntry() throws Exception {
        service.install(zip("v1.zip", pluginEntries("app.notes", "Notes", "1.0.0")));
        DesktopPluginService.PluginInfo updated = service.install(
                zip("v2.zip", pluginEntries("app.notes", "Notes", "2.0.0")));

        assertTrue(updated.isUpdated());
        assertEquals("2.0.0", updated.getVersion());
        assertEquals(1, service.list().size());
        assertEquals("2.0.0", service.list().get(0).getVersion());
    }

    @Test
    void rejectsZipSlipAndCleansStaging() throws Exception {
        Map<String, byte[]> entries = pluginEntries("bad.plugin", "Bad", "1.0.0");
        entries.put("../evil.txt", "evil".getBytes(StandardCharsets.UTF_8));
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.install(zip("bad.zip", entries)));
        assertTrue(e.getMessage().contains("越界") || e.getMessage().contains("非法"));
        assertTrue(service.list().isEmpty());
        try (java.util.stream.Stream<Path> stream = Files.list(temp.resolve("staging"))) {
            assertEquals(0, stream.count());
        }
    }

    @Test
    void rejectsManifestWithoutNameOrEntry() throws Exception {
        Map<String, byte[]> noName = new LinkedHashMap<>();
        noName.put("plugin.json", "{\"entry\":\"index.html\"}".getBytes(StandardCharsets.UTF_8));
        noName.put("index.html", html("x"));
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.install(zip("noname.zip", noName)));
        assertTrue(e.getMessage().contains("name"));

        Map<String, byte[]> noEntry = new LinkedHashMap<>();
        noEntry.put("plugin.json", manifest("no.entry", "NoEntry", "1.0.0"));
        IllegalArgumentException e2 = assertThrows(IllegalArgumentException.class,
                () -> service.install(zip("noentry.zip", noEntry)));
        assertTrue(e2.getMessage().contains("入口文件"));
        assertTrue(service.list().isEmpty());
    }

    private static Map<String, byte[]> pluginEntries(String id, String name, String version) {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("plugin.json", manifest(id, name, version));
        entries.put("index.html", html(name));
        entries.put("icon.svg", svg());
        entries.put("assets/app.js", "console.log('hi');".getBytes(StandardCharsets.UTF_8));
        return entries;
    }

    private static byte[] manifest(String id, String name, String version) {
        return ("{\"id\":\"" + id + "\",\"name\":\"" + name + "\",\"version\":\"" + version
                + "\",\"description\":\"test plugin\",\"author\":\"tester\","
                + "\"icon\":\"icon.svg\",\"entry\":\"index.html\","
                + "\"window\":{\"width\":800,\"height\":600,\"title\":\"Hello\"}}")
                .getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] html(String name) {
        return ("<!doctype html><html><body><h1>" + name + "</h1></body></html>")
                .getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] svg() {
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\"><rect width=\"64\" height=\"64\" fill=\"#3d7eff\"/></svg>"
                .getBytes(StandardCharsets.UTF_8);
    }

    private static MockMultipartFile zip(String name, Map<String, byte[]> entries) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(out)) {
            for (Map.Entry<String, byte[]> e : entries.entrySet()) {
                zos.putNextEntry(new ZipEntry(e.getKey()));
                zos.write(e.getValue());
                zos.closeEntry();
            }
        }
        return new MockMultipartFile("file", name, "application/zip", out.toByteArray());
    }
}
