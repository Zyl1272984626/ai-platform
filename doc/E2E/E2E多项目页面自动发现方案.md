
# E2E 多项目支持 + 页面自动发现方案

## 一、现状问题

### 1.1 只支持单项目

当前系统硬编码了一个目标项目（`C:/FengSuKeJi/agent`，前端 5173，后端 9998）。所有页面路由、登录凭据、scope 定义都写死在代码中，无法测试其他项目。

### 1.2 页面列表手动维护

88 个页面路由分散在三处手动维护：

| 位置 | 问题 |
|------|------|
| `e2e-test/src/index.js` 第13-177行 | 实际运行，改页面必须改代码 |
| `SKILL.md` 第35-61行 | 提示词，和 index.js 不同步 |
| `knowledge/page-context.json` | 知识库，只覆盖 6 页 |

系统改了路由（如删除 /admin 模块），必须手动去三处同步修改。

### 1.3 新项目接入成本高

新同事想测自己的项目，需要：
1. 改 `test-config.json` 的 URL 和凭据
2. 改 `src/index.js` 重写所有页面路由
3. 改 `SKILL.md` 的页面列表
4. 改 `knowledge/page-context.json`

基本等于重写一遍。

---

## 二、改造目标

1. **设置页面支持多项目管理**：添加/编辑/删除多个被测项目
2. **测试页面支持项目选择**：下拉选项目 → 显示该项目的页面集 → 选范围开跑
3. **页面自动发现**：一键探测项目导航结构，自动生成页面集
4. **知识库自动生成**：发现页面时同步生成 page-context.json

---

## 三、页面发现策略（已验证）

### 3.1 策略对比

经演示环境 `https://www.topspeeder.net.cn/agent_audio/` 实测验证：

| 策略 | 原理 | 覆盖率 | 优点 | 缺点 |
|------|------|--------|------|------|
| DOM 链接提取 | `document.querySelectorAll('a')` | 0% | 简单 | Vue SPA 无 `<a>` 标签 |
| 点击遍历侧边栏 | 逐个点击菜单，记录 URL 变化 | ~20% | 模拟用户操作 | 太慢、不可靠、菜单未展开就漏掉 |
| **Vue Router getRoutes()** | `app.__vue_app__.$router.getRoutes()` | **100%** | 一次调用拿全部路由，含 meta 信息 | 需要找到 Vue 实例 |

**结论**：Vue Router `getRoutes()` 是唯一可靠的策略。

### 3.2 双模式发现（已实现）

发现脚本：`e2e-test/src/discover.js`

**模式 A — 源码分析**（需提供源码路径）：
1. 读 `vite.config.ts` 的 `rollupOptions.input`，解析子应用入口名
2. 扫描 `src/pages/*/index.html` 目录，补充入口列表
3. 读每个子应用的 `router/index.js`，提取路由 path/name 定义

**模式 B — 运行时探测**（无需源码）：
1. Playwright 启动浏览器，导航到登录页，填写凭据登录
2. 从登录后 URL 推断部署根路径（如 `/agent_audio/`）
3. 对每个可能的子应用入口（源码分析 + 常见名称），GET 请求探测
4. 通过响应内容判断：HTML 含 `id="app"` → 有效 Vue 应用；含 `"httpCode"` → 未部署
5. 对每个有效入口，`page.evaluate()` 调用 `Vue Router.getRoutes()` 提取全部路由
6. 自动解析动态参数（如 `:businessSystemId`），从当前 URL 提取实际值并展开

### 3.3 演示环境实测结果（2025-05-29）

```
命令：node discover.js --url https://www.topspeeder.net.cn/agent_audio
      --username fskjadmin --password fskj_dst_2023 --source C:/FengSuKeJi/agent
```

#### 源码分析（模式 A）

发现 4 个子应用入口：

| 入口 | 源码路由数 | 演示环境状态 |
|------|-----------|-------------|
| setting-system | 21 | ❌ 未部署 |
| chat | - | ❌ 未部署 |
| setting-app | 39 | ❌ 未部署 |
| index | 11 | ❌ 未部署 |

#### 运行时探测（模式 B）

演示环境实际部署 2 个子应用：

| 子应用 | 路由数 | 标题 | 动态参数 |
|--------|--------|------|---------|
| **web** | 20 | 智能应用开发与管理平台 | `:businessSystemId` = `assistant` |
| **admin** | 27 | 智能应用开发与管理平台-管理端 | 无 |

