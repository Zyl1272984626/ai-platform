# 动态 Graph + Codex MCP 自动研发跟进记录

## 本轮契约

- 目标：把任务页从“复制执行提示词”升级为平台持有状态、Codex 通过 MCP 领取节点并回写证据的自动研发闭环。
- 范围：动态 Graph 规划与状态机、Graph MCP、Codex app-server 运行器、任务 API、任务页控制与可视化、架构文档。
- 不做：执行 Agent 代替人工验收、修改全局 Codex MCP 配置、自动部署或扩大目标项目写入权限。
- 完成条件：前后端构建通过；Graph 协议能验证证据门禁、重试和依赖解锁；真实 Codex 能通过运行时 MCP 完成一张图；本地任务页能展示并控制结果。

## 失败与回退

1. 初次真实运行使用 WindowsApps 中的 `codex.exe`，子进程启动返回 `spawn EPERM`。
2. 未降低系统权限，也未修改全局 PATH/MCP 配置；运行器改为优先解析 npm 安装包内的官方 vendor binary。
3. 重试后成功启动 app-server，返回 threadId 与 turnId，并开始调用 `ai-platform-graph` MCP。

## Graph 协议验证

- 临时研究任务生成 4 个节点，首批两个节点并行变为 `runnable`。
- 无证据调用 `complete_node` 返回 HTTP 400。
- 写入证据后节点可完成；retryable 失败会增加 `retryCount` 并重新变为 `runnable`。
- 两个前序节点完成后，汇总节点自动解锁；最终 4/4 节点完成，Graph 进入 `completed`。

## 真实 Codex + MCP 验证

- 临时任务：`6f32bfa2-017e-46eb-8bc0-27a049b27bf5`。
- Graph：`8906d545-ab41-4f68-81cb-0927123010d1`。
- Codex thread：`019fc715-79f6-77b3-b8ce-4f552778144a`。
- Codex turn：`019fc715-c40b-7271-9421-7afd6dd6ea04`。
- 结果：`source-research`、`code-research`、`synthesis`、`review` 均由 `codex-8906d545` 领取并完成，每个节点至少回写 1 条证据；Graph 与 Worker 最终均为 `completed`。
- 写入边界：该冒烟任务只读检查 `C:\FengSuKeJi\agent\README.md`。终态 SHA-256 与前次一致，文件级 worktree/index diff 均为空；目标仓库原有大量存量改动未归因于本次运行。

## 页面验证

- 路由：`http://127.0.0.1:3200/tasks?task=6f32bfa2-017e-46eb-8bc0-27a049b27bf5`。
- 可见：启动自动研发按钮、4/4 动态执行图、Worker 完成状态、threadId、节点依赖、执行角色、执行者和证据数量。
- 浏览器控制台错误：0。
- 页面横向溢出：否。
- 人机边界：技术 Graph 完成后任务仍等待“提交验收”，自动 Worker 不调用验收接口。

## 构建证据

- `server: npm run build`：通过。
- `web: npm run build`：通过，4314 modules transformed。

## 判定

`ACCEPTED`：动态 Graph、Codex app-server、运行时 MCP 注入、证据门禁和任务页已形成可运行的 MVP 闭环。旧 Pipeline 保留为兼容执行能力，不再作为新任务的主控制模型。
