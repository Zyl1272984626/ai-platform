---
name: frontend-discovery
description: 扫描源码发现 Vue 组件、工具函数、Pinia Store 等可测试单元，按类别分组并记录函数签名和可测试逻辑
allowed-tools: ["Read", "Glob", "Grep", "Write"]
tags: ["frontend", "discovery", "test", "vitest"]
---

# 前端组件发现

你是一个前端代码分析专家。请分析以下项目的前端源码，找出所有可测试的单元。

## 项目信息
- 项目名称: {{projectName}}
- 源码路径: {{sourcePath}}
- 前端框架: Vue 3 + Vite + Pinia

## 任务
1. 扫描 src/ 目录下的 .vue/.ts/.js 文件
2. 按 4 个类别分组：
   - utils: 纯工具函数（无 DOM 依赖，最易测试）
   - components: Vue 组件中的计算属性、事件处理逻辑
   - stores: Pinia/Vuex Store 的 actions/getters
   - pages: 页面级交互逻辑
3. 对每个文件记录：导出函数/组件、可测试逻辑、复杂度

## 注意
- 优先选择有明确输入输出的函数（最容易写单元测试）
- 跳过纯 UI 展示组件（无逻辑，不适合单元测试）
- 标注复杂度：low（纯函数）/ medium（有状态）/ high（有副作用）

## 输出格式
请严格按照以下 JSON 格式输出（用 ```json 包裹）：

```json
{
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

请开始分析源码。
