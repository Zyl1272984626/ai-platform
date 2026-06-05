---
name: review-discovery
description: 扫描源码分析项目架构和模块结构，按业务模块标注风险等级，生成安全/性能/错误处理等维度的审查筛查规则
allowed-tools: ["Read", "Glob", "Grep", "Write"]
tags: ["review", "discovery", "test", "security"]
usage: 在设置页面的项目操作区点击「发现审查点」时自动加载。分析项目架构和模块结构，生成按维度（安全、性能、错误处理等）的审查规则。生成的数据用于测试中心的代码审查。
constraints:
  - 只允许使用 Read、Glob、Grep、Write 四个工具
  - 需要项目已配置正确的源码路径
---

# 代码审查点发现

你是一个代码审查专家。请分析项目源码，完成以下两个任务。

## 项目信息
- 项目名称: {{projectName}}
- 源码路径: {{sourcePath}}

## 工具使用约束（必须严格遵守）

1. **只允许使用 Glob、Grep、Read、Write 四个工具**
2. **禁止使用 TodoWrite、Bash、TaskCreate 等任何其他工具**
3. **禁止输出进度跟踪、TODO 列表或中间状态**
4. 用 Glob 一次性扫描文件列表，不要逐个目录重复扫描
5. 用 Grep 搜索关键模式，不要逐文件 Read
6. 只 Read 关键文件（路由定义、入口文件、配置文件、构建文件），跳过测试文件和生成文件

---

## 执行步骤

### 步骤 1：自动探测项目结构和技术栈

**这是最关键的一步，必须先完成探测再进行后续分析。**

用 Glob 扫描以下构建文件和目录布局，判断项目的技术栈和目录结构：

```
Glob("**/package.json")       → Node.js / 前端项目
Glob("**/pom.xml")            → Java Maven 项目
Glob("**/build.gradle*)       → Java Gradle 项目
Glob("**/go.mod")             → Go 项目
Glob("**/requirements*.txt")  → Python 项目
Glob("**/Cargo.toml")         → Rust 项目
Glob("**/*.csproj")           → .NET 项目
```

同时扫描顶层目录布局（不递归），判断项目结构类型：
- **前后端分离型**：存在 `frontend/` + `backend/`（或 `web/` + `server/`、`client/` + `server/`）
- **单体前端型**：只有 `src/` + `package.json`，无后端目录
- **单体后端型**：只有 `src/` + `pom.xml` / `build.gradle`，无前端目录
- **全栈混合型**：`src/` 下同时包含前后端代码

**技术栈探测完成后，你必须明确记录以下结论（用于后续步骤）：**
- 前端技术栈：如 Vue 3 / React / Angular / 无前端
- 后端技术栈：如 Spring Boot / Express / FastAPI / Go Gin / 无后端
- 前端源码根路径：如 `frontend/src/`、`src/`、`web/src/`、无
- 后端源码根路径：如 `backend/src/main/java/`、`server/src/`、`src/`、无
- 前端文件扩展名：如 `{ts,tsx,vue,jsx,js}`、`{ts,tsx,jsx,js}` 等
- 后端文件扩展名：如 `{java}`、`{ts,js}`、`{go}`、`{py}` 等

### 步骤 2：根据探测结果扫描文件

**根据步骤 1 的结论，使用对应的 Glob 模式扫描。不要猜测路径，必须用探测到的实际路径。**

扫描示例（根据实际结构调整）：

```
# 前端文件扫描（如果存在前端）
Glob("frontend/src/**/*.{ts,vue,js,tsx,jsx}")   # 前后端分离型
# 或
Glob("src/**/*.{ts,vue,js,tsx,jsx}")              # 单体前端型

# 后端文件扫描（如果存在后端）
Glob("backend/src/main/java/**/*.java")           # Java Maven/Gradle
# 或
Glob("server/src/**/*.{ts,js}")                   # Node.js 后端
# 或
Glob("src/**/*.go")                                # Go 后端
```

**必须统计每个技术栈的实际文件总数，确保与发现结果一致。**

### 步骤 3：分析模块和风险

- `Grep` 搜索路由定义、API 调用、状态管理、SQL 操作、鉴权注解等关键模式
- `Read` 读取入口文件和关键配置（pom.xml 依赖、application.yml、router 文件等），快速理解模块划分
- 将前端和后端分别按模块分组，标注风险等级
- 后端模块重点关注：Controller 层（接口入口）、Service 层（业务逻辑）、DAO/Mapper 层（数据访问）、Config 层（配置与鉴权）

