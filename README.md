# AI Engineering Platform

基于 Claude Code 的 AI 辅助工程平台，面向风速科技主系统。

## 快速开始

```bash
# 安装 Server 依赖
cd server && npm install

# 安装 Web 依赖
cd ../web && npm install

# 启动 Server（端口 3100）
cd ../server && npm run dev

# 启动 Web UI（端口 3200）
cd ../web && npm run dev
```

访问 http://localhost:3200

## 项目结构

```
ai-platform/
├── server/          ← API 服务 (Node.js + Agent SDK)
├── web/             ← Web UI (Vue3)
├── skills/          ← Skill 库
│   ├── scenes/      ← 场景型（用户直接使用）
│   └── capabilities/ ← 能力型（被场景型调用）
└── data/            ← 数据（学校注册表、工作流定义、模板）
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

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | API 服务端口 | 3100 |
| PROJECT_ROOT | 主系统目录 | C:/FengSuKeJi/agent |
