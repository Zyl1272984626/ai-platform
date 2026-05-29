---
name: daily-check
description: 系统健康巡检：检查各学校服务状态、数据库连接、磁盘空间，生成日报
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
tags: ["ops", "monitor", "auto"]
dependencies: ["notifier"]
---

# 日常巡检（全自动）

## 触发方式

- 手动：`/daily-check`
- 定时：Cron 每日 09:00 自动触发

## 执行步骤

### 1. 加载学校列表

从 `data/schools.yaml` 读取所有已部署的学校。

### 2. 逐学校巡检

对每个 status=deployed 的学校：

#### 服务健康检查
```bash
curl -s -o /dev/null -w "%{http_code}" http://{host}:{port}/api/health
```

#### 数据库连接检查
通过 MCP MySQL 尝试连接并执行：
```sql
SELECT 1;
```

#### 磁盘空间检查（SSH）
```bash
df -h /data
```

#### 服务日志检查（SSH）
```bash
tail -n 100 /path/to/logs/error.log
```

### 3. 生成日报

在 `doc/daily-check/` 下生成：
- `daily-report-{日期}.md` — Markdown 日报
- 内容包含：
  - 各学校健康状态表格
  - 异常详情和告警
  - 磁盘空间趋势
  - 错误日志摘要
  - 建议操作

### 4. 通知

通过 `notifier` Skill 发送日报摘要：
- 企业微信/钉钉群
- 邮件（可选）
- 异常项高亮提醒