### 步骤 3.5：分析前端文件导出信息（仅存在前端时执行）

对前端模块中的关键文件，用 `Grep` 搜索导出模式，识别每个文件的**导出类型和依赖关系**。这些信息将供下游测试生成 Skill 消费，避免测试生成时错误判断文件类型。

**必须分析的导出模式：**

```
# 默认导出
Grep("export default")           → function / class / object / constant
Grep("export default function")  → 命名函数
Grep("export default {")         → 对象字面量
Grep("export default defineComponent") → Vue 组件

# 命名导出
Grep("export const")             → 常量
Grep("export function")          → 命名函数
Grep("export class")             → 类

# 特殊模式
Grep("defineStore")              → Pinia Store
Grep("use[A-Z]")                 → Vue Composable
```

**对于识别到的关键文件，Read 头部 20-30 行确认：**
- `exportType`：`function` | `object` | `component` | `composable` | `store` | `constant` | `class`
- `exportName`：导出的函数名/组件名
- `dependencies`：文件 import 了哪些需要 mock 的外部依赖（如 useTheme、echarts、vue-router 等）
- `testCategory`：推荐归入的测试类别（utils / components / stores / composables / config）

**注意**：不需要分析所有文件，只分析每个模块的 `keyFiles`（步骤 3 中已标注）。

### 步骤 4：生成并写入结果

- 用 Write 工具写入 `review-discovery.json`（含 fileAnalysis 字段）
- 用 Write 工具写入 `review-rules.json`

**充分扫描，不要遗漏，直到分析完成再写入结果。**

---

## 重要原则：规则是筛查清单，不是审查结论

**规则必须写成通用的检查指引，不要包含具体文件的审查结论。**

正确示例：
- checkMethod: "搜索所有 v-html 和 dangerouslyUseHTMLString 的使用，检查渲染内容是否经过 DOMPurify 净化"
- goodPattern: "所有动态 HTML 内容在渲染前经过 DOMPurify.sanitize() 处理"

错误示例（不要这样写）：
- checkMethod: "assistant-message.vue 第 752 行使用 innerHTML 渲染格式化输出存在 XSS" ← 这是具体发现，不是筛查规则

规则的作用：告诉审查阶段"按这个方法去查"，而不是"这里有问题"。

---

## 输出格式

### 文件 1: {{outputDir}}/review-discovery.json

```json
{
  "discoveredAt": "ISO日期",
  "projectId": "项目ID",
  "summary": {
    "totalFiles": 1560,
    "frontendFiles": 664,
    "backendFiles": 896,
    "totalModules": 20,
    "keyFiles": 40,
    "scanDuration": 0
  },
  "projectStructure": {
    "layout": "frontend-backend-split | monolith-frontend | monolith-backend | fullstack-mixed",
    "frontend": {
      "framework": "Vue 3 / React / Angular / 无",
      "language": "TypeScript / JavaScript",
      "buildTool": "Vite / Webpack",
      "sourceRoot": "frontend/src/"
    },
    "backend": {
      "framework": "Spring Boot / Express / FastAPI / Go Gin / 无",
      "language": "Java / TypeScript / Python / Go",
      "buildTool": "Maven / Gradle / npm / 无",
      "sourceRoot": "backend/src/main/java/"
    }
  },
  "modules": [
    {
      "id": "模块ID",
      "name": "模块名称",
      "layer": "frontend | backend",
      "path": "frontend/src/xxx/",
      "files": 24,
      "keyFiles": ["关键文件路径"],
      "riskLevel": "high/medium/low",
      "riskIndicators": ["该模块涉及哪些敏感操作"]
    }
  ],
  "fileAnalysis": {
    "说明": "前端关键文件的导出类型分析，供下游测试生成 Skill 消费",
    "files": [
      {
        "path": "frontend/src/components/agent/components/chart/bar/theme.js",
        "exportType": "function",
        "exportName": "getChartBarTheme",
        "exportStyle": "default",
        "testCategory": "config",
        "dependencies": [
          { "module": "../../core/useTheme.js", "name": "useTheme", "mockStrategy": "vi.fn() 返回 { theme: ref('light') }" },
          { "module": "../../core/theme/index.js", "name": "getBaseOption", "mockStrategy": "vi.fn() 返回基础配置对象" },
          { "module": "lodash", "name": "_", "mockStrategy": "保留真实实现或 vi.mock('lodash/merge')" }
        ],
        "testHints": "函数接受 horizontal 参数，内部读取 theme.value，返回合并后的 ECharts 配置对象。测试时需 mock useTheme 和 getBaseOption，测试 horizontal=true/false 和 dark/light 主题的组合"
      }
    ]
  }
}
```