#### 发现的路由明细

**web 子应用（20 条路由）**：

| 路由 | 标题 | 动态 |
|------|------|------|
| `/index/wss/test` | test | |
| `/agent-list/list` | 智能体列表页面 | |
| `/chat/before` | 智能体会话前置页面 | |
| `/chat/analytics` | 统计分析页面 | |
| `/test/markdown` | Markdown Vue3 测试 | |
| `/meeting/audio-read` | 音频解析 | |
| `/` | - | |
| `/agent-list` | - | |
| `/login` | - | |
| `/chat` | 智能体会话页面 | |
| `/preview` | 配置预览页面 | |
| `/index` | - | |
| `/:businessSystemId/agent/edit-conversation` | 编辑智能体-对话流模式 | ✅ |
| `/:businessSystemId/agent/edit-llm` | 编辑智能体-工作流模式 | ✅ |
| `/:businessSystemId/workflow/design` | 流程设计 | ✅ |
| `/:businessSystemId/agent` | 智能体列表 | ✅ |
| `/:businessSystemId/userAgent` | 智能体列表 | ✅ |
| `/:businessSystemId/plugin` | 插件管理 | ✅ |
| `/:businessSystemId/workflow` | 前端测试页面 | ✅ |
| `/:businessSystemId/analytics` | 会话监控分析 | ✅ |

动态参数自动展开：`:businessSystemId` → `assistant`，如 `/assistant/agent`。

**admin 子应用（27 条路由）**：

| 路由 | 标题 |
|------|------|
| `/sys/storage/file` | - |
| `/sys/code` | - |
| `/sys/config` | - |
| `/sys/database` | - |
| `/sys/storage` | - |
| `/sys/mention` | - |
| `/permission/user` | - |
| `/permission/role` | - |
| `/permission/resource` | - |
| `/base/plugin/` | 流程插件管理 |
| `/base/model-source` | 模型来源管理 |
| `/base/model` | 模型管理 |
| `/base/business-system` | - |
| `/task/list` | 任务管理 |
| `/task/execute` | 任务执行日志 |
| `/task/data-sync-config` | 数据同步任务设置 |
| `/pageFactory/hardcode` | 硬编码配置 |
| `/pageFactory/globalview` | 全局视图 |
| `/pageFactory/common-query` | 通用查询管理 |
| `/pageFactory/page` | 页面配置管理 |
| `/pageFactory/pageContent` | 页面HTML代码检索管理 |
| `/pageFactory/template` | 页面模板配置管理 |
| `/pageFactory/dept` | 页面部门管理 |
| `/permission/` | - |
| `/sys/` | - |
| `/code` | - |
| `/` | - |

#### 自动分组结果（41 个可测试页面）

**web 子应用分组**：

| 分组 | 页面数 | 页面 |
|------|--------|------|
| index | 2 | test, index |
| agent-list | 2 | 智能体列表页面, agentList |
| chat | 3 | 会话前置, 统计分析, 会话页面 |
| test | 1 | Markdown 测试 |
| meeting | 1 | 音频解析 |
| preview | 1 | 配置预览 |
| agent | 3 | 对话流编辑, 工作流编辑, 智能体列表 |
| workflow | 2 | 流程设计, 前端测试页面 |
| userAgent | 1 | 智能体列表 |
| plugin | 1 | 插件管理 |
| analytics | 1 | 会话监控分析 |

**admin 子应用分组**：

| 分组 | 页面数 | 页面 |
|------|--------|------|
| sys | 6 | file, code, config, database, storage, mention |
| permission | 3 | user, role, resource |
| base | 3 | 插件, 模型来源, 模型, 业务系统 |
| task | 3 | 任务管理, 执行日志, 数据同步 |
| pageFactory | 7 | 硬编码, 全局视图, 通用查询, 页面配置, HTML检索, 模板, 部门 |
| code | 1 | code |

### 3.4 关键技术点

1. **部署根路径推断**：登录后 URL 为 `{origin}/{deployRoot}/{subApp}/index.html#/...`，需去掉子应用目录名得到部署根路径。脚本已处理此逻辑。
2. **子应用入口探测**：服务器对所有路径返回 200，需通过响应内容区分：HTML 含 `id="app"` → 有效；JSON 含 `"httpCode"` → 未部署。
3. **动态参数解析**：从当前 URL 的 hash 路径与路由模板匹配，提取 `:paramName` 的实际值，用于展开所有动态路由。

