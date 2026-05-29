---
name: git-helper
description: Git 操作封装：分支管理、冲突处理、PR 生成、提交规范化
allowed-tools: ["Bash", "Read"]
tags: ["git", "version-control"]
---

# Git 助手

## 能力

### create-fix-branch — 创建修复分支
```bash
git checkout -b fix/bug-{bugId}-{描述}
```

### create-feature-branch — 创建功能分支
```bash
git checkout -b feature/{功能简称}
```

### commit — 规范化提交
自动生成符合规范的 commit message：
- Bug 修复：`fix: {Bug标题} (#{Bug ID})`
- 新功能：`feat: {功能描述}`
- 配置变更：`config: {变更描述}`
- 数据库适配：`fix: {目标库}适配 - {具体修改}`

### push — 推送到远程
带冲突检测：
```bash
git push -u origin {branch}
```

### create-pr — 创建 PR
生成包含以下内容的 PR 描述：
- Summary（变更摘要）
- Changes（变更文件列表）
- Test Plan（测试计划）

### resolve-conflict — 冲突处理
检测冲突文件，分析冲突内容，尝试自动解决或暂停。

### rollback — 回滚
回滚到指定 commit 或最近的稳定状态。

## 安全规则

- 永远不 `push --force` 到 main/master
- 提交前自动 `git diff` 检查
- 不提交 `.env`、密码等敏感文件
- 不跳过 hooks（`--no-verify`）
