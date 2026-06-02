# API 接口测试设计方案（v2）

## 1. 核心理念：发现 → 生成 → 执行

与 E2E 页面测试保持一致的三阶段模式。

**与 E2E 对齐的关键点**：
- 发现动作在**设置页面**触发（与"发现页面"按钮并列）
- 发现结果**分项目存储**在 `server/data/projects/{id}/`
- 测试定义由 **Claude Code 生成**，不是人工手写
- 测试页面只负责**展示已发现的模块 + 执行**

### 1.1 总体流程图

```
┌─── 设置页面 ──────────────────────────────────────────────────┐
│                                                                │
│  项目卡片 ──→ 点击「发现接口」                                  │
│                  │                                             │
│                  ▼                                             │
│          Claude Code 扫描源码 ──(SSE进度)──→ 显示扫描进度        │
│                  │                                             │
│                  ▼                                             │
│          分析后端路由 + 前端 API 调用                            │
│                  │                                             │
│                  ▼                                             │
│          按业务模块分组（auth/chat/knowledge/system/...）       │
│                  │                                             │
│                  ▼                                             │
│          生成 api-tests.json ──→ 保存到 projects/{id}/         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ 数据文件
                              ▼
┌─── 测试页面 ──────────────────────────────────────────────────┐
│                                                                │
│  选择项目 ──→ 加载 api-tests.json ──→ 展示模块列表（勾选）      │
│                                                │               │
│                                                ▼               │
│                                        点击「开始测试」          │
│                                                │               │
│                                                ▼               │
│                    ┌───── 后端 fetch 逐个执行 ─────┐            │
│                    │  认证-登录      → 200 ✓       │            │
│                    │  认证-获取用户  → 200 ✓       │            │
│                    │  聊天-创建会话  → 500 ✗       │            │
│                    │  ...                          │            │
│                    └──────────────────────────────┘            │
│                              │                                 │
│                              ▼                                 │
│                    SSE 实时推送 ──→ 展示通过/失败详情            │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 三阶段数据流

```
  ① 发现阶段                ② 生成阶段                 ③ 执行阶段
 ┌──────────┐            ┌──────────────┐          ┌──────────────┐
 │ 源码路径  │            │              │          │              │
 │sourcePath │──→ Claude  │ api-discovery│──→ Claude│ api-tests    │
 │           │    Code    │  .json       │    Code  │  .json       │
 │           │            │ (接口清单)    │          │ (测试定义)    │
 └──────────┘            └──────────────┘          └──────┬───────┘
                                                           │
                                                           ▼
                                                    ┌──────────────┐
                                                    │  runApiTest  │
                                                    │  fetch 请求   │
                                                    │  断言结果     │
                                                    └──────────────┘
```

### 1.3 文件存储结构

采用**轻量配置 + 外部重数据**分离存储：

```
┌─ server/data/                    ← 轻量配置（随项目 Git 管理，KB 级）
│  └── projects/{id}/
│     ├── project.json               E2E 页面集数据（已有）
│     ├── discovery-result.json      E2E 发现结果（已有）
│     ├── page-context.json          E2E 页面知识库（已有）
│     ├── api-discovery.json         API 接口发现结果（新增）
│     └── api-tests.json             API 测试定义（新增）
│
└─ {testDataDir}/                  ← 统一外部数据目录（设置页面配置一项即可）
   ├── e2e/                          E2E 运行数据（原 e2eDataDir 迁入）
   │   ├── runs/{runId}/               运行记录、截图、DOM 快照
   │   ├── reports/{runId}.html        HTML 测试报告
   │   └── baselines/                  基线截图
   ├── api/
   │   └── runs/{suiteId}.json         API 测试运行记录
   ├── frontend/
   │   └── runs/{suiteId}.json         前端测试运行记录
   └── codereview/
       └── runs/{suiteId}.json         代码审查运行记录
