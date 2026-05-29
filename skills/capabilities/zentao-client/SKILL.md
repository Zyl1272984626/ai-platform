---
name: zentao-client
description: 禅道 API 封装，支持拉取/更新 Bug、需求、任务，关联代码提交
allowed-tools: ["Bash", "Read"]
tags: ["zentao", "api"]
---

# 禅道客户端

## 能力

### Bug 管理
- **fetch-bug**: 根据 Bug ID 拉取详情（标题、描述、优先级、模块、附件）
- **list-bugs**: 按项目/状态列出 Bug
- **resolve-bug**: 更新 Bug 状态为已修复，添加解决方案
- **close-bug**: 关闭 Bug，添加验证说明

### 需求管理
- **fetch-story**: 拉取需求详情
- **list-stories**: 按项目列出需求

### 任务管理
- **create-task**: 创建任务（关联需求/Bug）
- **update-task**: 更新任务状态和进度

### 关联
- **link-commit**: 关联代码提交到 Bug/需求

## 使用方式

通过禅道 REST API（v12+）调用：

```bash
# 认证
curl -X POST {ZENTAO_URL}/api.php/v1/tokens \
  -H "Content-Type: application/json" \
  -d '{"account":"{user}","password":"{password}"}'

# 拉取 Bug
curl {ZENTAO_URL}/api.php/v1/bugs/{bugId} \
  -H "Token: {token}"

# 更新 Bug
curl -X PUT {ZENTAO_URL}/api.php/v1/bugs/{bugId} \
  -H "Token: {token}" \
  -H "Content-Type: application/json" \
  -d '{"status":"resolved","resolution":"fixed","resolvedBuild":"trunk"}'
```

## 配置

禅道连接信息从环境变量或 `data/config.yaml` 读取：
```yaml
zentao:
  url: "https://zentao.example.com"
  account: "bot"
  password: "***"
```