---

## 四、数据模型设计

### 4.1 多项目配置

当前 `PlatformConfig` 只有一个 projectRoot，改为 `projects` 数组：

```typescript
// server/src/services/config.ts

interface TestProject {
  id: string;                    // 唯一标识，如 "agent-main"
  name: string;                  // 显示名称，如 "主系统(Agent)"
  baseUrl: string;               // 前端地址，如 "http://localhost:5173"
  apiBaseUrl: string;            // 后端 API 地址，如 "http://localhost:9998"
  loginUrl: string;              // 登录页，如 "/index/index.html#/login"
  username: string;              // 登录用户名
  password: string;              // 登录密码
  sourcePath?: string;           // 源码路径（可选，用于源码分析增强发现）
  skillPath?: string;            // E2E Skill 路径（可选）
  pageSets: PageSet[];           // 页面集列表（自动发现或手动配置）
  discoveredAt?: string;         // 最近一次发现时间
  discoveryResult?: any;         // 最近一次发现的原始数据
  status: 'active' | 'inactive'; // 是否启用
}

interface PageSet {
  id: string;                    // 如 "admin-sys"
  name: string;                  // 如 "系统管理 (6页)"
  description?: string;          // 描述
  pages: PageConfig[];           // 页面列表
}

interface PageConfig {
  id: string;                    // 如 "admin-sys-code"
  name: string;                  // 如 "代码管理"
  url: string;                   // 完整路径，如 "/admin/index.html#/sys/code"
  path: string;                  // 路由路径，如 "/sys/code"
  description?: string;          // 页面功能描述
}

interface PlatformConfig {
  // ...保留原有字段
  aiPlatformRoot: string;
  e2eDataDir: string;
  apiTestBaseUrl: string;
  // 移除单项目的 projectRoot/mainFrontendPort/mainBackendPort
  // 改为多项目
  projects: TestProject[];
  defaultProjectId: string;      // 默认项目 ID
}
```

### 4.2 存储结构

```
data/
  platform-config.json           # 主配置（含 projects 数组）
  projects/
    {projectId}/
      page-context.json          # 该项目的页面知识库（自动生成）
      discovery-result.json      # 最近一次发现的原始数据
```

---

## 五、页面自动发现机制（已验证方案）

### 5.1 发现流程

```
用户点击"发现页面"
  → 后端调用 Playwright 启动浏览器
  → 导航到项目 loginUrl
  → 填写用户名密码登录
  → 登录成功后，从 URL 推断部署根路径
  → 探测子应用入口：
      已知入口（源码分析或上次发现）+ 常见名称
      GET 请求 → 判断响应内容
  → 对每个有效入口：
      page.evaluate() 调用 Vue Router.getRoutes()
      提取 path, name, title, layout, params
  → 动态参数自动展开（从当前 URL 提取实际值）
  → 按 hash 路径前缀自动分组生成 PageSet[]
  → 保存到项目配置 + 生成 page-context.json 骨架
  → SSE 推送进度
```

### 5.2 后端发现 API

```typescript
// server/src/routes/projects.ts

// 触发页面发现（长任务，用 SSE 推送进度）
POST /api/projects/:id/discover
  → Body: { mode: 'runtime' | 'source' | 'both' }
  → 返回 { taskId: "xxx" }

// SSE 进度流
GET /api/projects/:id/discover/stream
  → 推送 { stage: "login" | "probing" | "extracting" | "grouping" | "done", ... }
```

### 5.3 发现服务核心逻辑

复用已验证的 `discover.js` 逻辑，迁移为 TypeScript 服务：

