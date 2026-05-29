# 新同事上手指南

本文档帮助你从零开始搭建 AI 工程平台的开发环境。

---

## 前置条件

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | 20+ | 推荐 LTS 版本 |
| Git | 2.x | 代码管理 |
| Claude Code CLI | 最新版 | AI 功能必需，见下方安装步骤 |
| 主系统代码 | develop-rebuild 分支 | AI Platform 依赖主系统运行 |

---

## 第一步：Clone 代码

```bash
# AI Platform（本项目）
git clone https://github.com/Zyl1272984626/ai-platform.git

# 主系统（如尚未 clone）
git clone <主系统仓库地址> ../agent
```

建议目录结构：
```
FengSuKeJi/
├── agent/          ← 主系统
└── ai-platform/    ← 本项目
```

---

## 第二步：安装依赖

```bash
# 后端
cd ai-platform/server
npm install

# 前端
cd ../web
npm install

# E2E 测试（可选）
cd ../e2e-test
npm install
npx playwright install chromium
```

> 注意：`@anthropic-ai/claude-code` 包约 75MB，下载可能需要几分钟。

---

## 第三步：安装 Claude Code CLI

AI Platform 的 Agent 测试和 E2E 测试通过 Claude Code SDK 调用 AI，需要本机安装 CLI。

```bash
# 安装
npm install -g @anthropic-ai/claude-code

# 登录（会弹出浏览器授权）
claude login
```

验证安装成功：
```bash
claude --version
```

> 如果公司网络无法直接访问 Anthropic API，请联系运维配置代理。

---

## 第四步：配置环境变量

```bash
cd ai-platform
cp .env.example .env
```

编辑 `.env`，**必须修改的项**：

```env
# 主系统路径（改成你自己的实际路径）
PROJECT_ROOT=C:/FengSuKeJi/agent
```

其他项（禅道、企微、邮件等）按需填写，不填不影响基本运行。

---

## 第五步：启动服务

```bash
# 终端1 - 后端（端口 3100）
cd ai-platform/server
npm run dev

# 终端2 - 前端（端口 3200）
cd ai-platform/web
npm run dev
```

访问 http://localhost:3200 看到页面即启动成功。

---

## 第六步：页面配置

首次启动后，打开浏览器访问 **http://localhost:3200/settings**（或左侧导航点"设置"）：

1. 修改**项目根目录**为你本机主系统的实际路径
2. 修改其他路径和端口配置
3. 点击 **"检测配置"**，确认全部通过
4. 点击 **"保存配置"**

配置保存在 `data/platform-config.json`，保存后立即生效，无需重启。

---

## 第七步：MCP Server 配置（可选）

AI Platform 的部分 Skill 依赖 MCP Server，需要在 Claude Code 全局配置中添加。

配置文件位置：`~/.claude/settings.json`（用户目录下）

需要的 MCP Server：

| MCP Server | 用途 | 安装方式 |
|------------|------|----------|
| mcp_server_mysql | 数据库查询 | 联系运维获取安装包和配置 |
| web_reader | 网页内容读取 | `npm install -g web-reader-mcp` |
| 4_5v_mcp | 图片分析 | 联系运维获取安装包和配置 |

示例配置（添加到 `~/.claude/settings.json` 的 `mcpServers` 字段）：

```json
{
  "mcpServers": {
    "mcp_server_mysql": {
      "command": "node",
      "args": ["path/to/mcp_server_mysql/index.js"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASSWORD": "your_password",
        "MYSQL_DATABASE": "AGENT_PORTAL"
      }
    }
  }
}
```

> 不配置 MCP Server 也能用 AI Platform 的基本功能，只有部分 Skill 会受限。

---

## 验证清单

启动后逐项检查：

- [ ] http://localhost:3200 页面正常打开
- [ ] 设置页面路径检测全部绿色
- [ ] 左侧导航底部"服务正常"绿色
- [ ] `claude --version` 能正常输出版本号
- [ ] （可选）测试页面跑一次 API 测试全绿

---

## 常见问题

### Q: `npm install` 很慢或失败
配置 npm 镜像：
```bash
npm config set registry https://registry.npmmirror.com
```

### Q: 启动后端报错 `query is not a function`
Claude Code CLI 未安装或未登录。执行：
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### Q: E2E 测试提示"主系统未启动"
E2E 测试需要主系统的前端（5173）和后端（9998）在运行。先启动主系统再跑 E2E。

### Q: 设置页面保存后路径还是不对
检查 `data/platform-config.json` 文件内容是否正确更新。环境变量 `PROJECT_ROOT` 优先级高于页面配置。

---

## 项目结构速览

```
ai-platform/
├── server/            ← API 服务（Node.js + TypeScript + Express）
│   ├── src/
│   │   ├── routes/    ← API 路由定义
│   │   └── services/  ← 业务逻辑（测试执行、工作流引擎、配置管理）
│   └── package.json
├── web/               ← Web UI（Vue 3 + Vite + Naive UI）
│   ├── src/
│   │   ├── views/     ← 页面组件
│   │   ├── api/       ← API 调用层
│   │   └── components/ ← 公共组件
│   └── package.json
├── skills/            ← Skill 库（给 Claude Code 的自动化指令）
├── e2e-test/          ← E2E 测试套件（Playwright）
├── data/              ← 配置数据和测试记录
├── docker-compose.yml ← Docker 部署
└── doc/               ← 文档
```
