---
name: frontend-discovery
description: 深度扫描前端源码，发现所有可测试的 Vue 组件、工具函数、Store、Hooks/Composables，按类别分组并记录函数签名和可测试逻辑
allowed-tools: ["Read", "Glob", "Grep", "Write"]
tags: ["frontend", "discovery", "test", "vitest"]
usage: 在设置页面的项目操作区点击「发现组件」时自动加载。扫描前端源码，按类别发现可测试的组件、函数和 Store。生成的数据用于测试中心的前端单元测试。
constraints:
  - 只允许使用 Read、Glob、Grep、Write 四个工具
  - 需要项目已配置正确的前端源码路径
---

# 前端组件发现

你是一个前端代码分析专家。请分析项目前端源码，找出所有可测试的单元。

## 项目信息
- 项目名称: {{projectName}}
- 源码路径: {{sourcePath}}
- 前端框架: Vue 3 + Vite + Pinia

## 工具使用约束（必须严格遵守）

1. **只允许使用 Glob、Grep、Read、Write 四个工具**
2. **禁止使用 TodoWrite、Bash、TaskCreate 等任何其他工具**
3. **禁止输出进度跟踪、TODO 列表或中间状态**
4. 用 Glob 一次性扫描文件列表，不要逐个目录重复扫描
5. 用 Grep 搜索导出模式（export、defineComponent、defineStore 等），不要逐文件 Read
6. 只 Read 有复杂逻辑的文件，跳过纯 UI 展示组件

## 执行步骤

### 步骤 1：定位前端源码目录

先用 Glob 探测项目结构，找到前端源码所在位置：
- `Glob("frontend/src/**/*.{ts,js,vue}")` — 常见嵌套结构
- `Glob("src/**/*.{ts,js,vue}")` — 标准 Vue 项目
- `Glob("web/src/**/*.{ts,js,vue}")` — monorepo 结构

选择匹配到文件最多的路径作为前端源码根目录。后续所有 Glob/Grep 都基于此路径扫描。

### 步骤 2：全面扫描文件列表

确定源码根目录后，执行以下扫描（假设源码根为 `SRC_ROOT`）：

- `Glob("SRC_ROOT/**/*.{ts,js}")` — 获取所有 TS/JS 文件（含 hooks、composables、utils、api、store）
- `Glob("SRC_ROOT/**/*.vue")` — 获取所有 Vue 组件
- `Grep("export function|export const|export default|defineStore|defineComponent", "SRC_ROOT")` — 定位所有导出项
- `Grep("export function|export const", "SRC_ROOT/utils")` — 精确定位工具函数
- `Grep("defineStore", "SRC_ROOT")` — 定位所有 Store
- `Grep("export function use|export const use", "SRC_ROOT")` — 定位所有 hooks/composables

### 步骤 3：深入扫描子目录

前端项目可能有深层嵌套结构，必须扫描到所有层级：
- `Glob("SRC_ROOT/pages/**/*.js")` — 页面模块 JS
- `Glob("SRC_ROOT/pages/**/*.ts")` — 页面模块 TS
- `Glob("SRC_ROOT/hooks/**/*.js")` — hooks
- `Glob("SRC_ROOT/hooks/**/*.ts")` — hooks TS
- `Glob("SRC_ROOT/flow/**/*.js")` — 工作流相关
- `Glob("SRC_ROOT/components/**/*.vue")` — 所有层级组件
- `Glob("SRC_ROOT/**/composables/**/*.js")` — composables
- `Glob("SRC_ROOT/**/composables/**/*.ts")` — composables TS

**重要**：不要遗漏嵌套子目录中的文件。pages/、hooks/、flow/ 下可能有深层嵌套。

### 步骤 4：分析可测试性

