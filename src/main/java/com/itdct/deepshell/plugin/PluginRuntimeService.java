package com.itdct.deepshell.plugin;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itdct.deepshell.common.DataDir;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import javax.annotation.PreDestroy;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 加载已安装插件的后端 JAR，并把通用 invoke 调用路由给对应模块。
 *
 * <p>只从数据目录 plugins/&lt;id&gt; 加载，不接受前端传入任意 JAR 路径。
 * 安装/更新/卸载不会热替换已经加载的类，需重启 DeepShell 生效。</p>
 */
@Slf4j
@Service
public class PluginRuntimeService {

    private static final ObjectMapper OM = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    private static final int MAX_JARS = 64;

    private final Map<String, LoadedModule> modules = new ConcurrentHashMap<>();
    private final Map<String, String> loadErrors = new ConcurrentHashMap<>();

    @EventListener(ApplicationReadyEvent.class)
    public void loadAll() {
        closeAll();
        loadErrors.clear();
        Path root = DataDir.root().resolve("plugins");
        if (!Files.isDirectory(root)) {
            return;
        }
        try (java.util.stream.Stream<Path> stream = Files.list(root)) {
            stream.filter(Files::isDirectory)
                    .filter(p -> !p.getFileName().toString().startsWith("."))
                    .forEach(this::loadOne);
        } catch (Exception e) {
            log.warn("扫描后端插件失败: {}", e.getMessage());
        }
    }

    public boolean isLoaded(String pluginId) {
        if (pluginId == null) {
            return false;
        }
        LoadedModule loaded = modules.get(pluginId);
        return loaded != null && !loaded.stale;
    }

    /** 安装、更新或卸载后标记旧模块失效；实际类替换需要重启。 */
    public void markStale(String pluginId) {
        if (pluginId == null) {
            return;
        }
        LoadedModule loaded = modules.get(pluginId);
        if (loaded != null) {
            loaded.stale = true;
            loadErrors.put(pluginId, "插件文件已更新或卸载，需要重启 DeepShell");
        }
    }

    /**
     * 覆盖或删除插件文件前释放类加载器。Windows 会锁定已加载的 JAR，
     * 不先 close() 会导致插件目录无法移动/删除。释放后需要重启才会重新加载。
     */
    public void unload(String pluginId) {
        if (pluginId == null) {
            return;
        }
        LoadedModule loaded = modules.remove(pluginId);
        if (loaded != null) {
            close(loaded.module, loaded.loader);
        }
        loadErrors.remove(pluginId);
    }

