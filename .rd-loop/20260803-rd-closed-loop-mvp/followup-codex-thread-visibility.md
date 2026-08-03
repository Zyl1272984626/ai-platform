# Codex 自动研发线程侧边栏可见性

## 问题

平台通过 `thread/start` 成功创建并持久化了 Codex thread，但最初未设置 `thread.name`。补名后任务库存中可读取，桌面端左侧仍未稳定展示；用桌面端把该 thread 置顶后立即出现，证明侧边栏可见集合还依赖 `isPinned` 元数据。

## 修复

- `thread/start` 继续使用 `ephemeral: false`。
- 取得 `threadId` 后、启动 turn 前调用 `thread/name/set`。
- 名称统一为 `[自动研发] 任务标题`，压缩空白并限制为 80 个字符。
- 平台后端固定依赖支持 `isPinned` 的 Codex `0.146.0`，优先于全局 `0.144.1`。
- 命名后调用 `thread/metadata/update` 写入 `isPinned: true`。
- 命名或置顶失败时不继续启动 turn，避免静默生成无法识别或不可见的自动任务。

## 验证结果

- 后端 `npm run build`：通过。
- 前端 `npm run build`：通过，4314 modules transformed。
- 现有 thread `019fc715-79f6-77b3-b8ce-4f552778144a` 已补名为 `[自动研发] Codex Graph MCP 只读冒烟验证`，重新读取时 `title` 不再为 `null`。
- 新建临时自动研发任务后，thread `019fc72b-7854-7693-8f78-f7b1203378e4` 在 turn 启动时已经具有 `[自动研发] ...` 用户可见名称，证明默认命名链路生效。
- 临时任务与临时验证 thread 已停止并归档，不保留为日常任务数据。
- 本机全局 Codex `0.144.1` 对 `isPinned` 请求返回错误；隔离验证 npm 稳定版 `0.146.0` 的协议 schema 已包含 `ThreadMetadataUpdateParams.isPinned`，因此平台改用项目内版本。
- 使用项目内 Codex `0.146.0` 创建真实 thread `019fc733-b0ce-7b31-8da5-5fb54a3b79ec`，自动名称为 `[自动研发] 自动置顶真实验证`；约 15 秒后桌面端任务清单将它刷新到首位，无需人工调用置顶。
- 该临时平台任务已停止并归档；Codex thread 保留置顶，供用户直接核对侧边栏结果。

## 判定

`ACCEPTED`：平台已固定使用项目内 Codex `0.146.0`，新 thread 会自动命名并写入 `isPinned: true`；桌面端跨进程刷新存在约十几秒延迟，但真实侧边栏任务清单已验证自动出现。
