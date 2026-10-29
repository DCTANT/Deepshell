# DeepShell 1.8.0 更新日志

发布日期：2026-10-29

对比版本：v1.7.0

## 新增

### 内置容器与集群管理器（Docker / Kubernetes）

- 新增官方插件 **容器与集群管理器**（`com.deepshell.containers`），可在桌面「安装 / 管理 → 内置应用」中一键安装，含官方签名与后端模块；安装或更新后需重启 DeepShell 加载后端。
- Docker：支持本机 docker CLI，或通过 SSH（密码 / 私钥 + 口令）在目标主机执行 docker；可查看容器列表、CPU / 内存、状态与端口，执行启动 / 停止 / 重启 / 暂停 / 删除、查看日志、JSON 详情与一次性命令；支持镜像拉取 / 删除，以及卷、网络的查看与删除。
- SSH 首次连接会展示 SHA-256 主机指纹，确认后写入插件数据目录；之后主机密钥变化会直接拒绝连接。
- Kubernetes：使用运行 DeepShell 的电脑上的 kubectl 与 kubeconfig（可留空使用默认 `~/.kube/config`），支持指定 context；可浏览节点、命名空间、Pod、Deployment、Service 与事件，查看 Pod 日志、执行一次性命令、查看 describe，并对 Deployment 执行缩放 / 滚动重启 / 删除。
- 支持保存多个连接；SSH 密码、私钥、口令与 kubeconfig 使用 DeepShell 本机 AES-GCM 密钥加密，明文不进入浏览器；kubeconfig 仅在连接期间写入插件数据目录，断开时删除。
- 运行要求：Docker 需要本机或 SSH 目标机安装 docker CLI；Kubernetes 需要运行 DeepShell 的电脑安装 kubectl。

### 本地终端支持 PowerShell 与真 PTY

- 本地桌面「终端」支持 Windows PowerShell、PowerShell 7 与命令提示符，任务栏终端按钮旁的下拉箭头可切换，默认优先 PowerShell，并记住上次选择。
- Windows 本地终端改用 pty4j 提供伪终端（优先 winpty，ConPTY 兜底），支持提示符、颜色高亮、Tab 补全、方向键历史、Ctrl+C、全屏 TUI 与窗口缩放；ConPTY / winpty 都不可用时命令提示符回退管道模式。
- Linux / macOS 继续优先使用 `script` 分配 PTY；本地终端仍只接受本机回环连接并校验浏览器 Origin。
- 新增本机 Shell 列表接口与 `deepshell.local-shell.default` 配置项，自定义 Shell 路径仍可通过 `deepshell.local-shell.command` 指定。

### 内置 Kafka 与 MongoDB 管理器

- Kafka 管理器：支持 PLAINTEXT / SSL / SASL_PLAINTEXT / SASL_SSL（PLAIN、SCRAM-SHA-256 / SHA-512），集群与 Broker 概览、主题创建 / 删除 / 增加分区、分区位点与配置、按分区 / 最新 / 最早 / 指定位点拉取消息、消息发送与 Headers、消费组状态与堆积检查。
- MongoDB 管理器：支持单机 / 多地址（副本集）、SCRAM-SHA-256 / SCRAM-SHA-1 / PLAIN 认证与 TLS，数据库与集合浏览、JSON 查询 / 排序 / 投影 / 分页、文档新增 / 编辑 / 删除、索引管理、集合统计与命令控制台。
- 两个插件均含官方签名 ZIP、内置插件市场入口与图标；连接凭据由服务端加密保存，前端不会拿到明文。

### Electron 桌面壳（实验）

- 新增 `electron/` 桌面壳：复用现有页面与 Java 后端，负责启动 Java、等待端口就绪、加载窗口并在关闭窗口时回收 Java 进程。
- 关闭 Java 侧自动打开浏览器、托盘、协议注册与自动更新，避免与 Electron 重复。
- 当前为开发版壳，尚未内置 JRE、安装包和自动更新；发布级安装包后续再补 jlink 运行时与签名。

### 上传冲突策略、终端链接与任务提醒

- 上传、批量分发与跨服直传支持**覆盖 / 跳过 / 自动重命名**冲突策略。
- 终端输出支持 Ctrl+点击 URL、IP:端口与绝对路径，直接打开浏览器、复制地址或在资源管理器中定位。
- 后台任务完成增加未读点、标题角标与浏览器通知；关闭忙碌标签前会确认，并支持恢复最近关闭的标签。

## 优化

- 本地终端启动日志会记录所选 Shell 与 conpty 模式，便于排查环境问题。
- 容器插件对命令输出设置大小上限与超时：镜像拉取最长 10 分钟，一次性命令最长 3 分钟，日志 / 列表使用较短超时。
- 插件连接列表按最近使用时间排序，删除连接时同步释放关联会话。

## 升级说明

- Windows 绿色版：下载 `deepshell-1.8.0-windows-x64-portable.zip`，可同时下载同名 `.sha256` 校验文件；解压后双击 `DeepShell.exe`。
- 传统分发包：下载 `deepshell-1.8.0.zip`，需要本机安装 JDK 8+；Windows 双击 `start.cmd`，Linux 执行 `./start.sh`。
- 应用内自动更新只接受带 `.sha256` 的绿色版 ZIP；升级会保留 `data/` 目录与 `application.yml`，不会影响连接、密码、插件和 AI 配置。
- 容器与集群管理器安装或更新后需重启 DeepShell；Docker 功能需要 docker CLI，Kubernetes 功能需要 kubectl。
