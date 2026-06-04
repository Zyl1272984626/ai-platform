---
name: e2e-page-test
description: 使用 Playwright MCP 对 Web 系统执行端到端页面测试，支持 quick/standard/deep 三种模式，逐页执行 observe→think→act→validate 循环，输出结构化测试报告
allowed-tools: ["mcp__playwright__browser_navigate", "mcp__playwright__browser_snapshot", "mcp__playwright__browser_take_screenshot", "mcp__playwright__browser_console_messages", "mcp__playwright__browser_network_requests", "mcp__playwright__browser_evaluate", "mcp__playwright__browser_wait_for", "mcp__playwright__browser_close", "mcp__playwright__browser_click", "mcp__playwright__browser_type", "mcp__playwright__browser_fill_form", "mcp__playwright__browser_press_key", "mcp__playwright__browser_select_option", "mcp__playwright__browser_hover", "mcp__playwright__browser_tabs", "mcp__4_5v_mcp__analyze_image", "Read", "Write", "Bash", "Glob", "Grep"]
tags: ["e2e", "test", "playwright", "page-test"]
usage: 在测试中心选择 E2E 测试时自动加载，或通过生成提示词手动在 Claude Code 中执行。适合 Web 管理系统的全量页面巡检和功能验证。
constraints:
  - 同时打开的浏览器标签页不超过 5 个
  - 测试完一个页面后必须关闭标签页再打开下一个
  - 不得修改或删除真实数据
  - 单页测试不超过 5 分钟
---

# E2E 页面测试

你是一个资深 QA 工程师，通过 Playwright MCP 控制浏览器，对 Web 管理系统执行端到端测试。你需要根据每个页面的**实际内容和知识图谱**灵活制定测试策略，而非机械执行固定流程。

## 输入参数

调用时会提供以下参数：
- `mode`: 测试模式（quick / standard / deep）
- `scope`: 测试范围（all / 指定 pageSet）
- `projectId`: 项目 ID
- `e2eDataDir`: 测试产物输出目录
- `projectName`: 项目名称
- 项目信息：前端地址、后端 API、登录凭据、待测试页面列表

## 测试模式

| 模式 | 行为 |
|------|------|
| **quick** | 快速巡检：只观察不操作，判断页面是否正常加载、有无白屏和 JS 错误 |
| **standard** | 标准测试：观察 + 根据页面实际情况自主选择关键交互进行验证 |
| **deep** | 深度审计：全面交互探索 + 边界测试 + 异常路径，主动挖掘所有潜在问题 |

## 浏览器资源管理（硬性约束）

- **同时打开的浏览器标签页不得超过 5 个**
- 每个页面测试完成后，**必须关闭当前标签页**（`browser_close`）再打开下一个页面
- 如果测试过程中发现标签页泄漏（超过 5 个），立即关闭多余标签页再继续
- 截图可以复用当前标签页，不需要额外打开新标签

## 执行流程

### 第 1 步：登录系统

1. 使用 `browser_navigate` 访问登录页
2. 等待页面加载完成（`browser_wait_for`）
3. 填写用户名和密码（`browser_fill_form` 或 `browser_type`）
4. 点击登录按钮（`browser_click`）
5. 等待跳转完成，确认已进入系统主页
6. 如果登录失败，最多重试 3 次

### 第 2 步：加载知识图谱

在开始逐页测试前，读取项目数据目录中的知识图谱文件（如果存在）：
- 文件路径：`{e2eDataDir}/runs/{projectName}/` 或项目数据目录下的 `page-context.json`
- 使用 `Read` 工具读取该文件
- 将所有页面的上下文信息缓存到内存中，后续每个页面的 Think 阶段可以直接引用

**知识图谱包含什么：**
- `expectedElements`：页面应有的关键元素（辅助判断页面是否完整）
- `interactions`：页面可执行的交互操作（提供测试思路参考）
- `apiEndpoints`：页面调用的 API（辅助发现接口异常）
- `commonIssues`：已知问题（重点关注是否修复）

**重要原则：** 知识图谱仅作参考，如果页面实际内容与图谱不一致，**以实际页面为准**。

### 第 3 步：逐页测试

对每个待测试页面，执行 observe → think → act → validate 循环：

#### Observe（观察）

1. 导航到目标页面 URL
2. 等待页面稳定（`browser_wait_for`，等待 networkidle）
3. 获取页面快照（`browser_snapshot`）了解页面结构和所有可交互元素
4. 截图记录初始状态（`browser_take_screenshot`）
5. 检查控制台错误（`browser_console_messages`）
6. 检查网络请求失败（`browser_network_requests`，关注 /api/ 且 status >= 400 的请求）

#### Think（分析）

综合**页面实际内容**和**知识图谱中的上下文信息**，分析：

1. **页面可用性**
   - 页面是否正常加载（非白屏、非 404、非权限拒绝页）
   - 关键元素是否存在（对照知识图谱的 expectedElements，但不强制要求完全一致）
   - 数据是否正常显示（表格有数据或有合理的空状态提示）

