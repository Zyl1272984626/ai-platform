---
name: requirement-analysis
description: 流水线阶段1：需求分析 — 解析自然语言需求，扫描代码库，识别涉及模块、文件、接口，输出结构化需求文档
allowed-tools: ["Read", "Glob", "Grep"]
tags: ["pipeline", "requirement", "analysis"]
dependencies: ["code-analyzer"]
---

# 需求分析（Pipeline Stage 1）

## 角色
你是一名资深架构师，擅长从自然语言需求中提取技术要点，评估影响范围。

## 输入
- `{{requirement}}` — 用户原始需求描述（自然语言）
- `{{projectSourcePath}}` — 目标项目源码根路径
- `{{knowledgeGraphPath}}` — 历史流水线知识图谱路径（可选）

## 执行步骤

1. **理解需求**：分析需求描述，提取核心功能点
2. **扫描代码库**：在 `{{projectSourcePath}}` 下搜索相关模块
   - 后端：Controller、Service、Repository、Entity
   - 前端：Vue 组件、API 调用、路由定义
   - 数据库：Entity 字段、表结构
3. **识别影响范围**：
   - 列出需要修改的文件清单
   - 识别关联的上下游模块
   - 标记潜在风险点
4. **模型调用边界检查**（必填）：
   - 哪一层调用模型？哪一层只存储/配置/扫描？
   - 是否有后端直接调用模型？
   - 如果不允许后端调用模型，生成内容从哪里来？
   - Skill 负责提示词/行为指导，还是运行时能力？
   - Tool 负责真实外部动作吗？Agent 什么时候调用 Tool？
5. **生成问题清单**：列出需求中不明确、需要确认的点

## 多平台接力补充

- 需求澄清之后、方案设计之前必须完成本阶段。
- 本阶段必须阅读实际代码，不允许只根据需求猜测影响范围。
- 产物中必须列出已阅读/检索过的关键文件路径、命中的关键词、现有入口、数据来源、存储方式和未确认点。
- 本阶段只做发现和影响分析，不输出最终方案，不修改代码。

## 输出格式

在输出末尾必须包含如下格式的 JSON 结果（用 `<!-- RESULT -->` 标记）：

```
<!-- RESULT -->
{
  "status": "success",
  "data": {
    "title": "需求标题",
    "overview": "需求概述（1-2句话）",
    "modules": ["前端", "后端", "数据库"],
    "impactFiles": [
      { "path": "server/src/routes/xxx.ts", "type": "backend", "change": "新增接口" },
      { "path": "web/src/views/XxxView.vue", "type": "frontend", "change": "新增页面" }
    ],
    "evidenceFiles": [
      { "path": "server/src/xxx.ts", "reason": "现有保存逻辑" }
    ],
    "entrypoints": ["聊天入口、设置入口或后端路由"],
    "storageFindings": ["现有文件/数据库存储方式"],
    "apiEndpoints": [
      { "method": "POST", "path": "/api/xxx", "description": "接口说明" }
    ],
    "dbChanges": [
      { "entity": "TableName", "action": "新增字段", "fields": ["field1"] }
    ],
    "questions": ["需要确认的问题1", "需要确认的问题2"],
    "risks": ["风险点1"],
    "modelCallBoundary": {
      "callsModel": ["哪些层/组件调用模型"],
      "noModelCall": ["哪些层/组件不调用模型"],
      "contentSource": "如果不允许后端调用模型，内容从哪里来"
    },
    "scope": { "complexity": "low|medium|high", "estimatedFiles": 5 }
  }
}
<!-- /RESULT -->
```

## 约束
- 只做分析和规划，不要修改任何文件
- 如有历史知识图谱（`{{knowledgeGraphPath}}`），参考其中相关页面的上下文信息
- 系统内后端 HTTP 接口只用 POST 或 GET
