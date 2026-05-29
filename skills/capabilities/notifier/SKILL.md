---
name: notifier
description: 通知推送：企业微信、邮件、禅道通知
allowed-tools: ["Bash"]
tags: ["notification", "webhook"]
---

# 通知器

## 能力

### send — 发送通知
根据配置的通知渠道发送消息：
- 企业微信 Webhook
- 邮件（SMTP）
- 禅道评论/通知

### notify-bug-fixed — Bug 修复通知
发送 Bug 修复通知给相关人员：
- Bug 报告人
- 测试人员
- 包含代码变更摘要

### notify-deploy-done — 部署完成通知
发送部署结果通知：
- 部署成功/失败
- 服务健康状态
- 访问地址

### notify-daily-report — 日报通知
发送日常巡检日报摘要。

## 配置

```yaml
# data/config.yaml
notify:
  wechatWebhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
  email:
    smtp: "smtp.example.com"
    from: "ai-platform@example.com"
    to: ["team@example.com"]
```

## 消息格式

企业微信 Markdown：
```
### 🔧 Bug 修复完成
**Bug**: #{id} {title}
**修复人**: AI Platform
**变更**: {变更摘要}
**PR**: {链接}
```
