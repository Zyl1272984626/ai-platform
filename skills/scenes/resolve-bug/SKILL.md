---
name: resolve-bug
description: 从禅道拉取 Bug，自动定位分析、修复代码、编译验证、提交 PR、更新禅道，全流程自动完成
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
tags: ["bugfix", "zentao", "full-cycle", "auto"]
dependencies: ["zentao-client", "code-analyzer", "git-helper", "notifier"]
---

# Bug 修复全流程（全自动）

## 触发方式

用户输入 `/resolve-bug BUG-123` 或提供 Bug ID。

## 执行步骤（全自动，无需人工干预）

### 1. 拉取 Bug 信息

调用 `zentao-client` Skill 从禅道获取 Bug 详情：
- Bug 标题、描述、优先级、严重程度
- 关联的项目和模块
- 报告人指出的可能原因或复现步骤
- 已有的评论和截图

### 2. 代码定位与分析

调用 `code-analyzer` Skill：
- 根据 Bug 描述中的关键词搜索相关代码文件
- 分析调用链和依赖关系
- 识别可能的 Bug 根因
- 生成修复方案

输出格式：
```json
{
  "rootCause": "根因描述",
  "affectedFiles": ["文件路径列表"],
  "fixPlan": "修复方案描述",
  "riskLevel": "low|medium|high"
}
```

### 3. 自动修复

基于分析结果修复代码：
- 严格按照 fixPlan 修改代码
- 修复范围限定在 affectedFiles 内
- 如果修复涉及超过 3 个文件，暂停等待确认
- 保持代码风格一致

### 4. 编译验证

修改完成后自动执行编译检查：
- `mvn compile -f backend/pom.xml`
- 编译失败则分析错误，尝试修复，最多重试 2 次
- 2 次仍失败则回滚修改，暂停等待人工

### 5. 提交代码

调用 `git-helper` Skill：
- 创建修复分支 `fix/bug-{bugId}-{简短描述}`
- 提交修改：`fix: {Bug标题}`
- 如果有远程仓库权限，推送到远程

### 6. 同步禅道

调用 `zentao-client` Skill：
- 更新 Bug 状态为"已修复"
- 添加解决方案描述
- 关联代码提交记录
- 指派给测试人员验证

### 7. 通知

调用 `notifier` Skill：
- 通知报告人 Bug 已修复
- 通知测试人员需要验证
- 包含代码变更摘要和测试建议

## 检查门（GATE）

| 条件 | 动作 |
|------|------|
| 修复涉及 > 3 个文件 | 暂停，展示修改文件列表，等待确认 |
| 编译失败 2 次 | 回滚，展示错误信息，暂停 |
| riskLevel = high | 暂停，展示风险分析，等待确认 |
| 禅道连接失败 | 跳过同步步骤，记录待同步 |

## 失败恢复

所有步骤的状态保存在 `data/runs/{runId}/state.json`。

重试时从断点继续：
- 如果在步骤 3 失败，重试时从步骤 3 开始
- 已完成的步骤不会重复执行
- 回滚的修改会从 state 中获取 diff 还原
