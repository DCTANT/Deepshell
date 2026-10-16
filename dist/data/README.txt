本目录存放 DeepShell 运行数据（首次启动自动生成）：

  db/deepshell.db     连接与快捷命令数据库（SQLite）
  secret.key          本机加密密钥（删除后已保存的连接密码无法解密）
  ai.properties       AI 接口配置（API 地址 / Key / 模型）
  network.properties  局域网访问开关
  bg/                 终端背景图片
  logs/               运行日志

更换机器或做备份时，拷贝整个 data 目录即可迁移全部数据。