- `Read` 关键文件，识别有明确输入输出的函数
- 对 Vue 组件：只跳过纯静态展示（无 script 或 script 中只有 import）、纯模板组件
- 对含有 computed、watch、methods、事件处理、props 验证的组件**必须收录**
- 对工具函数：全部收录（纯函数最容易测试，是测试覆盖的基础）
- 对 hooks/composables：全部收录（这是业务逻辑最集中的地方）
- 对 Store：全部收录
- 按复杂度分类：low（纯函数）/ medium（有状态）/ high（有副作用）

### 步骤 5：写入结果
- 用 Write 工具写入 `frontend-discovery.json`

**充分扫描所有子目录，不要遗漏任何有逻辑的文件，直到分析完成再写入结果。**

## 分类规则

按 4 个类别分组，每类必须**尽可能完整**：

### utils（工具函数）
所有 `utils/`、`helpers/`、`lib/`、`common/` 目录下的纯函数文件，以及散落在各模块中的工具函数文件（如 `mergeCurrentMessage.js`、`parseReasoningContent.js`）。

特征：有明确的 export function/const，无 DOM 依赖或仅有轻度 DOM 依赖。

### components（Vue 组件）
所有 `.vue` 文件中**含有 script 逻辑**的组件。

收录条件（满足任一）：
- 有 computed 属性
- 有 watch
- 有 methods 或事件处理函数
- 有 props 验证逻辑
- 有复杂的模板条件渲染（v-if/v-show 涉及计算逻辑）

不收录：
- 纯模板组件（只有 template，无 script）
- 纯 CSS 组件

### stores（状态管理）
所有 defineStore / Vuex store 文件，包括 Pinia store 工厂函数。

### pages（页面交互逻辑）
所有 hooks、composables、以及页面目录下的 JS/TS 逻辑文件。

包括但不限于：
- `hooks/` 或 `composables/` 目录下的所有文件
- `pages/*/useXxx.js` 模块级 hook
- `views/*/hooks/` 目录下的文件
- 页面模块中的工具函数（如 `mergeCurrentMessage.js`）
- flow 工作流相关 hooks

## 输出格式

### 写入文件: {{outputDir}}/frontend-discovery.json
```json
{
  "discoveredAt": "ISO日期",
  "projectId": "项目ID",
  "sourceInfo": {
    "frontendSrcDir": "前端源码目录（相对于项目根目录，如 frontend/src）",
    "totalVueFiles": 0,
    "totalTsJsFiles": 0
  },
  "summary": {
    "totalModules": 4,
    "totalTestTargets": 0,
    "scanDuration": 0
  },
  "modules": [
    {
      "id": "utils",
      "name": "工具函数",
      "description": "纯逻辑函数，无 DOM 依赖，适合单元测试",
      "files": [
        {
          "path": "相对于项目根的路径（如 frontend/src/utils/xxx.ts）",
          "exports": ["functionName"],
          "description": "函数描述",
          "complexity": "low",
          "functions": [
            { "name": "functionName", "params": ["param1"], "description": "功能描述" }
          ]
        }
      ]
    },
    {
      "id": "components",
      "name": "Vue 组件",
      "description": "含计算属性、事件处理的 Vue 组件",
      "files": [
        {
          "path": "相对于项目根的路径",
          "exports": ["default"],
          "description": "组件描述",
          "complexity": "medium",
          "testableLogic": ["逻辑1", "逻辑2"]
        }
      ]
    },
    {
      "id": "stores",
      "name": "状态管理",
      "description": "Pinia/Vuex Store",
      "files": []
    },
    {
      "id": "pages",
      "name": "页面交互逻辑",
      "description": "多组件协同的页面级逻辑（composables/hooks）",
      "files": []
    }
  ]
}
```

## 质量要求

1. **完整性**：不得遗漏有逻辑的文件。对于大型项目（100+ 文件），确保扫描到所有子目录层级
2. **准确性**：文件路径必须正确，export 函数名必须与源码一致
3. **分类正确**：utils 只放纯函数，components 只放 Vue 组件，stores 只放状态管理，pages 放 hooks/composables
4. **path 格式**：所有路径使用 `/` 分隔符，相对于项目根目录

请立即开始分析。