```

> **设计原因**：所有测试类型的运行产物（截图、报告、JSON 记录）都会持续膨胀，
> 统一放一个外部目录管理，`server/data/` 只保留轻量 JSON 配置。
> 设置页面「路径配置」只需配一个 `testDataDir`（如 `F:/test-runs-data`），
> 原有的 `e2eDataDir` 配置废弃，E2E 数据迁入 `{testDataDir}/e2e/`。

---

## 2. 现状分析

### 2.1 当前问题

后端 `test-runner.ts` 第627-673行，API 测试硬编码 5 个端点：

```typescript
const apiTests = [
  { name: 'Health API', method: 'GET', url: '/api/health', expect: 200 },
  { name: 'Skills 列表', method: 'GET', url: '/api/skills', expect: 200 },
  // ...
];
```

**核心问题**：不知道项目有哪些接口、不知道正确的请求参数和期望响应是什么。

### 2.2 参考：E2E 页面发现的做法

E2E 测试前，设置页面通过 `page-discovery.ts`（Playwright）自动发现页面：
1. 登录系统 → 探测子应用入口 → 提取 Vue Router 路由 → 自动分组
2. 生成 `project.json`（页面集数据）+ `page-context.json`（知识库骨架）
3. 测试时 Claude Code 读取这些数据来理解页面

**API 接口测试应该走同样的路**：Claude Code 先读懂源码中的路由定义，再生成完整的测试定义。

---

## 3. 数据存储设计

### 3.1 分项目目录结构

```
┌─ server/data/projects/{id}/      ← 轻量配置（KB 级）
│  ├── project.json                   页面集数据（已有）
│  ├── discovery-result.json          E2E 发现结果（已有）
│  ├── page-context.json              E2E 页面知识库（已有）
│  ├── api-discovery.json             API 接口发现结果（新增）
│  └── api-tests.json                 API 测试定义（新增，Claude Code 生成）
│
└─ {testDataDir}/api/runs/         ← 运行数据（统一外部目录的子目录）
   └── {suiteId}.json                 每次运行的完整结果
