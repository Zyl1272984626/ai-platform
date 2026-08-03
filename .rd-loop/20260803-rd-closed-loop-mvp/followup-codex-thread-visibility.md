# Codex 自动研发线程侧边栏可见性

## 问题

平台通过 `thread/start` 成功创建并持久化了 Codex thread，但未设置 `thread.name`。任务库存中可读取，Codex 左侧边栏没有稳定展示。

## 修复

- `thread/start` 继续使用 `ephemeral: false`。
- 取得 `threadId` 后、启动 turn 前调用 `thread/name/set`。
- 名称统一为 `[自动研发] 任务标题`，压缩空白并限制为 80 个字符。
- 命名失败时不继续启动 turn，避免静默生成无法识别的自动任务。

## 验证结果

- 后端 `npm run build`：通过。
- 前端 `npm run build`：通过，4314 modules transformed。
- 现有 thread `019fc715-79f6-77b3-b8ce-4f552778144a` 已补名为 `[自动研发] Codex Graph MCP 只读冒烟验证`，重新读取时 `title` 不再为 `null`。
- 新建临时自动研发任务后，thread `019fc72b-7854-7693-8f78-f7b1203378e4` 在 turn 启动时已经具有 `[自动研发] ...` 用户可见名称，证明默认命名链路生效。
- 临时任务与临时验证 thread 已停止并归档，不保留为日常任务数据。

## 判定

`ACCEPTED`：以后由平台启动的非临时 Codex thread 会自动命名并进入对应项目侧边栏；历史无标题冒烟 thread 已修复。