```typescript
// server/src/services/page-discovery.ts

import { chromium } from 'playwright';

interface DiscoveryOptions {
  mode: 'runtime' | 'source' | 'both';
  sourcePath?: string;
}

interface DiscoveryResult {
  pageSets: PageSet[];
  rawRoutes: Record<string, RouteInfo[]>;
  entries: string[];
  totalPages: number;
}

async function discoverPages(
  project: TestProject,
  options: DiscoveryOptions,
  onProgress?: (stage: string, detail: string) => void
): Promise<DiscoveryResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    // 1. 登录
    onProgress?.('login', '正在登录...');
    await login(page, project);

    // 2. 推断部署根路径
    const { origin, deployRoot } = parseDeployRoot(page.url());
    onProgress?.('probing', `部署根路径: ${origin}${deployRoot}`);

    // 3. 源码分析（可选）
    let knownEntries: string[] = [];
    if (options.sourcePath || project.sourcePath) {
      knownEntries = analyzeSource(options.sourcePath || project.sourcePath!);
      onProgress?.('probing', `源码发现 ${knownEntries.length} 个入口: ${knownEntries.join(', ')}`);
    }

    // 4. 运行时探测子应用入口
    const entries = [...knownEntries, ...COMMON_ENTRIES];
    const validEntries = await probeEntries(page, origin, deployRoot, entries);
    onProgress?.('probing', `有效入口: ${validEntries.join(', ')}`);

    // 5. 对每个有效入口提取 Vue Router 路由
    const routesMap: Record<string, RouteInfo[]> = {};
    for (const entry of validEntries) {
      onProgress?.('extracting', `提取 ${entry} 的路由...`);
      routesMap[entry] = await extractRoutes(page, origin, deployRoot, entry);
    }

    // 6. 分组生成 PageSet
    const { pageSets, totalPages } = groupRoutes(routesMap);
    onProgress?.('done', `发现完成: ${totalPages} 个可测试页面`);

    return { pageSets, rawRoutes: routesMap, entries: validEntries, totalPages };
  } finally {
    await browser.close();
  }
}

// 核心提取函数 — 已验证可行
async function extractRoutes(page, origin, deployRoot, entry) {
  await page.goto(`${origin}${deployRoot}${entry}/index.html`, {
    timeout: 10000, waitUntil: 'networkidle'
  });
  await page.waitForTimeout(2000);

  return page.evaluate(() => {
    const app = document.querySelector('#app');
    if (!app?.__vue_app__) return [];

    const router = app.__vue_app__.config?.globalProperties?.$router;
    if (!router) return [];

    return router.getRoutes().map(r => ({
      path: r.path,
      name: r.name || '',
      title: r.meta?.title || '',
      hasParams: r.path.includes(':'),
    }));
  });
}
```

### 5.4 自动分组规则

根据 hash 路径前缀自动分组（已在 discover.js 中验证）：

| URL 模式 | 分组 ID | 分组名 |
|----------|---------|--------|
| `/admin/index.html#/sys/*` | `admin-sys` | 系统管理 |
| `/admin/index.html#/permission/*` | `admin-perm` | 权限管理 |
| `/admin/index.html#/base/*` | `admin-base` | 基础配置 |
| `/admin/index.html#/task/*` | `admin-task` | 任务管理 |
| `/admin/index.html#/pageFactory/*` | `admin-page-factory` | 页面工厂 |
| `/web/index.html#/agent-list/*` | `web-agent-list` | 智能体列表 |
| `/web/index.html#/chat/*` | `web-chat` | 智能体会话 |
| `/web/index.html#/:bsId/agent/*` | `web-agent` | 智能体管理 |
| `/web/index.html#/:bsId/workflow/*` | `web-workflow` | 流程管理 |
| `/setting-system/index.html#/*` | `setting-system` | 系统设置 |
| `/setting-app/index.html#/{appId}/*` | `setting-app-{appId}` | 应用设置 |

规则：取 hash 路径的第一级非动态段作为分组 ID。动态段（`:param`）跳过，取下一级。

---

## 六、前端改动

### 6.1 设置页面 — 项目管理

在现有设置页面新增"项目管理"区块：

```
┌─────────────────────────────────────────────────┐
│ 项目管理                              [+ 添加项目] │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ 主系统 (Agent)              ● 默认  ✅ 活跃  │ │
│  │ https://www.topspeeder.net.cn/agent_audio   │ │
│  │ 页面集: 10+6 个 | 页面: 41 | 发现于: 05/29  │ │
│  │        [编辑] [发现页面] [检测连通性]         │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ 禅道系统                     ○ 非默认 ✅活跃 │ │
│  │ http://192.168.1.100:8080                   │ │
│  │ 页面集: 5 个 | 页面: 42 | 发现于: 05/27     │ │
│  │        [编辑] [发现页面] [检测连通性]         │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  [+ 添加项目]                                    │
└─────────────────────────────────────────────────┘
```