```

### 3.2 api-discovery.json — 发现结果

Claude Code 扫描源码后输出，记录发现了哪些接口：

```json
{
  "projectId": "agent-main",
  "discoveredAt": "2026-06-01T10:00:00Z",
  "summary": {
    "totalModules": 5,
    "totalEndpoints": 42,
    "scanDuration": 45000
  },
  "modules": [
    {
      "id": "auth",
      "name": "认证模块",
      "description": "用户登录、登出、Token 管理",
      "sourcePath": "src/api/auth/",
      "endpoints": [
        {
          "id": "auth-login",
          "name": "用户登录",
          "method": "POST",
          "path": "/api/login",
          "description": "用户名密码登录，返回 JWT Token",
          "params": { "username": "string", "password": "string" },
          "response": { "code": 200, "data": { "token": "string", "user": "object" } }
        },
        {
          "id": "auth-logout",
          "name": "退出登录",
          "method": "POST",
          "path": "/api/logout",
          "description": "清除登录状态"
        }
      ]
    },
    {
      "id": "chat",
      "name": "聊天模块",
      "sourcePath": "src/api/chat/",
      "endpoints": [
        {
          "id": "chat-session-list",
          "name": "获取会话列表",
          "method": "GET",
          "path": "/api/chat/sessions",
          "params": { "page": "number", "size": "number" },
          "response": { "code": 200, "data": { "list": "array", "total": "number" } }
        }
      ]
    }
  ]
}
```

### 3.3 api-tests.json — 测试定义

Claude Code 基于发现结果生成的可执行测试。

**关键设计：测试数据自动获取**。不需要人工配置参数或数据库连接，
Claude Code 在发现阶段会**实际调用列表接口**获取真实数据 ID，
写入 `testData` 字段。测试执行时直接使用这些 ID。

```json
{
  "projectId": "agent-main",
  "generatedAt": "2026-06-01T10:01:00Z",
  "baseUrl": "http://localhost:9998",
  "authConfig": {
    "type": "loginFirst",
    "loginEndpoint": "/api/login",
    "loginBody": { "username": "fskjadmin", "password": "fskj_dst_2023" },
    "tokenPath": "data.token",
    "tokenHeader": "Authorization"
  },
  "testData": {
    "_comment": "Claude Code 发现时自动调用列表接口获取的真实数据，无需人工配置",
    "userId": "u_10001",
    "sessionId": "chat_abc123",
    "knowledgeId": "kb_xyz789",
    "roleId": "role_001"
  },
  "testModules": [
    {
      "moduleId": "auth",
      "moduleName": "认证模块",
      "tests": [
        {
          "id": "auth-login",
          "name": "用户登录 - 正常登录",
          "method": "POST",
          "path": "/api/login",
          "headers": { "Content-Type": "application/json" },
          "body": { "username": "fskjadmin", "password": "fskj_dst_2023" },
          "expect": {
            "status": 200,
            "body": {
              "code": 200,
              "data.token": "notEmpty"
            }
          }
        },
        {
          "id": "auth-login-fail",
          "name": "用户登录 - 错误密码",
          "method": "POST",
          "path": "/api/login",
          "body": { "username": "fskjadmin", "password": "wrong" },
          "expect": {
            "status": 200,
            "body": { "code": 401 }
          }
        },
        {
          "id": "auth-getUserInfo",
          "name": "获取当前用户信息",
          "method": "GET",
          "path": "/api/user/info",
          "needAuth": true,
          "expect": {
            "status": 200,
            "body": {
              "code": 200,
              "data.username": "notEmpty"
            }
          }
        }
      ]
    },
    {
      "moduleId": "chat",
      "moduleName": "聊天模块",
      "tests": [
        {
          "id": "chat-session-list",
          "name": "获取会话列表",
          "method": "GET",
          "path": "/api/chat/sessions?page=1&size=10",
          "needAuth": true,
          "expect": {
            "status": 200,
            "body": {
              "code": 200,
              "data.list": "array"
            }
          }
        },
        {
          "id": "chat-session-detail",
          "name": "获取会话详情",
          "method": "GET",
          "path": "/api/chat/sessions/{{testData.sessionId}}",
          "needAuth": true,
          "expect": {
            "status": 200,
            "body": {
              "code": 200,
              "data.id": "notEmpty"
            }
          }
        }
      ]
    }
  ]
}
```

---

## 4. 发现阶段：Claude Code 扫描源码

### 4.1 触发入口

在设置页面的项目管理中，与"发现页面"按钮并列，新增 **「发现接口」** 按钮：

```
┌─────────────────────────────────────────────┐
│ 项目: 主系统(Agent)                          │
│                                              │
│  [发现页面]  [发现接口]  [发现组件]  [检测]    │
│                                              │
│  ← 已有     ← 新增API   ← 新增前端          │
└─────────────────────────────────────────────┘
```

### 4.1.1 发现过程流程图

```
用户            设置页面              后端               Claude Code          文件系统        目标API
 │                │                   │                     │                   │               │
 │ 点击「发现接口」 │                   │                     │                   │               │
 │──────────────→│                   │                     │                   │               │
 │                │ POST /discover-api│                     │                   │               │
 │                │──────────────────→│                     │                   │               │
 │                │                   │ 启动 Claude Code SDK │                   │               │
 │                │                   │────────────────────→│                   │               │
 │                │                   │                     │ 读取源码路由文件    │               │
 │                │                   │                     │──────────────────→│               │
 │                │  SSE: 扫描后端路由  │                     │                   │               │
 │                │←──────────────────│←──── SSE 进度 ──────│                   │               │
 │  显示扫描进度   │                   │                     │ 读取前端 API 调用   │               │
 │←───────────────│                   │                     │──────────────────→│               │
 │                │  SSE: 分析前端调用  │                     │                   │               │
 │                │←──────────────────│←──── SSE 进度 ──────│                   │               │
 │                │                   │                     │ 合并去重，按模块分组 │               │
 │                │                   │                     │────────┐           │               │
 │                │                   │                     │←───────┘           │               │
 │                │                   │                     │ 写入 api-discovery │               │
 │                │                   │                     │──────────────────→│               │
 │                │  SSE: 生成测试定义  │                     │                   │               │
 │                │←──────────────────│←──── SSE 进度 ──────│                   │               │
 │                │                   │                     │ 登录获取 Token      │               │
 │                │                   │                     │──────────────────────────────────→│
 │                │                   │                     │ 调用列表接口获取真实ID│               │
 │                │                   │                     │──────────────────────────────────→│
 │                │  SSE: 获取测试数据  │                     │←── 返回真实数据ID ──│               │
 │                │←──────────────────│←──── SSE 进度 ──────│                   │               │
 │                │                   │                     │ 写入 api-tests     │               │
 │                │                   │                     │  (含 testData)     │               │
 │                │                   │                     │──────────────────→│               │
 │                │  SSE: 完成！       │                     │                   │               │
 │                │←──────────────────│←──── SSE 完成 ─────│                   │               │
 │ 显示结果摘要   │                   │                     │                   │               │
 │←───────────────│                   │                     │                   │               │
