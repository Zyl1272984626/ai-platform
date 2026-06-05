---
name: e2e-report
description: 基于 E2E 测试运行数据生成可视化 HTML 报告。读取 run.json 和所有 pages/*.json，汇总统计、问题分类、截图引用，输出单文件 HTML 报告。
allowed-tools: ["Read", "Write", "Bash", "Glob", "Grep"]
tags: ["e2e", "report", "html"]
usage: 在 E2E 测试完成后手动调用，或通过生成提示词执行。读取已有的测试产物目录，生成 HTML 报告。
---

# E2E 测试报告生成

你是一个报告生成工具，读取 E2E 页面测试的产物数据，生成美观、信息完整的单文件 HTML 报告。

## 输入参数

调用时会提供以下参数：
- `runDir`: 测试运行目录的绝对路径（如 `F:/test/e2e/runs/主系统(Agent)/20260605_101435/`）
- `projectName`: 项目名称（用于报告标题）
- `reportOutputPath`: 报告输出路径（可选，默认为 `{runDir}/../../reports/{projectName}/{runId}.html`）

如果未提供 `runDir`，要求用户提供。

## 执行步骤

### 第 1 步：读取数据

1. 读取 `{runDir}/run.json` 获取运行元数据
2. 使用 Glob 扫描 `{runDir}/pages/*.json` 获取所有页面结果文件列表
3. 逐一读取每个页面的 JSON 结果
4. 读取 `{runDir}/cross-page-issues.json`（如存在）

### 第 2 步：统计数据

计算以下指标：
- 总页面数、各状态（pass/warning/fail/error）数量和占比
- 通过率（仅 pass 状态计为通过）
- 平均评分（所有页面 score 的平均值）
- 问题统计（按 critical/high/medium/low/suggestion 分组）
- 总截图数（扫描每个 pageDir 下的 .png 文件数量）
- 总耗时（所有页面 duration 之和）

### 第 3 步：生成 HTML 报告

生成一个**完整的单文件 HTML**，包含内联 CSS 和 JavaScript（不依赖外部资源）。

#### 报告结构

```
1. 顶部横幅（Header）
   - 报告标题 + 项目名称
   - 引擎标签 "Claude Code AI Agent"
   - 运行元信息（runId、模式、测试范围）

2. 总览面板（Summary）- 6个统计卡片
   - 通过率（百分比 + 页面数）
   - 平均评分
   - 发现问题总数
   - 总耗时
   - 总截图数
   - 失败页面数

3. 问题总览（Issues Overview）
   - 按 severity 分组展示所有 non-suggestion 问题
   - 每条显示：页面标签 + severity 标识 + 标题 + 描述
   - severity 用不同颜色标识（critical红/high红/medium黄/low绿）

4. 筛选栏（Filter Bar）
   - 全部 / 通过 / 警告 / 失败 / 错误 按钮

5. 主体内容区（Content Area）= 左侧边栏 + 右侧详情

   左侧边栏（Sidebar）：
   - 每页一个条目：状态图标 + 页面名称 + 评分
   - 点击切换右侧显示对应页面详情
   - 支持按状态筛选

   右侧详情（Page Detail）：
   - 页面标题 + 评分徽章
   - URL（可点击）
   - 耗时 + 模式
   - AI Agent 测试时间线（基于 interactions_tested）
   - 检查项列表（checks，带 pass/warning 图标）
   - 发现问题列表（issues，带 severity 标识）
   - 截图画廊（引用相对路径的图片，点击放大）
```

#### 截图路径处理

截图文件在 `{runDir}/pages/{pageId}/` 目录下。HTML报告中的图片路径使用相对路径：

```
../runs/{projectName}/{runId}/pages/{pageId}/{screenshot}.png
```

或者如果报告和runs在同一父目录下：
```
../runs/{projectName}/{runId}/pages/{pageId}/{screenshot}.png
```

扫描每个 pageDir 下所有 `.png` 和 `.jpeg` 文件，按文件名排序展示。

#### 样式规范

- 使用现代 CSS，不依赖任何框架
- 配色：深蓝渐变头部 (#1a1a2e → #16213e)，白色内容区
- 状态色：pass=#52c41a, warning=#faad14, fail=#ff4d4f, error=#cf1322
- 字体：-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
- 截图画廊：grid 布局，minmax(300px, 1fr)
- Lightbox：点击截图放大查看
- 响应式：支持缩小窗口

#### JavaScript 功能

```javascript
function showPage(idx)  // 切换右侧显示的页面详情
function filterPages(status)  // 按状态筛选左侧边栏
function showLightbox(thumb)  // 截图放大查看
```

### 第 4 步：写入报告

将生成的 HTML 写入到 `reportOutputPath`。如果路径中的目录不存在，先创建。

### 第 5 步：输出结果

告知用户报告文件路径，可以用浏览器直接打开。

## 跨页面问题专区

如果存在 `cross-page-issues.json`，在问题总览后面增加"跨页面问题"专区：
- 每条显示：ID + severity + 标题 + 描述 + affectedPages 标签 + suggestion

## 改进建议专区

汇总所有 severity=suggestion 的 issues，放在单独的折叠区域中：
- 按页面分组显示
- 每条显示：页面标签 + 标题 + 描述

## 注意事项

- HTML 必须是单文件，所有 CSS 和 JS 内联
- 截图路径必须是相对路径，确保本地文件系统可访问
- 报告应该用浏览器直接打开 file:// 协议就能正常显示
- 如果某个页面没有截图，显示"无截图"文字而非空白
- 如果 run.json 中没有 summary 字段，自行从 pages 数据计算
