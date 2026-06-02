---
name: frontend-discovery
description: 扫描源码发现 Vue 组件、工具函数、Pinia Store 等可测试单元，按类别分组并记录函数签名和可测试逻辑
allowed-tools: ["Read", "Glob", "Grep", "Write"]
tags: ["frontend", "discovery", "test", "vitest"]
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

### 步骤 1：快速扫描文件列表
- `Glob("src/**/*.{ts,js}")` — 获取工具函数和 Store 文件
- `Glob("src/**/*.vue")` — 获取组件文件
- `Grep("export function|export const|defineStore", pattern)` — 定位导出项

### 步骤 2：分析可测试性
- `Read` 关键文件，识别有明确输入输出的函数
- 跳过纯 UI 展示组件（无逻辑的不需要单元测试）
- 按复杂度分类：low（纯函数）/ medium（有状态）/ high（有副作用）

### 步骤 3：写入结果
- 用 Write 工具写入 `frontend-discovery.json`

**充分扫描，不要遗漏，直到分析完成再写入结果。**

## 分类规则
按 4 个类别分组：
- **utils**: 纯工具函数（无 DOM 依赖，最易测试）
- **components**: Vue 组件中的计算属性、事件处理逻辑
- **stores**: Pinia/Vuex Store 的 actions/getters
- **pages**: 页面级交互逻辑

## 输出格式

### 写入文件: {{outputDir}}/frontend-discovery.json
```json
{
  "discoveredAt": "ISO日期",
  "projectId": "项目ID",
  "summary": {
    "totalModules": 4,
    "totalTestTargets": 50,
    "scanDuration": 0
  },
  "modules": [
    {
      "id": "utils",
      "name": "工具函数",
      "description": "纯逻辑函数，无 DOM 依赖，适合单元测试",
      "files": [
        {
          "path": "src/utils/xxx.ts",
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
          "path": "src/components/Xxx.vue",
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
      "description": "多组件协同的页面级逻辑",
      "files": []
    }
  ]
}
```

请立即开始分析。
