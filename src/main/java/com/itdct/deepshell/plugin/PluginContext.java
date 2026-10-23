package com.itdct.deepshell.plugin;

import com.itdct.deepshell.service.CryptoService;

import java.nio.file.Path;

/** 提供给插件后端模块的最小运行环境，不暴露 Spring 容器和宿主服务。 */
public final class PluginContext {

    private final String pluginId;
    private final Path pluginDir;
    private final Path dataDir;
    private final CryptoService crypto;

    PluginContext(String pluginId, Path pluginDir, Path dataDir, CryptoService crypto) {
        this.pluginId = pluginId;
        this.pluginDir = pluginDir;
        this.dataDir = dataDir;
        this.crypto = crypto;
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

    /** 使用宿主本机密钥加密敏感内容（如连接密码），返回可持久化的密文。 */
    public String encryptSecret(String plain) {
        return crypto.encrypt(plain);
    }

    /** 解密由 encryptSecret 生成的密文；密钥变更或内容损坏时返回 null。 */
    public String decryptSecret(String encrypted) {
        return crypto.decrypt(encrypted);
    }
}
