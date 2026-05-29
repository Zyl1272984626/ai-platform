---
name: test-agent
description: Agent 自动化测试全流程，生成用例、执行流式测试、产出完整报告（基于已有 test-workflow Skill）
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
tags: ["test", "agent", "full-cycle", "auto"]
dependencies: ["zentao-client", "notifier"]
---

# Agent 自动化测试（全自动）

## 触发方式

```
/test-agent agentId userXgh
```

## 说明

本 Skill 基于项目中已有的 `agent-id-test-workflow` Skill（800+ 行成熟逻辑），整合为全自动化流程。

完整 Skill 规范见主系统的 `.claude/skills/agent-id-test-workflow/SKILL.md`。

## 执行步骤

### 1. 解析参数

- agentId（必填）
- userXgh（必填）
- 可选：caseCount（默认12）、includeImageCases（默认auto）

### 2. 数据库准备

通过 MCP MySQL 查询：
- 解析测试用户信息
- 读取 Agent 配置和关联的 Skill

### 3. 生成测试用例

根据 Agent 的业务场景自动生成：
- 身份与能力边界测试
- 核心业务 happy path
- 缺失信息和追问测试
- 权限与隐私拒绝测试
- 数据库查询测试
- 文件/图片流程测试（如支持）
- 多轮对话测试
- 动态追问测试

### 4. 执行测试

调用主系统 API：
```
POST http://127.0.0.1:9998/agent-test/stream
```

逐个执行测试用例，收集：
- SSE 原始数据
- 首 token 延迟
- 完成延迟
- 工具调用链
- 最终回答
- 异常信息

### 5. 产出报告

在 `doc/测试文件/{Agent名}-{userXgh}-{日期}/` 下生成：
- `agent-profile-{agentId}-{userXgh}.md` — Agent 档案
- `agent-test-cases-{agentId}-{userXgh}.json` — 测试用例
- `agent-test-run-{agentId}-{userXgh}-{日期}.md` — 运行记录
- `agent-test-report-{agentId}-{userXgh}-{日期}.json` — 结构化报告
- `agent-test-fail-analysis-{agentId}-{userXgh}-{日期}.md` — 失败分析（核心产出）

### 6. 失败分析

对每个 PARTIAL/FAIL 用例：
- 定位根因（Agent逻辑 / Skill定义 / 后端 / 测试设计 / 数据）
- 给出具体改进建议
- 汇总批量改进点

### 7. 通知与同步

- 通知开发人员测试完成
- 如关联禅道，更新相关 Bug/任务
