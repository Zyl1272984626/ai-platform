# AI Engineering Platform

基于 Claude Code 的 AI 辅助工程平台，为主系统提供智能化开发、测试、部署能力。

## 项目简介

本平台通过 Skill 体系将常见的开发流程自动化，包括 Bug 修复、新功能开发、学校部署、数据库迁移、系统巡检等。同时提供 Web UI 界面，方便团队成员使用。

平台还包含**多平台接力开发工作台**（`/pipelines` 页面），支持 ZCode / ClaudeCode / Codex 三种底座引擎，通过 MCP 协议让 AI 自动获取任务上下文、管理产物、推进质量门。详见下方[接力开发与 MCP 对接](#接力开发与-mcp-对接)。

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

启动后打开浏览器访问 http://localhost:3200/settings 完成路径和端口配置。

访问 http://localhost:3200

### Docker 部署

```bash
docker-compose up -d
```

## 项目结构

```
ai-platform/
├── server/            ← API 服务 (Node.js + TypeScript)
├── web/               ← Web UI (Vue3 + Naive UI)
├── skills/            ← Skill 库
│   ├── scenes/        ← 场景型 Skill（用户直接使用）
│   ├── capabilities/  ← 能力型 Skill（被场景型调用）
│   └── tests/         ← 测试型 Skill
├── e2e-test/          ← E2E 页面测试 (Playwright)
├── data/              ← 配置数据（学校注册表、工作流定义）
├── docker-compose.yml ← Docker 编排
└── .env.example       ← 环境变量模板
```

## 核心能力

| 命令 | 说明 |
|------|------|
| `/resolve-bug BUG-123` | Bug 全流程修复 |
| `/deploy-school` | 新学校一键部署 |
| `/new-feature 需求描述` | 新功能全流程开发 |
| `/test-agent agentId userXgh` | Agent 自动化测试 |
| `/daily-check` | 日常系统巡检 |
| `/migrate-db dameng` | 数据库兼容性迁移 |

## 接力开发与 MCP 对接

平台的 `/pipelines` 页面提供**多平台接力开发工作台**，把一个需求拆成多个阶段（需求澄清 → 代码发现 → 设计 → 实现 → 验证 → 交付），每个阶段有独立的产物文件和质量门。

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
