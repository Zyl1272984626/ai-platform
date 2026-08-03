# 证据驱动 AI 研发闭环平台

把一个真实需求推进为有证据、可回退、可验收的系统增量。Codex、Claude Code、Skills、流水线、测试和记忆是执行能力，不是用户必须理解的主流程。

## 项目简介

平台的主入口是**研发任务**。每项任务包含原始需求、目标、范围、验收标准、人工决策、当前证据、动态门禁和验收结论。门禁失败会返回对应节点；门禁通过必须关联当前任务证据；删除采用软归档以保留审计链。

项目代码、Markdown、数据库和正式决策仍是业务事实来源。平台只保存项目基线索引、任务运行状态和证据，不复制一套新的业务设计事实库。

## 技术栈

- **Server**: Node.js + TypeScript + Express
- **Web**: Vue 3 + Vite + Naive UI
- **测试**: Playwright E2E
- **部署**: Docker Compose

## 快速开始

> 首次使用？请阅读 **[新同事上手指南](doc/ONBOARDING.md)**，包含完整的从零搭建步骤。

```bash
# 1. 安装依赖
cd server && npm install
cd ../web && npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入实际配置

# 3. 启动 Server（端口 3100）
cd server && npm run dev

# 4. 启动 Web UI（端口 3200）
cd web && npm run dev
```

启动后打开 http://localhost:3200。首次使用先在 `/settings` 配置项目，再从 `/tasks` 建立研发任务。

### Docker 部署

```bash
docker-compose up -d
```

## 项目结构

```
ai-platform/
├── server/            ← API 服务 (Node.js + TypeScript)
├── web/               ← Web UI (Vue3 + Naive UI)
├── .rd-loop/          ← 当前研发闭环的任务状态与证据清单
├── skills/            ← Skill 库
│   ├── scenes/        ← 场景型 Skill（用户直接使用）
│   ├── capabilities/  ← 能力型 Skill（被场景型调用）
│   └── tests/         ← 测试型 Skill
├── e2e-test/          ← E2E 页面测试 (Playwright)
├── server/data/       ← 项目索引、任务、运行与证据数据
├── docker-compose.yml ← Docker 编排
└── .env.example       ← 环境变量模板
```

## 核心闭环

1. 选择项目并保留用户原始需求。
2. 明确本轮目标、范围、不做范围和可观察验收标准。
3. 根据任务类型生成动态门禁，而不是套用固定阶段。
4. 记录命令、测试、请求、查询、浏览器操作和人工决策等事实证据。
5. 门禁失败进入 `rework`、`blocked` 或 `needs_confirmation`，修正后继续。
6. 所有必需门禁通过后提交人工验收，验收通过形成独立证据。
7. 已完成任务可软归档，数据和证据继续保留。

核心研发导航包含研发任务、项目基线、证据与验收、系统设置；原有校园管理作为独立运营配置保留在 `/schools`，Pipeline、Test、Memory、Skills、Workflow 和工程对话收纳在 `/tools` 高级工具页。

任务启动后可点击“启动自动研发”。平台会把任务契约编译为动态 Graph，通过 Codex app-server 启动主控线程，并在该线程中注入 `ai-platform-graph` MCP。Codex 领取可运行节点、按需创建子智能体并回写技术证据；平台根据依赖和门禁自动继续、返工或请求确认。人工验收不能由执行 Agent 代替。

完整架构和协议见 [`doc/动态Graph自动研发架构.md`](doc/动态Graph自动研发架构.md)。旧 Pipeline 继续作为底层兼容能力和历史入口，不再作为新研发任务的控制模型。

## 高级能力：接力开发与 MCP 对接

平台保留 `/pipelines` 多平台接力工作台，供已有运行和底层执行使用。新的研发工作应先建立 `/tasks` 任务契约，再按任务需要调用接力、测试、记忆或 Skills，避免固定阶段替代真实门禁。

### 三种底座引擎

| 引擎 | 阶段数 | 适用场景 |
|---|---|---|
| **ZCode**（默认） | 9 阶段 | 在 ZCode 里干活，GLM 作为总控 |
| ClaudeCode | 9 阶段 | ClaudeCode/GLM 作为总控 |
| CodeX | 10 阶段 | Codex/ChatGPT 作为总控，多一个 GLM 设计审阅 |

### MCP 对接（让 AI 自动获取任务）

配置后，在 ZCode/ClaudeCode/Codex 里说「**启动接力任务做 XX**」，AI 会自动创建任务、拆分阶段、干活、推进——不需要在网页和 CLI 之间来回切换。

**配置方法**（一次性）：编辑 `~/.zcode/cli/config.json`（ZCode）的 `mcp.servers`，加：

```json
"ai-platform-relay": {
  "type": "stdio",
  "command": "node",
  "args": ["C:/FengSuKeJi/ai-platform/server/dist/mcp/relay-server.js"],
  "env": { "AI_PLATFORM_BASE": "http://localhost:3100" }
}
```

配置完重启 ZCode 即可。也可在 `/pipelines` 页面一键安装 relay-dev Skill（让 AI 自动识别「启动接力任务」关键词）。

**完整配置步骤、工具列表、使用示例、排障**：参见 [doc/mcp-relay-setup-guide.md](doc/mcp-relay-setup-guide.md)

### 相关文档

- [MCP 对接完整指南](doc/mcp-relay-setup-guide.md) — 配置步骤、7 个工具说明、示例、排障
- [接力工作台设计方案](doc/AI研发接力工作台设计方案.md) — 整体设计思路
- [接力上下文同步设计](doc/relay-context-auto-sync-design.md) — MCP + CONTEXT.md 架构
- [交接文档（P0-P3）](doc/ai-delivery-relay-workbench-handoff-p0-p3.md) — 功能落地记录

## 环境变量

复制 `.env.example` 为 `.env`，根据实际情况填写：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | API 服务端口 | 3100 |
| PROJECT_ROOT | 主系统目录 | C:/FengSuKeJi/agent |
| ZENTAO_URL | 禅道地址 | - |
| WECHAT_WEBHOOK | 企业微信机器人 Webhook | - |

完整变量说明参见 `.env.example`。

## License

Private - Internal Use Only
