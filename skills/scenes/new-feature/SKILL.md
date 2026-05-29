---
name: new-feature
description: 新功能全流程开发：需求分析 → 方案设计 → 编码实现 → 自测 → 代码审查，生成完整 PR
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
tags: ["feature", "develop", "full-cycle", "auto"]
dependencies: ["code-analyzer", "git-helper"]
---

# 新功能全流程开发（全自动）

## 触发方式

用户输入 `/new-feature` 后跟需求描述，例如：
```
/new-feature 添加用户导出功能，支持按日期范围筛选，导出为 Excel
```

## 执行步骤（全自动）

### 1. 需求理解与澄清

- 分析用户提供的自然语言需求
- 识别涉及的模块（前端/后端/数据库）
- 列出需要确认的问题（如有歧义）
- 如果信息不足，暂停请求补充

### 2. 方案设计

调用 `code-analyzer` Skill 分析现有架构：
- 确定需要修改/新增的文件
- 设计 API 接口（POST/GET）
- 设计数据库表变更（如需）
- 设计前端页面/组件变更

输出方案文档，包含：
- 影响范围
- API 设计
- 数据库变更
- 前端变更

### 3. 编码实现

按方案顺序实现：
1. **数据库**：新增表/字段（如有）
2. **后端**：Entity → Repository → Service → Controller
3. **前端**：API 调用 → 页面组件 → 路由

遵循项目现有代码风格：
- 后端：JPA Entity + Spring Boot Controller
- 前端：Vue3 + TypeScript + Element Plus
- 系统内 HTTP 接口只用 POST 或 GET

### 4. 编译验证

```bash
cd backend && mvn compile
cd frontend && npm run build
```
编译失败自动修复，最多 2 次。

### 5. 代码自审

对生成的代码进行自审：
- 检查安全漏洞（SQL 注入、XSS）
- 检查代码风格一致性
- 检查 API 接口是否符合规范（只用 POST/GET）
- 检查异常处理
- 输出审查报告

### 6. 提交 PR

调用 `git-helper` Skill：
- 创建功能分支 `feature/{功能简称}`
- 提交所有变更
- 生成 PR 描述（包含需求、方案、变更文件列表）

## 检查门（GATE）

| 条件 | 动作 |
|------|------|
| 需求有歧义 | 暂停，列出问题，等待用户确认 |
| 涉及数据库表结构变更 | 暂停，展示 DDL，等待确认 |
| 编译失败 2 次 | 暂停，展示错误 |
| 发现安全风险 | 暂停，展示风险详情 |