**添加/编辑项目弹窗**：
- 项目名称（必填）
- 前端地址 baseUrl（必填）
- 后端 API 地址 apiBaseUrl（必填）
- 登录页路径 loginUrl（必填，默认 `/login`）
- 用户名 / 密码（必填）
- 源码路径 sourcePath（可选，用于增强发现）
- Skill 文件路径（可选）

**发现页面交互**：
- 点击"发现页面"→ 弹出进度面板，实时显示：
  - "正在启动浏览器..."
  - "正在登录..."
  - "正在探测子应用入口... (发现 2 个有效入口)"
  - "正在提取路由... (web: 20条, admin: 27条)"
  - "正在分组整理..."
  - "发现完成：16 个页面集，41 个页面"
- 完成后自动刷新项目卡片上的数字

### 6.2 测试页面 — 项目选择

在测试页面顶部新增项目选择器：

```
┌────────────────────────────────────────────────────┐
│ 测试中心                                            │
│                                                     │
│ 目标项目: [▼ 主系统 (Agent)    ]                     │
│                                                     │
│ 🤖 Agent  🌐 E2E  🧪 前端  🔌 API                   │
└────────────────────────────────────────────────────┘
```

**选择项目后**，E2E 测试的范围下拉框变为该项目发现到的页面集：

```
测试范围: [▼ 系统管理 (6页)          ]
          ┌─────────────────────────────┐
          │ web-chat (3页)              │
          │ web-agent (3页)             │
          │ web-workflow (2页)          │
          │ admin-sys (6页)             │
          │ admin-perm (3页)            │
          │ admin-task (3页)            │
          │ admin-page-factory (7页)    │
          │ ...                        │
          │ 全部 (41页)                │  ← 自动生成
          └─────────────────────────────┘
```

选择某个页面集后，可以展开查看具体页面列表（勾选/取消勾选）：

```
☑ 代码管理 (/admin/.../sys/code)
☑ 配置管理 (/admin/.../sys/config)
☑ 数据源管理 (/admin/.../sys/database)
☐ 仓库管理 (/admin/.../sys/storage)    ← 取消勾选
☑ 文件管理 (/admin/.../sys/storage/file)
☑ 注入配置 (/admin/.../sys/mention)
```

---

## 七、后端改动

### 7.1 配置层 (`config.ts`)

```typescript
// PlatformConfig 改造
interface PlatformConfig {
  aiPlatformRoot: string;
  e2eDataDir: string;
  apiTestBaseUrl: string;
  projects: TestProject[];        // 新增
  defaultProjectId: string;       // 新增
}
```

默认配置中包含一个预设项目（兼容旧配置）：

```typescript
const DEFAULT_CONFIG: PlatformConfig = {
  aiPlatformRoot: '...',
  e2eDataDir: '...',
  apiTestBaseUrl: 'http://localhost:3100',
  defaultProjectId: 'agent-main',
  projects: [{
    id: 'agent-main',
    name: '主系统(Agent)',
    baseUrl: 'http://localhost:5173',
    apiBaseUrl: 'http://localhost:9998',
    loginUrl: '/web/index.html#/login',
    username: 'fskjadmin',
    password: 'fskj_dst_2023',
    pageSets: [],  // 首次需要"发现页面"填充
    status: 'active',
  }],
};
```

### 7.2 项目 API (`routes/projects.ts`)

```
GET    /api/projects                  → 列出所有项目
POST   /api/projects                  → 添加项目
PUT    /api/projects/:id              → 更新项目配置
DELETE /api/projects/:id              → 删除项目
POST   /api/projects/:id/discover     → 触发页面发现（返回 taskId）
GET    /api/projects/:id/discover/stream  → SSE 推送发现进度
POST   /api/projects/:id/check        → 检测项目连通性（URL+端口+登录）
GET    /api/projects/:id/pages        → 获取项目的页面集列表
PUT    /api/projects/:id/pages        → 手动更新页面集（编辑/新增/删除）
```

### 7.3 发现服务 (`services/page-discovery.ts`)

新增文件，核心逻辑见第五章。复用 `discover.js` 已验证的 Vue Router 提取方案。

**调用方式**：server 直接 `import { chromium } from 'playwright'`。在 server/package.json 添加 `playwright` 依赖。

### 7.4 test-runner.ts 改造