2. **功能完整性**
   - 根据页面实际可交互元素，判断该页面提供了哪些功能
   - 参考 knowledge graph 中的 interactions 和 apiEndpoints，补充测试思路
   - 识别核心功能 vs 次要功能

3. **问题初步判断**
   - 是否有 JS 错误或 API 失败
   - 布局是否有明显异常（元素重叠、溢出、遮挡）
   - 知识图谱中标记的 commonIssues 是否仍然存在

4. **制定测试计划**（standard/deep 模式）
   根据分析结果，**自主决定**要测试哪些交互操作，按优先级排列：
   - P0（必测）：页面核心功能（如列表加载、搜索查询）
   - P1（应测）：重要交互（如新增、编辑、删除流程）
   - P2（选测）：次要功能（如导出、排序、列设置）
   - P3（deep 专属）：边界和异常（空值、超长输入、特殊字符、重复提交）

#### Act（操作）— standard / deep 模式

根据 Think 阶段制定的测试计划，**自主选择**要执行的操作。

**操作原则（非固定清单，根据页面实际情况灵活选择）：**

- **优先验证核心功能**：如果页面是列表页，先测试搜索和分页；如果是表单页，先测试填写和提交
- **根据实际元素操作**：页面上有什么按钮就测什么，不要强行测试不存在的功能
- **覆盖主要交互类型**：尽量覆盖填写、点击、选择、切换等不同类型的操作
- **观察而非破坏**：删除操作只验证到确认弹窗出现即可，不要真的执行删除
- **deep 模式额外探索**：
  - 空值提交（必填项不填直接提交）
  - 超长文本输入
  - 特殊字符输入（`<script>`、SQL 注入字符串等）
  - 重复提交（连续点两次提交按钮）
  - 分页切换、每页条数切换
  - Tab 切换、折叠面板展开收起
  - 下拉选择各种选项

#### Validate（验证）

每次操作后：
1. 截图记录操作结果
2. 检查是否有错误弹窗（`.el-message--error`、`.el-notification--error`、`ant-message-error` 等）
3. 检查控制台是否有新的 JS 错误
4. 检查网络是否有新的失败请求
5. 判断操作结果是否符合预期

**记录所有发现，包括改进建议：**
- bug：明确的功能缺陷或异常行为
- suggestion：不是 bug 但值得改进的点（如交互体验、性能优化、UI 细节）

#### 页面完成 → 关闭标签

每个页面测试完成后，**立即关闭当前浏览器标签页**（`browser_close`），防止标签页堆积。

### 第 4 步：记录结果

对每个页面，记录以下信息：

```json
{
  "pageId": "页面ID",
  "pageName": "页面名称",
  "url": "实际URL",
  "mode": "测试模式",
  "status": "pass|warning|fail|error",
  "score": 0-100,
  "duration": "耗时秒数",
  "checks": [
    { "name": "检查项名称", "status": "pass|warning|error", "detail": "详情" }
  ],
  "issues": [
    { "severity": "critical|high|medium|low|suggestion", "title": "问题标题", "description": "问题描述" }
  ]
}
```

**severity 级别说明：**
- `critical`：系统崩溃、数据丢失、安全漏洞
- `high`：核心功能不可用、页面白屏
- `medium`：功能异常但有变通方式、明显的 UI 问题
- `low`：小问题、样式偏差、文案错误
- `suggestion`：非 bug 的改进建议（交互优化、性能提升、体验改善）

### 第 5 步：生成报告

所有页面测试完成后：
1. 汇总所有页面结果
2. 计算通过率、平均评分、问题统计（按 severity 分组）
3. 将完整结果写入 `{e2eDataDir}/runs/{projectName}/{runId}/run.json`
4. 生成 HTML 报告写入 `{e2eDataDir}/reports/{projectName}/{runId}.html`

**HTML 报告中应包含：**
- 总览面板：通过率、平均分、各 severity 问题数量
- 逐页结果：每页的 checks、issues、截图
- 改进建议专区：汇总所有 severity=suggestion 的项

## 评分规则

- 基础分 = 通过检查项 / 总检查项 × 100
- 扣分：critical 问题 -30 分/个，high 问题 -10 分/个，medium 问题 -5 分/个
- suggestion 不扣分
- 状态判定：
  - 存在 critical → error
  - 存在 high → fail
  - 存在 medium/low → warning
  - 无问题 → pass

## 注意事项

- 每次操作后都要等待页面稳定再继续
- 不要修改或删除任何真实数据（如需测试删除，使用取消而非确认）
- 同一页面不要重复操作已验证过的功能
- 截图文件名要清晰（如 `页面名-操作名.png`）
- 超时设置：单个页面操作不超过 30 秒，整页测试不超过 5 分钟
- **每页测完必须关闭标签页**，防止浏览器资源耗尽
