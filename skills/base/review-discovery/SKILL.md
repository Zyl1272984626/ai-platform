---
name: review-discovery
description: 扫描源码分析项目架构和模块结构，按业务模块标注风险等级，生成安全/性能/错误处理等维度的审查筛查规则
allowed-tools: ["Read", "Glob", "Grep", "Write"]
tags: ["review", "discovery", "test", "security"]
---

# 代码审查点发现

你是一个代码审查专家。请分析项目源码，完成以下两个任务。

## 项目信息
- 项目名称: {{projectName}}
- 源码路径: {{sourcePath}}
- 前端框架: Vue 3 + Vite + Pinia

## 工具使用约束（必须严格遵守）

1. **只允许使用 Glob、Grep、Read、Write 四个工具**
2. **禁止使用 TodoWrite、Bash、TaskCreate 等任何其他工具**
3. **禁止输出进度跟踪、TODO 列表或中间状态**
4. 用 Glob 一次性扫描文件列表，不要逐个目录重复扫描
5. 用 Grep 搜索关键模式，不要逐文件 Read
6. 只 Read 关键文件（路由定义、入口文件、配置文件），跳过测试文件和生成文件

## 执行步骤

### 步骤 1：快速扫描项目结构
- `Glob("**/package.json")` — 识别技术栈
- `Glob("src/**/*.{ts,vue,js}")` — 获取前端文件全貌
- `Glob("server/src/**/*.ts")` 或类似路径 — 获取后端文件全貌（如存在）

### 步骤 2：分析模块和风险
- `Grep` 搜索路由定义、API 调用、状态管理等关键模式
- `Read` 读取入口文件和关键配置，快速理解模块划分
- 根据文件结构和业务逻辑，将源码按模块分组，标注风险等级

### 步骤 3：生成并写入结果
- 用 Write 工具写入 `review-discovery.json`
- 用 Write 工具写入 `review-rules.json`

**充分扫描，不要遗漏，直到分析完成再写入结果。**

## 重要原则：规则是筛查清单，不是审查结论

**规则必须写成通用的检查指引，不要包含具体文件的审查结论。**

正确示例：
- checkMethod: "搜索所有 v-html 和 dangerouslyUseHTMLString 的使用，检查渲染内容是否经过 DOMPurify 净化"
- goodPattern: "所有动态 HTML 内容在渲染前经过 DOMPurify.sanitize() 处理"

错误示例（不要这样写）：
- checkMethod: "assistant-message.vue 第 752 行使用 innerHTML 渲染格式化输出存在 XSS" ← 这是具体发现，不是筛查规则

规则的作用：告诉审查阶段"按这个方法去查"，而不是"这里有问题"。

## 输出格式

### 文件 1: {{outputDir}}/review-discovery.json
```json
{
  "discoveredAt": "ISO日期",
  "projectId": "项目ID",
  "summary": {
    "totalFiles": 667,
    "totalModules": 15,
    "keyFiles": 30,
    "scanDuration": 0
  },
  "projectStructure": {
    "framework": "Vue 3 + Vite + Pinia",
    "language": "TypeScript / JavaScript",
    "buildTool": "Vite"
  },
  "modules": [
    {
      "id": "模块ID",
      "name": "模块名称",
      "path": "src/xxx/",
      "files": 24,
      "keyFiles": ["关键文件路径"],
      "riskLevel": "high/medium/low",
      "riskIndicators": ["该模块涉及哪些敏感操作，如：用户输入渲染、加密通信、文件上传等"]
    }
  ]
}
```

### 文件 2: {{outputDir}}/review-rules.json
```json
{
  "dimensions": [
    {
      "id": "security",
      "name": "安全性",
      "severity": "critical",
      "enabled": true,
      "rules": [
        {
          "id": "SEC001",
          "title": "动态 HTML 渲染的 XSS 防护",
          "checkMethod": "搜索所有 v-html、innerHTML、dangerouslyUseHTMLString 的使用，检查渲染的内容是否经过净化处理（如 DOMPurify）",
          "goodPattern": "所有动态 HTML 内容在渲染前经过 DOMPurify.sanitize() 或类似库净化；错误提示使用纯文本而非 HTML"
        }
      ]
    }
  ],
  "ignore": {
    "patterns": ["**/node_modules/**", "**/dist/**"]
  },
  "fileLimits": {
    "maxFilesPerReview": 30,
    "maxLinesPerFile": 500
  }
}
```

审查规则必须覆盖以下 5 个维度，每个维度至少 3 条规则：
1. **security**（安全性）— XSS、注入、鉴权、敏感信息泄露等
2. **performance**（性能）— 重复渲染、内存泄漏、大列表、定时器清理等
3. **error-handling**（错误处理）— 异步异常、空值保护、边界情况等
4. **framework**（框架最佳实践）— Vue 3 / Pinia / TypeScript 规范
5. **maintainability**（可维护性）— 代码复杂度、命名、重复代码等

每条规则的字段说明：
- `title`: 简明扼要的规则名称（不要包含具体文件名）
- `checkMethod`: 告诉审查者"怎么查"——用什么搜索模式、关注什么场景
- `goodPattern`: 告诉审查者"合格的标准"——符合规范的代码应该长什么样

请立即开始分析。
