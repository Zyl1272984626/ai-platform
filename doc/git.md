# Git 提交规范

## Commit Message 格式

```
<type>: <简短描述>
```

### Type 说明

| Type | 用途 | 示例 |
|------|------|------|
| `feat` | 新功能 | feat: 设置页面增加环境检测 |
| `fix` | Bug 修复 | fix: 修复 SSE 流连接断开问题 |
| `docs` | 文档更新 | docs: 添加新同事上手指南 |
| `refactor` | 重构（不改功能） | refactor: 测试页面提取公共组件 |
| `chore` | 构建/工具/依赖 | chore: 升级 playwright 到 1.60 |
| `style` | 代码格式调整 | style: 统一缩进为 2 空格 |

### 规则

- 描述用中文
- 不超过 50 字
- 一条 commit 做一件事

---

## 分支策略

| 分支 | 用途 |
|------|------|
| `main` | 稳定版本，所有 PR 合并目标 |
| `feat/*` | 功能开发，如 `feat/multi-project` |
| `fix/*` | Bug 修复 |

---

## 提交历史

### 2026-06-01 — E2E 多项目 + 页面自动发现（本轮）

**改动范围**：7 个文件修改 + 1 个新建，共 ~340 行

| 文件 | 改动 |
|------|------|
| `server/src/services/page-discovery.ts` | 新建，页面发现 TS 服务 |
| `server/src/routes/projects.ts` | 发现 API 改为 SSE 流式 |
| `server/src/services/test-runner.ts` | E2E 从项目配置驱动 |
| `server/package.json` | 添加 playwright 依赖 |
| `web/src/api/projects.ts` | discoverProject SSE 流式接收 |
| `web/src/views/SettingsView.vue` | 项目卡片增加发现按钮+进度 |
| `web/src/views/TestView.vue` | E2E 增加项目选择器+页面集联动 |
| `e2e-test/src/index.js` | 从外部 JSON 读页面，支持多项目 |
| `doc/E2E/E2E多项目页面自动发现方案.md` | 更新实施状态 |

**建议 commit message**：

```
feat: 多项目页面自动发现 — 发现服务+SSE进度+项目选择器+知识库骨架
```

或拆成多条：

```
feat: 新建 page-discovery.ts 页面发现服务，支持 SSE 进度推送
feat: test-runner 改为项目配置驱动，动态构建 E2E 测试 prompt
feat: TestView 增加项目选择器和页面集联动
feat: index.js 改为从 platform-config.json 读取页面列表
feat: 发现页面时自动生成 page-context.json 知识库骨架
```

### 2025-05-29 — 多项目基础架构 (commit 988be299)

- config.ts 多项目配置 + 迁移
- projects.ts 项目 CRUD + 连通性检测
- SettingsView.vue 项目管理 UI
- api/projects.ts 前端 API 封装
- discover.js 页面发现脚本验证