    public Object invoke(String pluginId, String action, Map<String, Object> payload) {
        if (pluginId == null || !pluginId.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,63}")) {
            throw new IllegalArgumentException("插件 ID 不合法");
        }
        if (action == null || action.trim().isEmpty() || action.length() > 128) {
            throw new IllegalArgumentException("插件 action 不合法");
        }
        LoadedModule loaded = modules.get(pluginId);
        if (loaded == null || loaded.stale) {
            String error = loadErrors.get(pluginId);
            String suffix = error == null ? "" : "：" + error;
            throw new IllegalArgumentException("插件后端未加载，请重启 DeepShell 或检查插件包" + suffix);
        }
        try {
            return loaded.module.invoke(action.trim(),
                    payload == null ? Collections.<String, Object>emptyMap() : payload);
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            String msg = e.getMessage();
            throw new IllegalArgumentException("插件调用失败: "
                    + (msg == null || msg.trim().isEmpty() ? e.getClass().getSimpleName() : msg));
        }
    }

    public Map<String, String> loadErrors() {
        return Collections.unmodifiableMap(loadErrors);
    }

    private void loadOne(Path dir) {
        String fallbackId = dir.getFileName().toString();
        try {
            Path manifestFile = dir.resolve("plugin.json");
            if (!Files.isRegularFile(manifestFile)) {
                return;
            }
            RuntimeManifest manifest = OM.readValue(Files.readAllBytes(manifestFile), RuntimeManifest.class);
            if (manifest == null || manifest.id == null || manifest.id.trim().isEmpty()
                    || manifest.backend == null) {
                return;
            }
            String id = manifest.id.trim();
            if (!id.equals(fallbackId)) {
                loadErrors.put(id, "目录名与 plugin.json id 不一致");
                log.warn("后端插件 {} 被跳过：目录名不一致", id);
                return;
            }
            PluginSignatureService.Verification sig = PluginSignatureService.verify(dir);
            if (sig.getStatus() == PluginSignatureService.Status.INVALID) {
                loadErrors.put(id, "插件签名无效");
                log.warn("后端插件 {} 被跳过：{}", id, sig.getMessage());
                return;
            }
            if (sig.getStatus() == PluginSignatureService.Status.UNSIGNED) {
                log.warn("加载未签名后端插件 {}，请确认来源可信", id);
            }
            List<String> jarPaths = manifest.backend.jars;
            if (jarPaths == null || jarPaths.isEmpty() || jarPaths.size() > MAX_JARS) {
                throw new IllegalArgumentException("backend.jars 为空或数量过多");
            }
            List<URL> urls = new ArrayList<>();
            for (String rel : jarPaths) {
                if (rel == null || rel.trim().isEmpty()) {
                    continue;
                }
                Path jar = dir.resolve(rel.trim().replace('\\', '/')).normalize();
                if (!jar.startsWith(dir) || !Files.isRegularFile(jar)
                        || !jar.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".jar")) {
                    throw new IllegalArgumentException("后端 JAR 不存在或路径不合法: " + rel);
                }
                urls.add(jar.toUri().toURL());
            }
            if (urls.isEmpty()) {
                throw new IllegalArgumentException("没有可加载的后端 JAR");
            }
            String main = manifest.backend.main == null ? "" : manifest.backend.main.trim();
            if (!main.matches("[A-Za-z_$][A-Za-z0-9_$.]*")) {
                throw new IllegalArgumentException("backend.main 不合法");
            }
            URLClassLoader loader = new URLClassLoader(urls.toArray(new URL[0]),
                    PluginRuntimeService.class.getClassLoader());
            try {
                Class<?> cls = Class.forName(main, true, loader);
                if (!DesktopPluginModule.class.isAssignableFrom(cls)) {
                    throw new IllegalArgumentException("后端类未实现 DesktopPluginModule");
                }
                DesktopPluginModule module = (DesktopPluginModule) cls.getDeclaredConstructor().newInstance();
                if (!id.equals(module.id())) {
                    throw new IllegalArgumentException("后端模块 id 与 plugin.json 不一致");
                }
                Path dataDir = DataDir.root().resolve("plugin-data").resolve(id);
                Files.createDirectories(dataDir);
                PluginContext context = new PluginContext(id, dir, dataDir);
                module.initialize(context);
                LoadedModule old = modules.put(id, new LoadedModule(module, loader));
                if (old != null) {
                    close(old.module, old.loader);
                }
                loadErrors.remove(id);
                log.info("已加载后端插件 {} v{}", id,
                        manifest.version == null ? "" : manifest.version);
            } catch (Exception e) {
                try {
                    loader.close();
                } catch (Exception ignore) {
                    // ignore
                }
                throw e;
            }
        } catch (Exception e) {
            String msg = e.getMessage();
            loadErrors.put(fallbackId, msg == null || msg.trim().isEmpty()
                    ? e.getClass().getSimpleName() : msg);
            log.warn("加载后端插件 {} 失败: {}", fallbackId, msg);
        }
    }

    private void closeAll() {
        for (LoadedModule loaded : modules.values()) {
            close(loaded.module, loaded.loader);
        }
        modules.clear();
    }

    private void close(DesktopPluginModule module, URLClassLoader loader) {
        try {
            module.close();
        } catch (Exception e) {
            log.warn("关闭插件模块失败: {}", e.getMessage());
        }
        try {
            loader.close();
        } catch (Exception ignore) {
            // ignore
        }
    }

    @PreDestroy
    public void shutdown() {
        closeAll();
    }

    private static final class LoadedModule {
        private final DesktopPluginModule module;
        private final URLClassLoader loader;
        private volatile boolean stale;

        private LoadedModule(DesktopPluginModule module, URLClassLoader loader) {
            this.module = module;
            this.loader = loader;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class RuntimeManifest {
        public String id;
        public String version;
        public Backend backend;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Backend {
        public List<String> jars;
        public String main;
    }
}