### 文件 2: {{outputDir}}/review-rules.json

审查规则必须根据探测到的技术栈，从以下维度中选择合适的组合生成规则。**每个维度至少 3 条规则**。

#### 维度选择规则

| 探测结果 | 必须包含的维度 |
|----------|---------------|
| 存在前端 | security、performance、error-handling、framework（前端）、maintainability |
| 存在后端 | security、performance、error-handling、framework（后端）、maintainability |
| 全栈项目 | 以上所有维度，前端和后端各一套 framework 维度 |

#### 前端维度（存在前端时）

1. **security**（安全性）— XSS、敏感信息硬编码、Token 传输、文件上传、URL 重定向等
2. **performance**（性能）— 定时器清理、大列表渲染、图表实例管理、响应式数据优化、SSE/WebSocket 资源管理等
3. **error-handling**（错误处理）— 异步异常捕获、空值保护、流解析异常、全局错误处理、文件操作错误恢复等
4. **framework-frontend**（前端框架最佳实践）— 根据实际框架生成：
   - Vue 3：Composition API 规范、Pinia 状态管理、组件通信、TypeScript 类型安全、路由守卫
   - React：Hooks 规范、状态管理（Redux/Zustand）、组件设计模式、性能优化（memo/useMemo/useCallback）
   - Angular：依赖注入、RxJS 使用、模块化、模板安全
5. **maintainability**（可维护性）— 重复代码、函数复杂度、调试日志、硬编码常量、模块职责划分等

#### 后端维度（存在后端时）

6. **security-backend**（后端安全性）— SQL 注入、接口鉴权、敏感信息泄露、CSRF、输入校验、文件路径遍历等
7. **performance-backend**（后端性能）— N+1 查询、缓存策略、连接池管理、大事务、异步处理等
8. **error-handling-backend**（后端错误处理）— 全局异常处理、空指针保护、事务回滚、超时处理、熔断降级等
9. **framework-backend**（后端框架最佳实践）— 根据实际框架生成：
   - Spring Boot：分层架构、依赖注入、配置管理、AOP 使用、事务注解
   - Express/Koa：中间件设计、错误处理中间件、路由组织、请求校验
   - FastAPI：Pydantic 校验、依赖注入、异步处理、中间件
   - Go：错误处理模式、goroutine 管理、context 传递、接口设计
10. **api-design**（接口设计）— RESTful 规范、参数校验、响应格式统一、错误码设计、接口版本管理等

#### 规则字段说明

每条规则的字段：
- `id`: 维度前缀 + 编号，如 SEC001、PERF001、BSEC001（后端安全）、BAPI001
- `title`: 简明扼要的规则名称（不要包含具体文件名）
- `checkMethod`: 告诉审查者"怎么查"——用什么搜索模式、关注什么场景
- `goodPattern`: 告诉审查者"合格的标准"——符合规范的代码应该长什么样

```json
{
  "dimensions": [
    {
      "id": "security",
      "name": "安全性",
      "layer": "frontend",
      "severity": "critical",
      "enabled": true,
      "rules": [
        {
          "id": "SEC001",
          "title": "规则名称",
          "checkMethod": "搜索方法和关注点",
          "goodPattern": "合格标准描述"
        }
      ]
    },
    {
      "id": "security-backend",
      "name": "后端安全性",
      "layer": "backend",
      "severity": "critical",
      "enabled": true,
      "rules": []
    }
  ],
  "ignore": {
    "patterns": ["**/node_modules/**", "**/dist/**", "**/target/**", "**/.git/**", "**/*.class"]
  },
  "fileLimits": {
    "maxFilesPerReview": 30,
    "maxLinesPerFile": 500
  }
}
```

请立即开始分析。
