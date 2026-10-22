package com.itdct.deepshell.plugin;

import java.util.Map;

/**
 * 桌面插件的后端扩展入口。插件 JAR 中的实现类必须提供无参构造器。
 *
 * <p>后端模块由 DeepShell 在启动时从已安装插件的数据目录加载；插件安装、
 * 更新或卸载后需要重启 DeepShell 才会重新加载 JAR。模块运行在独立
 * URLClassLoader 中，插件自带的第三方 JAR 会一起加入类路径。</p>
 *
 * <p>实现类不应依赖 Spring 容器，也不应缓存用户凭据到磁盘。前端只能通过
 * 当前插件窗口的受限消息桥调用自己的 {@link #invoke(String, Map)}。</p>
 */
public interface DesktopPluginModule {

    /** 必须与 plugin.json 的 id 完全一致。 */
    String id();

    /** 加载时调用一次，失败会导致该插件后端不启用。 */
    default void initialize(PluginContext context) throws Exception {
    }

    /**
     * 处理前端调用。action 由插件自定义；payload 为 JSON 对象转换后的 Map。
     * 返回值必须能被 Jackson 序列化（Map / List / String / Number / Boolean / null）。
     */
    Object invoke(String action, Map<String, Object> payload) throws Exception;

    /** 应用关闭时调用，用于释放连接和线程。 */
    default void close() {
    }
}
