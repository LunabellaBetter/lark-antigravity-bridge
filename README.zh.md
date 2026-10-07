# lark-antigravity-bridge

一个把 **飞书 / Lark** 与本地 AI 编程 Agent 打通的桥接项目，并在 `lark-channel-bridge` 基础上增加了 **Google Antigravity CLI（`agy`）** 支持。

这个 fork 保留 Claude Code / Codex CLI 的主要能力，同时补充 Antigravity 的会话追踪、headless 权限处理、Remote Control 对话直达链接，以及更适合手机远程使用的工作流。

> **用手机通过飞书 / Lark，直接调用运行在自己电脑上的本地 AI Agent。**
>
> 这个 fork 增加了 Google Antigravity CLI 支持，包括 conversation 追踪、headless 权限处理，以及直达对应 Antigravity conversation 的 Remote Control 链接。

[English README](./README.md)

## 主要能力

- 飞书 / Lark 消息可转发给本机 Claude Code、Codex CLI 或 Antigravity CLI。
- 可以用多个 profile 分别运行不同 Agent。
- 可直接在飞书里用 `/cd`、`/ws` 切换和保存项目。
- Antigravity 的 `conversation_id` 会进入 bridge 会话状态。
- Antigravity headless 权限拒绝不会静默丢失。
- bridge 可以自动发现当前 Remote Control 实例并生成对应 conversation 的直达链接。
- 提供脱敏版 `permissions.allow` 示例。
- 网站开发场景可在明确白名单下运行 build、preview、smoke test、Playwright 等验证。

## 前置条件

- Node.js **>= 20.12.0**
- 一个飞书 / Lark PersonalAgent 应用
- 本机至少安装并登录一个 Agent：
  - Claude Code：`claude`
  - Codex CLI：`codex`
  - Google Antigravity CLI：`agy`（本 fork 支持）

## 从本 fork 安装 / 开发

```bash
git clone https://github.com/LunabellaBetter/lark-antigravity-bridge.git
cd lark-antigravity-bridge
pnpm install
pnpm build
```

本地运行：

```bash
node bin/lark-channel-bridge.mjs run
```

Antigravity：

```bash
LARK_CHANNEL_ANTIGRAVITY_BIN=/path/to/agy \
node bin/lark-channel-bridge.mjs run --agent antigravity
```

## 多 profile 与独立后台服务

后台服务按 profile 独立注册。每个 profile 维护自己的应用凭据、会话、工作目录状态和日志。

```bash
lark-channel-bridge start --profile claude --agent claude
lark-channel-bridge start --profile codex --agent codex
lark-channel-bridge start --profile antigravity --agent antigravity
```

平台映射：

- macOS：launchd 用户服务
- Linux：systemd 用户服务
- Windows：Task Scheduler，并通过 `.cmd` wrapper 启动

常用 profile 管理命令：

```bash
lark-channel-bridge profile export <name>
lark-channel-bridge profile export <name> --include-secrets --yes
lark-channel-bridge profile remove <name>
lark-channel-bridge profile remove <name> --purge --yes
```

## 工作目录

每个 profile 可以通过 `workspaces.default` 设置默认工作目录。

```json
{
  "workspaces": {
    "default": "/Users/yourname/path/to/project"
  }
}
```

## 飞书常用命令

| 命令 | 作用 |
|---|---|
| `/status` | 查看 profile、agent、cwd、session、运行状态 |
| `/cd <path>` | 切换工作目录 |
| `/ws list` | 查看工作区 |
| `/ws save <name>` | 保存当前 cwd |
| `/ws use <name>` | 切换工作区 |
| `/new` | 新建会话 |
| `/stop` | 停止当前任务 |
| `/help` | 查看帮助 |
| `/invite user @某人` | 允许用户使用 |
| `/remove user @某人` | 移除用户权限 |
| `/invite group` | 允许当前群使用 |
| `/remove group` | 移除当前群 |
| `/invite all group` | 允许 bot 所在全部群 |

## lark-cli 身份策略

每个 profile 使用**当前 profile 的 lark-cli 目录**，从而隔离不同 profile 的个人授权状态。

## 云文档评论

云文档评论按文档权限生效。支持的文档评论中 @bot 后，可以触发对应文档范围内的会话。

## 标准权限配置

Bridge 使用 canonical `permissions` 字段：

```json
{
  "permissions": {
    "defaultAccess": "full",
    "maxAccess": "full"
  }
}
```