```typescript
// 运行 E2E 测试时，从项目配置中读取页面列表
async function runE2ETest(suite: TestSuite, config: Record<string, unknown>): Promise<void> {
  const projectId = config.projectId as string;
  const project = getConfig().projects.find(p => p.id === projectId);

  if (!project) throw new Error(`项目不存在: ${projectId}`);

  // 从项目配置中获取页面列表
  const scope = config.scope as string;
  const pages = resolvePages(project, scope);
  // ... 用 project.baseUrl / project.apiBaseUrl 替代硬编码
}
```

`resolvePages()` 函数：

```typescript
function resolvePages(project: TestProject, scope: string): PageConfig[] {
  if (scope === 'all') {
    return project.pageSets.flatMap(ps => ps.pages);
  }
  // scope 对应某个 pageSet.id
  const pageSet = project.pageSets.find(ps => ps.id === scope);
  return pageSet?.pages || [];
}
```

### 7.5 Skill 动态生成

不再维护静态 SKILL.md 的页面列表。运行时根据项目配置动态生成提示词：

```typescript
// 在 test-runner.ts 的 runE2ETest 中
const project = getProjectById(config.projectId);
const scopePages = resolvePages(project, scope);

// 动态构建页面列表提示
const pageListPrompt = scopePages.map(p =>
  `- ${p.name}: ${project.baseUrl}${p.url}`
).join('\n');

const dynamicSkillContent = `
${baseSkillContent}

## 当前项目信息
- 项目名称: ${project.name}
- 前端地址: ${project.baseUrl}
- 登录凭据: ${project.username} / ${project.password}
- 登录页: ${project.baseUrl}${project.loginUrl}

## 待测试页面 (${scopePages.length}页)
${pageListPrompt}
`;
```

---

## 八、迁移与兼容

### 8.1 旧配置迁移

启动时检测：如果 `platform-config.json` 中没有 `projects` 字段但有 `projectRoot`，自动迁移：