```

### 4.2 API 端点

```
POST /api/projects/{id}/discover-api
  触发 Claude Code 扫描源码中的 API 接口
  SSE 流式返回发现进度

GET /api/projects/{id}/api-discovery
  获取已保存的 API 发现结果

GET /api/projects/{id}/api-tests
  获取已生成的 API 测试定义
```

### 4.3 发现过程

Claude Code 收到的 Prompt 大致如下：

```
你是一个 API 接口分析专家。请分析以下项目的源码，找出所有 HTTP API 接口，
并生成可直接执行的测试定义。

## 项目信息
- 项目名称: 主系统(Agent)
- 源码路径: C:/FengSuKeJi/agent
- 后端 API 地址: http://localhost:9998
- 登录页: http://localhost:9998/index/index.html#/login
- 登录凭据: fskjadmin / fskj_dst_2023

## 任务
1. 扫描源码中的后端路由定义（如 Express Router、Spring Controller 等）
2. 扫描前端代码中的 API 调用（如 axios.get/post、fetch 等）
3. 综合两端信息，按业务模块分组
4. 对每个接口记录：方法、路径、请求参数、响应结构、描述
5. 【关键】获取真实测试数据：
   - 先调用登录接口获取 Token
   - 调用各模块的列表接口（如 GET /api/users?page=1&size=1）
   - 从返回数据中提取真实 ID（userId、sessionId、knowledgeId 等）
   - 将这些 ID 写入 testData 字段，后续测试用 {{testData.xxx}} 引用
6. 为每个接口生成正向 + 异常测试用例（含断言）

## 测试数据获取策略
不需要人工配置参数，也不需要数据库连接。通过实际调用 API 获取：
- 列表接口 → 提取第一条数据的 ID
- 详情接口 → 用列表获取的 ID
- 创建接口 → 使用合理的测试数据
- 删除/更新接口 → 先创建再操作

## 输出格式
请输出 api-discovery.json 和 api-tests.json 两个文件的内容...
```

Claude Code 使用工具（Read、Grep、Bash/curl 等）读取源码并实际调用 API，
分析后输出结构化发现结果和包含真实测试数据的测试定义。

### 4.4 发现进度 SSE 事件

```typescript
// 与 E2E 页面发现一致的 SSE 模式
interface ApiDiscoveryProgress {
  stage: 'scanning' | 'analyzing' | 'generating' | 'done' | 'error'
  message: string
  detail?: {
    currentFile?: string
    foundModules?: number
    foundEndpoints?: number
  }
}
```

---

## 5. 生成阶段：Claude Code 生成测试定义

### 5.1 生成时机

发现完成后，**立即自动触发**生成。也可以在设置页面手动点 **「重新生成测试」**。

### 5.2 生成过程

Claude Code 基于发现结果，结合源码中的参数校验、响应结构等信息，生成 `api-tests.json`。

关键：生成时需要参考项目配置中的**登录凭据**（username/password），用于生成认证相关的测试用例。

### 5.3 认证策略

大部分接口需要登录后才能访问，生成测试时自动处理：

```typescript
// 执行测试时，先登录获取 token
async function loginAndGetToken(testConfig: ApiTestConfig): Promise<string> {
  const res = await fetch(testConfig.baseUrl + testConfig.authConfig.loginEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testConfig.authConfig.loginBody),
  })
  const data = await res.json()
  // 按 tokenPath（如 "data.token"）提取 token
  return getNestedValue(data, testConfig.authConfig.tokenPath)
}
```

---

## 6. 执行阶段

### 6.1 test-runner.ts 改造

### 6.1.1 执行流程图

```
用户点击「开始测试」
        │
        ▼
