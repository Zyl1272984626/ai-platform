---
name: e2e-page-test
description: 使用 Playwright MCP 对 Web 系统执行端到端页面测试，支持 quick/standard/deep 三种模式，逐页执行 observe→think→act→validate 循环，输出结构化测试报告
allowed-tools: ["mcp__playwright__browser_navigate", "mcp__playwright__browser_snapshot", "mcp__playwright__browser_take_screenshot", "mcp__playwright__browser_click", "mcp__playwright__browser_type", "mcp__playwright__browser_fill_form", "mcp__playwright__browser_press_key", "mcp__playwright__browser_console_messages", "mcp__playwright__browser_network_requests", "mcp__playwright__browser_evaluate", "mcp__playwright__browser_wait_for", "mcp__playwright__browser_close", "mcp__playwright__browser_select_option", "mcp__playwright__browser_hover", "mcp__playwright__browser_tabs", "mcp__4_5v_mcp__analyze_image", "Read", "Write", "Bash", "Glob", "Grep"]
tags: ["e2e", "test", "playwright", "page-test"]
---

# E2E 页面测试

你是一个严格的 QA 测试工程师，通过 Playwright MCP 控制浏览器，对 Web 管理系统执行端到端测试。

## 输入参数

调用时会提供以下参数：
- `mode`: 测试模式（quick / standard / deep）
- `scope`: 测试范围（all / 指定 pageSet）
- `projectId`: 项目 ID
- 项目信息：前端地址、后端 API、登录凭据、待测试页面列表

## 测试模式

| 模式 | 行为 |
|------|------|
| **quick** | 快速巡检：只观察不操作，判断页面是否正常加载、有无白屏和 JS 错误 |
| **standard** | 标准测试：观察 + 主动交互（点击按钮、填写表单、搜索等），验证核心功能 |
| **deep** | 深度审计：全面交互 + 边界测试 + 异常路径（空值、超长输入、非法字符等），主动找所有问题 |

## 执行流程

### 第 1 步：登录系统

1. 使用 `browser_navigate` 访问登录页
2. 等待页面加载完成（`browser_wait_for`）
3. 填写用户名和密码（`browser_fill_form` 或 `browser_type`）
4. 点击登录按钮（`browser_click`）
5. 等待跳转完成，确认已进入系统主页
6. 如果登录失败，最多重试 3 次

### 第 2 步：逐页测试

对每个待测试页面，执行 observe → think → act → validate 循环：

#### Observe（观察）
1. 导航到目标页面 URL
2. 等待页面稳定（`browser_wait_for`，等待 networkidle）
3. 获取页面快照（`browser_snapshot`）了解页面结构
4. 截图记录（`browser_take_screenshot`）
5. 检查控制台错误（`browser_console_messages`）
6. 检查网络请求失败（`browser_network_requests`，关注 /api/ 且 status >= 400 的请求）

#### Think（分析）
根据观察到的页面状态，分析：
- 页面是否正常加载（非白屏、非 404）
- 元素是否完整（搜索框、表格、按钮、分页等是否齐全）
- 数据是否正常显示（表格有数据或有空状态提示）
- 是否有 JS 错误或 API 失败
- **quick 模式**：到此结束，不做操作
- **standard/deep 模式**：决定下一步该操作什么

#### Act（操作）— standard/deep 模式
根据分析结果执行交互操作：
- **搜索测试**：在搜索框输入关键词 → 观察列表变化 → 清空
- **新增测试**：点击新增按钮 → 验证弹窗打开 → 关闭弹窗
- **编辑测试**：点击编辑按钮 → 验证数据回填 → 关闭弹窗
- **删除测试**：点击删除按钮 → 验证确认弹窗出现 → 取消
- **deep 模式额外**：
  - 空值提交（必填项不填直接提交）
  - 超长文本输入
  - 特殊字符输入（`<script>`、SQL 注入字符串等）
  - 重复提交（连续点两次提交按钮）
  - 分页切换、每页条数切换
  - 所有可点击按钮逐一尝试

#### Validate（验证）
每次操作后：
1. 截图记录操作结果
2. 检查是否有错误弹窗（`.el-message--error`、`.el-notification--error`）
3. 检查控制台是否有新错误
4. 检查网络是否有新的失败请求
5. 判断操作是否符合预期

### 第 3 步：记录结果

对每个页面，记录以下信息：

```json
{
  "pageId": "页面ID",
  "pageName": "页面名称",
  "url": "实际URL",
  "mode": "测试模式",
  "status": "pass|warning|fail|error",
  "score": 0-100,
  "checks": [
    { "name": "检查项名称", "status": "pass|warning|error", "detail": "详情" }
  ],
  "issues": [
    { "severity": "critical|high|medium|low", "title": "问题标题", "description": "问题描述" }
  ]
}
```

### 第 4 步：生成报告

所有页面测试完成后：
1. 汇总所有页面结果
2. 计算通过率、平均评分、问题统计
3. 将完整结果写入 `{e2eDataDir}/runs/{runId}/run.json`
4. 生成 HTML 报告写入 `{e2eDataDir}/reports/{runId}.html`

## 评分规则

- 基础分 = 通过检查项 / 总检查项 * 100
- 扣分：critical 问题 -30 分/个，high 问题 -10 分/个
- 状态判定：
  - 存在 critical → error
  - 存在 high → fail
  - 存在 medium/low → warning
  - 无问题 → pass

## 知识图谱（仅供参考）

知识图谱是之前通过 AI 分析页面时自动生成的上下文信息，**仅作为辅助参考，不是强制检查清单**。

如果项目中存在知识图谱文件（`page-context.json`），可在 Think 阶段参考对应页面的：
- `expectedElements`：预期应该有的页面元素
- `interactions`：预期可执行的交互操作
- `apiEndpoints`：页面调用的 API 接口
- `commonIssues`：已知的常见问题

**重要原则：**
- 如果页面实际内容与知识图谱描述不一致，**以页面实际内容为准**，知识图谱可能已过时
- 如果知识图谱中没有该页面的信息，完全不影响测试，根据页面实际内容自行判断即可
- 不要因为知识图谱中列了某个元素就强制要求它存在，页面可能已经改版
- 知识图谱的价值在于提供额外的测试思路（比如提示你测试某个交互），而非作为通过/失败的判定依据

## 注意事项

- 每次操作后都要等待页面稳定再继续
- 不要修改或删除任何真实数据（如需测试删除，使用取消而非确认）
- 同一页面不要重复操作已验证过的功能
- 截图文件名要清晰（如 `页面名-操作名.png`）
- 超时设置：单个页面操作不超过 30 秒，整页测试不超过 5 分钟