旧版 `sandbox` 配置仍可兼容读取，但新配置应使用 `permissions`。

## Antigravity conversation 追踪

Antigravity JSON 输出包含 `conversation_id`。

这个 fork 会把它映射为 bridge 的 `system.sessionId`，并写入 SessionStore，让飞书任务和实际产生结果的 Antigravity conversation 保持关联。

## Remote Control 直达链接

当 Antigravity headless 工具调用因权限不足被拒绝时，bridge 会尝试：

```text
Antigravity 日志
→ 找到当前 Connected 的 Remote Control instance
→ 取得本次 conversation_id
→ 生成直达链接
```

链接格式：

```text
https://antigravity.google.com/r/<instance-id>?p=c%2F<conversation-id>
```

如果无法识别当前 instance，则退回 Antigravity Remote Control 通用入口。

### Headless 权限限制

Antigravity 的 print / headless 模式目前不能停下来等待交互式权限审批。

如果命令没有匹配 `permissions.allow`，工具调用可能被自动拒绝，进程也会结束。

所以 Remote Control 直达链接可以精准打开对应 conversation，但**不能对已经被 headless 自动拒绝的工具调用进行事后审批**。

推荐模型：

```text
可信、低风险命令
→ permissions.allow
→ headless 正常执行

未在白名单中的命令
→ 自动拒绝
→ 飞书返回对应 conversation 的直达链接
```

不建议常规使用：

```text
--dangerously-skip-permissions
```

因为它会自动批准所有工具权限请求。

## Antigravity 脱敏示例配置

示例文件：

```text
examples/antigravity-settings.example.json
```

公开示例：

```json
{
  "permissions": {
    "allow": [
      "command(pwd)",
      "command(ls)",
      "command(ls -la)",
      "command(find . -maxdepth 2 -type f -print)",
      "command(git status)",
      "command(git status --short)",
      "command(git branch --show-current)",
      "command(git diff --stat)",
      "command(git diff --name-only)",
      "command(git log -n 10 --oneline)",
      "command(node --version)",
      "command(npm --version)",
      "command(pnpm --version)",
      "command(python3 --version)",
      "command(pnpm typecheck)",
      "command(pnpm build)",
      "command(pnpm vitest run)",
      "command(npm run build)",
      "command(npm run verify)",
      "command(npx vite build)",
      "command(npx playwright test)"
    ]
  },
  "trustedWorkspaces": [
    "/Users/yourname/path/to/your-project"
  ]
}
```

不要提交自己的真实 Antigravity settings。

## 网站建设与验收工作流

```text
开发
→ build
→ 启动 dev / preview
→ localhost 健康检查
→ 浏览器实际打开
→ DOM / Console / Network 检查
→ Playwright / smoke test
→ 修复
→ 再验证
```

适合加入白名单的类型：

- build / typecheck
- 本地 dev / preview
- localhost 健康检查
- smoke test
- Playwright
- Git 只读检查

不建议全局自动放开：

- `rm`
- 任意 `mv` / `cp`
- 任意外网 `curl`
- 任意 package install
- `env` / `printenv`
- 无限制 shell 执行

## Remote Control daemon

```bash
agy remote-control start --name "My Mac"
```

## 测试与 CI

Antigravity 相关回归测试：

```bash
pnpm vitest run tests/process/antigravity-adapter.test.ts
pnpm vitest run tests/process/antigravity-remote-control.test.ts
pnpm vitest run tests/integration/bot/markdown-stream-startup-failure.test.ts
```

完整检查：

```bash
pnpm test
pnpm typecheck
pnpm build
```

## 隐私与安全

不要提交或公开：

- 飞书 / Lark App Secret
- OAuth Token
- `~/.lark-channel/config.json`
- Antigravity OAuth Token
- Antigravity conversation 数据库
- Remote Control 真实 instance ID
- daemon / bridge 私有日志
- 不希望公开的真实本机路径
- HR、公司、客户或其他敏感数据

公开示例统一使用：

```text
/Users/yourname/path/to/project
<instance-id>
<conversation-id>
```

## 当前 fork 已完成

已实现并完成回归测试：

- Antigravity agent 注册
- Antigravity JSON 解析
- Antigravity profile/runtime 接入
- `conversation_id` 透传
- SessionStore 持久化
- headless 权限拒绝识别
- 飞书错误回传
- Remote Control instance 自动发现
- 当前 conversation 直达链接
- 脱敏权限示例
- process / integration 测试

## License

MIT