读取 api-tests.json
        │
        ▼
   文件存在？ ──否──→ 提示「请先发现接口」
        │
       是
        ▼
登录获取 Token（authConfig.loginEndpoint）
        │
        ▼
筛选勾选的模块
        │
        ▼
┌─→ 遍历每个测试用例
│       │
│       ▼
│   替换路径中的 {{testData.xxx}} 为真实 ID
│       │
│       ▼
│   fetch 发送 HTTP 请求
│       │
│       ▼
│   校验状态码 + 响应体字段
│       │
│       ▼
│   SSE 推送结果到前端
│       │
│       ▼
│   还有下一个用例？ ──是──→ 回到循环开头
│       │
│      否
│       ▼
└──→ 汇总结果，展示报告
```

```typescript
async function runApiTest(suite: TestSuite, config: Record<string, unknown>): Promise<void> {
  const projectId = config.projectId as string
  const project = getProjectById(projectId)

  // 1. 读取项目级 API 测试定义（Claude Code 生成的）
  const testsPath = path.join(DATA_DIR, 'projects', projectId, 'api-tests.json')
  if (!fs.existsSync(testsPath)) {
    throw new Error('请先在设置页面「发现接口」')
  }
  const testConfig: ApiTestConfig = JSON.parse(fs.readFileSync(testsPath, 'utf-8'))
  const baseUrl = project?.apiBaseUrl || testConfig.baseUrl

  // 2. 登录获取 Token（如需认证）
  let authToken = ''
  if (testConfig.authConfig) {
    authToken = await loginAndGetToken(testConfig, baseUrl)
  }

  // 3. 筛选要执行的模块
  const selectedModules = config.modules as string[] || testConfig.testModules.map(m => m.moduleId)
  const filteredModules = testConfig.testModules.filter(m => selectedModules.includes(m.moduleId))

  // 4. 映射到 suite.cases
  for (const tc of suite.cases) {
    const testDef = findTestDef(filteredModules, tc.name)
    if (!testDef) { tc.status = 'skipped'; continue }

    tc.status = 'running'
    saveRun(suite)
    testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: 'running' })

    const startTime = Date.now()
    try {
      // 5. 构建请求
      const url = baseUrl + testDef.path
      const headers: Record<string, string> = { ...testDef.headers }
      if (testDef.needAuth && authToken) {
        headers[testConfig.authConfig.tokenHeader] = `Bearer ${authToken}`
      }

      const res = await fetch(url, {
        method: testDef.method,
        headers,
        body: testDef.body ? JSON.stringify(testDef.body) : undefined,
        signal: AbortSignal.timeout(10000),
      })

      tc.duration = Date.now() - startTime

      // 6. 校验
      const body = await res.json()
      const checks = validateResponse(res.status, body, testDef.expect)
      tc.status = checks.allPassed ? 'passed' : 'failed'
      tc.output = formatCheckResults(checks)
      if (!checks.allPassed) {
        tc.error = checks.failures.map(f => f.message).join('; ')
      }
    } catch (err: any) {
      tc.duration = Date.now() - startTime
      tc.status = 'error'
      tc.error = err.message
    }

    saveRun(suite)
    testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: tc.status, duration: tc.duration })
  }
}
```

### 6.2 响应校验器

```typescript
interface CheckResult {
  allPassed: boolean
  passed: number
  failed: number
  failures: { path: string; expected: string; actual: string; message: string }[]
}

