# 贡献指南

感谢你愿意为 DeepShell 贡献代码、文档或问题反馈。

## 提交前

1. **先开 Issue 讨论**：新功能、较大重构、协议或架构调整，请先通过 Issue 说明动机和方案，避免做完后因方向不一致被拒。
2. **一个 PR 只做一件事**：不要把无关的格式化、重命名和功能改动混在一起。
3. **不要提交敏感信息**：真实服务器地址、账号、密码、私钥、API Key、个人数据目录等一律不要进入提交。调试用的 `application.yml` 改动也不要提交。
4. **不要提交构建产物**：`target/`、`dist/` 下的运行数据、日志、数据库等由 `.gitignore` 排除，请勿强制加入。

## 开发环境

- JDK 8+
- Maven 3.6+
- 建议使用 IntelliJ IDEA 直接运行 `DeepShellApplication`

```bash
# 编译并打包（同时生成分发包 target/deepshell-1.0.0.zip）
mvn -DskipTests package

# 运行测试
mvn test

# 直接运行 jar
java -jar target/deepshell.jar
```

启动后访问 <http://127.0.0.1:18080>。开发模式数据目录默认为 `~/.deepshell`。

## 代码风格

- 保持与现有代码一致的命名、缩进和注释风格，不要对无关文件做大规模格式化；
- 后端遵循现有的 Controller / Service / Repository 分层，前端改动尽量复用已有组件与样式；
- 涉及终端、SFTP、AI 执行等高风险路径时，注意命令转义、路径校验和权限边界，不要引入命令注入或路径穿越；
- 修改用户可见行为时，同步更新 README 中的功能说明。

## 提交信息

使用中文，沿用现有风格：

```
feat: 增加 xxx 功能
fix: 修复 xxx 问题
docs: 更新 xxx 文档
refactor: 重构 xxx
```

## 贡献者许可协议（CLA）

由于项目采用 AGPL-3.0 与商业授权并行的双许可模式，**所有代码贡献都需要同意 [CLA.md](CLA.md)**。

提交 PR 时，请在 PR 描述中勾选 CLA 确认项，或评论：

```
I have read the CLA and agree to its terms.
```

未确认 CLA 的 PR 无法合并。你仍然保留自己贡献部分的版权，CLA 只是授予项目方将其用于商业授权的权利。

## 安全问题

发现安全漏洞请不要公开提交 Issue，直接发送邮件至 2427746718@qq.com，并在邮件中说明复现步骤和影响范围。
