# AI Engineering Platform

基于 Claude Code 的 AI 辅助工程平台，为主系统提供智能化开发、测试、部署能力。

## 项目简介

本平台通过 Skill 体系将常见的开发流程自动化，包括 Bug 修复、新功能开发、学校部署、数据库迁移、系统巡检等。同时提供 Web UI 界面，方便团队成员使用。

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