function validateResponse(status: number, body: any, expect: ApiTestExpect): CheckResult {
  const failures: CheckResult['failures'] = []

  // 校验 HTTP 状态码
  if (status !== expect.status) {
    failures.push({ path: 'HTTP Status', expected: String(expect.status), actual: String(status), message: `HTTP ${status}，期望 ${expect.status}` })
  }

  // 校验响应体字段
  if (expect.body) {
    for (const [path, expected] of Object.entries(expect.body)) {
      const actual = getNestedValue(body, path)
      const check = checkValue(path, actual, expected)
      if (!check.passed) failures.push(check)
    }
  }

  return { allPassed: failures.length === 0, passed: /* count */, failed: failures.length, failures }
}

function checkValue(path: string, actual: any, expected: string): { passed: boolean } & CheckResult['failures'][0] {
  switch (expected) {
    case 'notEmpty': return { passed: !!actual, path, expected: 'notEmpty', actual: String(actual), message: `${path} 为空` }
    case 'array':    return { passed: Array.isArray(actual), path, expected: 'array', actual: typeof actual, message: `${path} 不是数组` }
    case 'string':   return { passed: typeof actual === 'string', path, expected: 'string', actual: typeof actual, message: `${path} 不是字符串` }
    case 'number':   return { passed: typeof actual === 'number', path, expected: 'number', actual: typeof actual, message: `${path} 不是数字` }
    default:         return { passed: actual === expected, path, expected: String(expected), actual: String(actual), message: `${path} 值不匹配` }
  }
}
```

---

## 7. 前端改造

### 7.1 设置页面 — 新增「发现接口」按钮

在 `SettingsView.vue` 的项目管理区域，每个项目卡片上新增按钮：

```
项目: 主系统(Agent)
源码路径: C:/FengSuKeJi/agent
已发现页面: 66个（12个页面集）

操作: [发现页面] [发现接口] [发现组件] [编辑] [检测] [删除]
```

点击「发现接口」后，弹出进度对话框（与页面发现类似）：

```
┌──────────────────────────────────────┐
│ 发现 API 接口                         │
│                                       │
│ ○ 正在扫描源码...                      │
│   ├ 分析后端路由定义 (42个)            │
│   ├ 分析前端 API 调用 (58个)           │
│   └ 合并去重                           │
│                                       │
│ ○ 正在分析模块结构...                   │
│   ├ 认证模块 (auth): 5个接口            │
│   ├ 聊天模块 (chat): 12个接口           │
│   ├ 知识库模块 (knowledge): 8个接口     │
│   └ 系统管理 (system): 17个接口         │
│                                       │
│ ○ 正在生成测试定义...                   │
│                                       │
│ 发现完成！共 5 个模块，42 个接口         │
│              [ 查看结果 ]               │
└──────────────────────────────────────┘
```

### 7.2 测试页面 — API 测试面板改造

```
┌──────────────────────────────────────────────────────────┐
│ API 接口测试                                               │
│                                                           │
│ 目标项目: [主系统(Agent)  ▼]                               │
│                                                           │
│ ⚠ 发现数据: 2026-06-01 共 5 模块 42 接口  [重新发现]       │
│                                                           │
│ 测试模块:                                                 │
│   ☑ 认证模块 (auth)          5 个接口                      │
│   ☑ 聊天模块 (chat)          12 个接口                     │
│   ☐ 知识库模块 (knowledge)   8 个接口                      │
│   ☐ 系统管理 (system)        17 个接口                     │
│                                                           │
│              [ 开始测试 ]                                  │
│                                                           │
│ ──────────────── 测试结果 ────────────────                 │
│                                                           │
│ ✓ 认证 - 用户登录正常         200  120ms                    │
│ ✓ 认证 - 用户登录错误密码     200   45ms                    │
│ ✗ 聊天 - 创建会话            500   89ms                    │
│   ├ HTTP 200 ✓                                            │
│   ├ body.code = 200 ✓                                     │
│   └ body.data.id = notEmpty ✗ (值为 undefined)            │
│ ...                                                       │
│                                                           │
│ 总计: 42 通过: 38 失败: 3 错误: 1                          │
└──────────────────────────────────────────────────────────┘
```

### 7.3 新增 API 接口

```typescript
// web/src/api/projects.ts 新增

