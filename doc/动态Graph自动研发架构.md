# 动态 Graph 自动研发架构

## 1. 产品定位

AI Platform 不是提示词生成器，也不是要求用户理解固定阶段的项目管理工具。它是“一人前沿实验室”的研发控制面：用户提交目标、边界和验收标准，平台把任务编译为动态执行图，Codex 通过 MCP 领取节点、调度子智能体、执行研发工作并回写证据；平台根据依赖和门禁自动继续、返工或请求人工决策。

```text
Task Contract -> Graph Planner -> Codex Supervisor -> MCP Nodes
      ^                                      |
      |         Evidence / Gate / Failure    |
      +--------------------------------------+
```

最终验收始终由人完成。Codex 可以执行技术节点、追加证据和评估技术门禁，不得调用人工验收接口。

## 2. 四层关系

| 层级 | 平台中的真实职责 |
|---|---|
| Prompts | 单个 Graph 节点的输入契约，不是产品主入口 |
| Loops | 节点执行、证据验证、失败回退和重新执行 |
| Swarms | Codex 主控按节点需要创建的并行子智能体 |
| Graphs | 平台保存的节点、依赖、状态与动态扩展关系 |

Graph 不等于固定流水线。任务类型、范围关键词和执行发现共同决定节点：小型后端缺陷不生成 UI 节点；涉及页面、接口和数据的需求可以并行生成前端、后端和数据节点；执行中发现新的必要工作时可以扩展子节点。

## 3. 运行边界

### 平台负责

- 保存任务契约、Graph、节点依赖、执行者租约、事件和证据。
- 计算哪些节点可并行运行。
- 把失败节点及其下游恢复为返工状态。
- 在业务歧义、高风险操作和最终验收前暂停。
- 通过 Codex app-server 启动受控的 Codex 主控线程。

### Codex 主控负责

- 通过 `ai-platform-graph` MCP 读取 Graph 并领取可运行节点。
- 在任务复杂且节点可拆分时创建子智能体，不为简单任务强行并发。
- 严格在节点范围和项目工作目录内执行。
- 回写命令、测试、HTTP、浏览器、文件或决策证据。
- 节点失败时回写事实和建议回退节点，不自行掩盖失败。

### 人负责

- 提交目标、范围、不做范围和验收标准。
- 对业务语义、高影响变更和权限升级做决定。
- 查看最终证据并执行人工验收。

## 4. Graph 状态模型

### Graph 状态

`planned -> running -> waiting_human -> running -> completed`

异常分支为 `running -> failed`，用户可以在保留失败证据的前提下重新启动；主动停止进入 `stopped`。

### Node 状态

`pending -> runnable -> running -> completed`

失败为 `running -> failed -> runnable`；需要人拍板为 `running -> waiting_human -> runnable`；不适用节点为 `skipped`。

只有所有依赖为 `completed` 或 `skipped` 时，节点才会进入 `runnable`。领取节点必须写入 workerId 和租约时间，避免多个执行者重复工作。

## 5. MCP 协议

`ai-platform-graph` MCP 暴露以下工具：

| 工具 | 作用 |
|---|---|
| `get_graph` | 获取任务契约、Graph、节点和整体状态 |
| `claim_node` | 原子领取一个可运行节点 |
| `get_node_context` | 获取节点指令、依赖结果、验收标准和项目路径 |
| `append_node_evidence` | 追加节点证据，同时写入任务证据账本 |
| `complete_node` | 完成节点并解锁下游 |
| `fail_node` | 记录失败并将任务送入返工 |
| `expand_graph` | 在执行中增加有依赖约束的子节点 |
| `evaluate_gate` | 用当前任务证据评估技术门禁 |
| `request_human_decision` | 暂停 Graph 并创建人工待确认事项 |

MCP 是 Codex 与平台之间的执行协议。平台启动 Codex 使用本机 `codex app-server`，在单次线程配置中注入 MCP server；不修改用户级 `~/.codex/config.toml`。

## 6. 安全策略

- 默认使用 `workspace-write`，不使用 `danger-full-access`。
- 自动执行只在用户点击“启动自动研发”后发生。
- 工作目录必须来自已登记项目的 `sourcePath`，且必须真实存在。
- MCP 写操作限制到当前 taskId、projectId 和 nodeId。
- 高风险命令、跨工作区写入、外部部署和凭据变更必须转人工确认。
- Codex 退出、MCP 初始化失败或超时均保留运行记录，不能显示为成功。
- `accepted` 和 `archived` 任务不可继续写入 Graph 或证据。

## 7. 与旧流水线的关系

保留旧 Pipeline 作为兼容的底层能力和历史运行入口，但不再作为新任务的控制模型：

- 复用 MCP stdio 包装、HTTP API、SSE/事件、产物扫描、模型适配和记忆召回。
- Task 成为唯一用户入口和事实源。
- Graph Node 替代固定六阶段。
- 节点证据与任务门禁替代“文件存在即完成”。
- 稳定后清理重复的提示词生成、阶段状态和运行记录。

## 8. MVP 完成定义

本轮 MVP 必须满足：

1. 活跃任务可以生成与任务类型相匹配的 Graph。
2. Graph 能计算并行可运行节点、领取节点、完成、失败、扩展和等待人工决策。
3. Codex app-server 可以在任务项目目录启动，并通过运行时注入的 MCP 获取 Graph。
4. 页面可以启动或停止自动研发，并显示 Graph、节点、执行者和失败事实。
5. 构建、API 协议、失败回退和真实浏览器入口均有当前运行证据。
6. 不以“已生成提示词”冒充自动执行成功。
