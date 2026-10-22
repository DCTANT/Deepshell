package com.itdct.deepshell.plugin;

import java.nio.file.Path;

/** 提供给插件后端模块的最小运行环境，不暴露 Spring 容器和宿主服务。 */
public final class PluginContext {

    private final String pluginId;
    private final Path pluginDir;
    private final Path dataDir;

    PluginContext(String pluginId, Path pluginDir, Path dataDir) {
        this.pluginId = pluginId;
        this.pluginDir = pluginDir;
        this.dataDir = dataDir;
    }

    public String getPluginId() {
        return pluginId;
    }

    public Path getPluginDir() {
        return pluginDir;
    }

    /** 当前插件独占的数据目录（数据目录/plugin-data/插件 id），已自动创建。 */
    public Path getDataDir() {
        return dataDir;
    }
}