```typescript
function migrateConfig(saved: any): PlatformConfig {
  if (saved.projects) return saved;  // 新格式

  // 旧格式迁移
  return {
    ...saved,
    defaultProjectId: 'agent-main',
    projects: [{
      id: 'agent-main',
      name: '主系统(Agent)',
      baseUrl: `http://localhost:${saved.mainFrontendPort}`,
      apiBaseUrl: `http://localhost:${saved.mainBackendPort}`,
      loginUrl: '/web/index.html#/login',
      username: 'fskjadmin',
      password: 'fskj_dst_2023',
      pageSets: [],  // 需要重新发现
      status: 'active',
    }],
  };
}
```

### 8.2 index.js 兼容

Node.js 独立运行模式 (`e2e-test/src/index.js`) 也从 `projects/{id}/pages.json` 读取页面列表，不再硬编码。

---

## 九、改动文件清单

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `server/src/services/config.ts` | ~50 行 | PlatformConfig 增加项目数组，迁移逻辑 |
| `server/src/routes/projects.ts` | 新建 ~120 行 | 项目 CRUD + 发现 + 检测 API |
| `server/src/services/page-discovery.ts` | 新建 ~250 行 | Playwright 页面发现引擎（复用 discover.js 逻辑） |
| `server/src/services/test-runner.ts` | ~30 行 | E2E 测试改为从项目配置读取页面 |
| `server/src/index.ts` | ~5 行 | 注册 projects 路由 |
| `web/src/views/SettingsView.vue` | ~150 行 | 项目管理区块（列表+添加/编辑弹窗） |
| `web/src/views/TestView.vue` | ~40 行 | 项目选择器 + 页面集联动 |
| `web/src/api/projects.ts` | 新建 ~50 行 | 项目 API 调用 |
| `SKILL.md` | 精简 | 移除硬编码页面列表和凭据 |
| `e2e-test/src/index.js` | ~30 行 | 从外部 JSON 读页面列表 |
| `server/package.json` | 1 行 | 添加 playwright 依赖 |

**总计**：新建 3 文件，修改 8 文件，约 750 行。

---

## 十、实施优先级

| 阶段 | 内容 | 状态 | 预计改动 |
|------|------|------|----------|
| P0 | 发现脚本验证 | ✅ 完成 (commit 988be299 前) | discover.js ~438 行 |
| P0 | 配置层多项目支持 + 迁移 | ✅ 完成 (commit 988be299) | config.ts ~340 行 |
| P0 | 项目 CRUD API | ✅ 完成 (commit 988be299) | projects.ts ~215 行 |
| P1 | 前端 API 层 | ✅ 完成 (commit 988be299) | api/projects.ts ~90 行 |
| P1 | 设置页面项目管理 UI | ✅ 完成 (commit 988be299) | SettingsView.vue 项目管理区块 |
| P1 | 发现服务（迁移 discover.js 为 TS） | ✅ 完成 | page-discovery.ts ~300 行 |
| P1 | 测试页面项目选择 + 页面集联动 | ✅ 完成 | TestView.vue 项目选择器 + 页面集联动 |
| P2 | test-runner 改为项目配置驱动 | ✅ 完成 | test-runner.ts 动态构建 prompt |
| P2 | SKILL.md 精简 + 动态注入 | ✅ 部分完成 | 动态注入已在 test-runner 中实现，SKILL.md 清理为目标项目侧工作 |
| P2 | index.js 从外部 JSON 读取页面 | ✅ 完成 | index.js 优先从 platform-config.json 读取，旧硬编码作为回退 |
| P3 | 知识库自动生成骨架 | ✅ 完成 | 发现时自动生成 page-context.json 骨架，详细字段待补充 |

### 已完成内容详情 (commit 988be299, 2025-05-29)

**后端：**
- `config.ts` — 新增 `TestProject` / `PageSet` / `PageConfig` 接口，`PlatformConfig` 增加 `projects[]` 和 `defaultProjectId`；旧配置自动迁移；项目 CRUD 操作函数（addProject/updateProject/deleteProject/setDefaultProject/updateProjectPages）
- `routes/projects.ts` — 完整的项目 CRUD API、页面集管理、连通性检测（前端/后端/登录页/源码路径/Skill文件）
- `index.ts` — 注册 `/api/projects` 路由

**前端：**
- `api/projects.ts` — 项目相关 API 调用封装（CRUD + 检测 + 发现）
- `SettingsView.vue` — 项目管理区块：项目卡片列表、添加/编辑弹窗、连通性检测、设为默认、删除

**E2E：**
- `discover.js` — 双模式页面发现脚本（源码分析 + 运行时探测），已验证可发现 41 个页面
- `discovery-result.json` — 演示环境实测结果存档

### 已完成内容详情 (本轮实施, 2026-06-01)

**后端：**
- `services/page-discovery.ts` — 页面自动发现服务（~300行），从 discover.js 迁移为 TypeScript，支持运行时探测、源码分析、自动分组，通过 onProgress 回调推送 SSE 进度
- `routes/projects.ts` — 发现 API 改为真正的 SSE 流式响应，实时推送发现进度，完成后自动更新项目 pageSets
- `services/test-runner.ts` — E2E 测试从项目配置读取页面列表/凭据/baseUrl，动态构建 prompt；preflight 改为检测项目连通性
- `package.json` — 新增 playwright 依赖

**前端：**
- `api/projects.ts` — discoverProject 改为 SSE fetch 流式接收进度
- `SettingsView.vue` — 项目卡片新增"发现页面"按钮 + 发现进度面板
- `TestView.vue` — E2E 测试区新增项目选择器下拉，选择项目后动态加载页面集作为测试范围选项

---

## 十一、效果演示（改造后用户流程）

**场景 1：新项目接入**
1. 打开 `/settings` → 项目管理 → 点击"添加项目"
2. 填写名称、URL、凭据 → 保存
3. 点击"发现页面" → 等待 30 秒 → 自动生成页面集
4. 打开 `/tests` → 选择新项目 → 选择页面集 → 开始测试

**场景 2：系统路由变更**
1. 主系统删除了 /admin 模块，新增了 /monitoring 模块
2. 打开 `/settings` → 主系统 → 点击"发现页面"
3. 发现结果自动更新：删除 admin 页面集，新增 monitoring 页面集
4. 无需改代码

**场景 3：只测几个页面**
1. 打开 `/tests` → 选择项目 → 范围下拉选具体页面集
2. 勾选想测的页面 → 开始测试

**场景 4：演示环境验证**
1. 添加项目：名称"演示环境"，URL `https://www.topspeeder.net.cn/agent_audio`
2. 点击"发现页面" → 自动发现 web(20条) + admin(27条) = 41 个页面
3. 选择页面集开跑 E2E 测试
