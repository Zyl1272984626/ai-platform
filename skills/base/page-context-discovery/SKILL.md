---
name: page-context-discovery
description: 使用 Playwright MCP 逐页打开项目页面，分析页面结构、元素、API调用和交互行为，自动生成 E2E 测试用的知识图谱
allowed-tools: ["mcp__playwright__browser_navigate", "mcp__playwright__browser_snapshot", "mcp__playwright__browser_take_screenshot", "mcp__playwright__browser_console_messages", "mcp__playwright__browser_network_requests", "mcp__playwright__browser_wait_for", "mcp__playwright__browser_click", "mcp__playwright__browser_close", "Read", "Write", "Bash"]
tags: ["e2e", "discovery", "knowledge", "page-context"]
---

# 页面知识图谱发现

你是一个页面分析专家，通过 Playwright MCP 控制浏览器，逐页打开项目页面并分析其结构，生成 E2E 测试用的知识图谱。

## 输入参数

调用时会提供以下参数：
- 项目名称: {{projectName}}
- 前端地址: {{baseUrl}}
- 后端 API: {{apiBaseUrl}}
- 登录页: {{baseUrl}}{{loginUrl}}
- 登录凭据: {{username}} / {{password}}
- 待分析页面列表（从项目 pageSets 读取）
- 动态参数值（页面 URL 中含动态参数时可直接替换，无需探索）:
{{globalParamsHint}}

## 执行流程

### 第 1 步：读取项目页面列表

读取项目配置文件 `{{dataDir}}/project.json`，从中获取所有 pageSets 和页面信息。
提取每个页面的 id、name、url（完整访问地址 = baseUrl + url）。

### 第 2 步：登录系统

1. 使用 `browser_navigate` 访问 `{{baseUrl}}{{loginUrl}}`
2. 等待页面加载完成（`browser_wait_for`）
3. 填写用户名 `{{username}}` 和密码 `{{password}}`（`browser_snapshot` 先查看表单结构）
4. 点击登录按钮
5. 等待跳转完成

### 第 3 步：逐页分析

对每个页面执行以下操作：

#### 3.1 导航到页面
- `browser_navigate` 到 `baseUrl + page.url`
- `browser_wait_for` 等待 `networkidle`（最多 10 秒）

#### 3.2 采集页面信息
- `browser_snapshot` 获取无障碍树（了解页面结构和所有元素）
- `browser_network_requests` 收集该页面发出的 API 请求
- `browser_take_screenshot` 截图留档

#### 3.3 分析并记录
根据采集到的信息，分析以下内容：

- **description**: 这个页面的功能是什么（1-2 句话描述）
- **expectedElements**: 页面上有哪些关键元素（搜索框、新增按钮、数据表格、分页、弹窗触发按钮、Tab切换等）
- **apiEndpoints**: 从 network_requests 中提取的 /api/ 请求，记录 method、path、简要描述
- **interactions**: 页面上可以执行哪些交互操作，每步操作的预期结果是什么
  - 如：点击新增按钮 → 弹窗打开，表单字段为空
  - 如：在搜索框输入关键词 → 列表按关键词过滤
  - 如：点击编辑按钮 → 弹窗打开，表单数据回填
- **commonIssues**: 根据页面结构推测可能存在的问题（如空数据状态、加载失败处理等）

#### 3.4 翻页（如有分页）
如果页面有分页组件，点击下一页再采集一次网络请求，补充可能遗漏的 API。

### 第 4 步：输出结果

所有页面分析完成后，将结果写入 `{{dataDir}}/page-context.json`。

**输出格式（严格按照以下 JSON 结构）：**

```json
{
  "_meta": {
    "generatedAt": "2025-01-01T00:00:00.000Z",
    "projectId": "项目ID",
    "totalPages": 10
  },
  "pageId-1": {
    "pageName": "页面名称",
    "url": "/path/to/page",
    "description": "页面功能描述",
    "expectedElements": ["搜索框", "新增按钮", "数据表格", "操作按钮(编辑/删除)", "分页组件"],
    "apiEndpoints": [
      { "method": "GET", "path": "/api/xxx/page", "description": "分页查询列表" },
      { "method": "POST", "path": "/api/xxx/save", "description": "保存数据" }
    ],
    "interactions": [
      { "action": "点击新增按钮", "expected": "弹窗打开，表单字段为空" },
      { "action": "在搜索框输入关键词", "expected": "列表按关键词过滤" }
    ],
    "commonIssues": ["空数据时无提示", "搜索结果不准确"]
  },
  "pageId-2": { ... }
}
```

**重要：**
- pageId 必须使用项目配置中的页面 id（从 project.json 中读取），不要自己编造
- 每个页面的 key 就是它的 pageId
- 如果某个页面无法访问（404、白屏等），仍然记录但 description 中注明"页面不可访问"
- apiEndpoints 只记录 /api/ 开头的请求，跳过静态资源请求

## 注意事项

- 每个页面分析时间控制在 30 秒以内
- 不要修改页面上的任何数据
- 如果登录失败，最多重试 2 次
- 分析完成后关闭浏览器（`browser_close`）