// 触发 API 接口发现（SSE 流式）
discoverApi(projectId: string, onProgress: (e: ApiDiscoveryProgress) => void): Promise<ApiDiscoveryResult>

// 获取已发现的 API 接口数据
getApiDiscovery(projectId: string): Promise<ApiDiscoveryResult>

// 获取已生成的 API 测试定义
getApiTests(projectId: string): Promise<ApiTestConfig>
```

```typescript
// server/src/routes/projects.ts 新增

POST /{id}/discover-api     // 触发 Claude Code 发现接口
GET  /{id}/api-discovery    // 获取发现结果
GET  /{id}/api-tests        // 获取测试定义
```

---

## 8. createTestSuite 改造

```typescript
// test-runner.ts - createTestSuite() 中 api 分支
case 'api': {
  const projectId = config.projectId as string
  const testsPath = path.join(DATA_DIR, 'projects', projectId, 'api-tests.json')

  if (!fs.existsSync(testsPath)) {
    // 未发现接口，返回空提示
    cases.push({ id: uuid(), name: '请先在设置页面「发现接口」', type: 'api', status: 'pending' })
    break
  }

  const testConfig = JSON.parse(fs.readFileSync(testsPath, 'utf-8'))
  const selectedModules = config.modules as string[] || testConfig.testModules.map(m => m.moduleId)

  for (const mod of testConfig.testModules) {
    if (!selectedModules.includes(mod.moduleId)) continue
    for (const test of mod.tests) {
      cases.push({
        id: uuid(),
        name: `[${mod.moduleName}] ${test.name}`,
        type: 'api',
        status: 'pending',
      })
    }
  }
  break
}
```

---

## 9. 实施步骤

| 阶段 | 任务 | 改动范围 |
|------|------|---------|
| **Phase 1** | 后端新增 API 发现服务 `api-discovery.ts`，调用 Claude Code 扫描源码 | 新增 `services/api-discovery.ts` |
| **Phase 2** | 后端路由新增 `POST /{id}/discover-api` 等 3 个端点 | `routes/projects.ts` |
| **Phase 3** | 前端设置页面新增「发现接口」按钮 + SSE 进度弹窗 | `SettingsView.vue` |
| **Phase 4** | 改造 `test-runner.ts` 的 `runApiTest()`，从项目级 `api-tests.json` 读取并执行 | `test-runner.ts` |
| **Phase 5** | 前端 TestView API 面板改造，从发现数据加载模块列表 | `TestView.vue`, `api/tests.ts`, `api/projects.ts` |
| **Phase 6** | 优化：登录态复用、接口依赖链（先创建再查询）、数据清理 | `test-runner.ts` |

---

## 10. 关键设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 测试定义格式 | JSON（非 .http 文件） | 后端解析简单，Claude Code 生成精确，与 E2E page-context 风格一致 |
| 配置存储 | `server/data/projects/{id}/` | 轻量 JSON，随 Git 管理 |
| 运行数据存储 | `{testDataDir}/api/runs/` | 统一外部目录的子目录 |
| 外部目录 | `testDataDir`（如 `F:/test-runs-data`） | 所有测试类型共用，原 `e2eDataDir` 废弃 |
| 认证策略 | 发现时记录登录方式，执行时先登录取 Token | 适配不同项目的认证机制 |
| 发现方式 | Claude Code（非静态扫描） | AI 能理解注释、参数校验等隐含信息，生成更准确的测试 |
| 测试数据 | 发现时自动调用 API 获取真实 ID | 无需人工配置参数或数据库连接，利用已有的登录凭据 |
| 执行方式 | 后端 fetch 直连（非 Claude Code） | 纯 HTTP 请求不需要 AI 介入，速度更快、成本更低 |

---

## 11. 参考资料

- [VSCode REST Client 指南 (知乎)](https://zhuanlan.zhihu.com/p/382740857)
- [Visual Studio .http 文件 (Microsoft Learn)](https://learn.microsoft.com/zh-cn/aspnet/core/test/http-files)
- [VSCode REST Client 使用总结 (CSDN)](https://blog.csdn.net/qq_44810930/article/details/150499193)
