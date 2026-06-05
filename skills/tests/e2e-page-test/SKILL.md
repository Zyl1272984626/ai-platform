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
- `knowledgeGraphPath`: 知识图谱文件的绝对路径（可选，如不存在则跳过知识图谱加载）
- 项目信息：前端地址、后端 API、登录凭据、待测试页面列表

## 测试模式

| 模式 | 行为 |
|------|------|
| **quick** | 快速巡检：只观察不操作，判断页面是否正常加载、有无白屏和 JS 错误 |
| **standard** | 标准测试：观察 + 根据页面实际情况自主选择关键交互进行验证 |
| **deep** | 深度审计：全面交互探索 + 边界测试 + 异常路径 + 跨页面关联，主动挖掘所有潜在问题 |

## 浏览器资源管理（硬性约束）

- **同时打开的浏览器标签页不得超过 5 个**
- 每个页面测试完成后，**必须关闭当前标签页**（`browser_close`）再打开下一个页面
- 如果测试过程中发现标签页泄漏（超过 5 个），立即关闭多余标签页再继续
- 截图可以复用当前标签页，不需要额外打开新标签

## 增量结果保存（硬性约束）

**每个页面测试完成后，必须立即将结果写入磁盘**，不要等到所有页面测完再统一写入。这是为了：
- 防止上下文过长导致遗忘前面的测试结果
- 即使中途崩溃也能保留已完成的测试数据
- 最终生成报告时直接读取磁盘文件，不依赖上下文记忆

### 目录结构

```
{e2eDataDir}/
  runs/{projectName}/{runId}/
    run.json                    # 运行元数据（开始时间、模式、状态）
    pages/
      {pageId}.json             # 每页独立的结果文件
    screenshots/
      {pageId}-{操作名}.png     # 截图文件
    cross-page-issues.json      # 跨页面关联问题（测试完成后汇总）
  reports/{projectName}/{runId}.html  # 最终 HTML 报告
```

### 保存时机

1. **运行开始时**：写入 `run.json`（含开始时间、模式、状态=running）
2. **每页完成后**：立即写入 `pages/{pageId}.json`，同时更新 `run.json` 中的已完成页面数
3. **发现跨页面问题时**：追加到 `cross-page-issues.json`
4. **全部完成后**：更新 `run.json` 状态为 completed，生成 HTML 报告

### 页面结果文件格式

```json
{
  "pageId": "页面ID",
  "pageName": "页面名称",
  "url": "实际URL",
  "mode": "测试模式",
  "status": "pass|warning|fail|error",
  "score": 0-100,
  "duration": "耗时秒数",
  "testedAt": "ISO时间戳",
  "checks": [
    { "name": "检查项名称", "status": "pass|warning|error", "detail": "详情" }
  ],
  "issues": [
    { "severity": "critical|high|medium|low|suggestion", "title": "问题标题", "description": "问题描述", "evidence": "截图文件名或控制台日志" }
  ],
  "interactions_tested": [
    { "action": "操作描述", "result": "结果描述", "success": true }
  ]
}
```

## 执行流程

### 第 1 步：登录系统

1. 使用 `browser_navigate` 访问登录页
2. 等待页面加载完成（`browser_wait_for`）
3. 填写用户名和密码（`browser_fill_form` 或 `browser_type`）
4. 点击登录按钮（`browser_click`）
5. 等待跳转完成，确认已进入系统主页
6. 如果登录失败，最多重试 3 次

### 第 2 步：加载知识图谱

在开始逐页测试前，读取输入参数中提供的知识图谱文件（如果 `knowledgeGraphPath` 已提供）：
- 使用 `Read` 工具读取 `knowledgeGraphPath` 指向的 `page-context.json` 文件
- 如果该路径不存在或读取失败，跳过此步骤，后续仅基于页面实际内容进行测试
- 将所有页面的上下文信息缓存到内存中，后续每个页面的 Think 阶段可以直接引用

**知识图谱包含什么：**
- `expectedElements`：页面应有的关键元素（辅助判断页面是否完整）
- `interactions`：页面可执行的交互操作（提供测试思路参考）
- `apiEndpoints`：页面调用的 API（辅助发现接口异常）
- `commonIssues`：已知问题（重点关注是否修复）

**重要原则：** 知识图谱仅作参考，如果页面实际内容与图谱不一致，**以实际页面为准**。

### 第 3 步：创建运行记录

创建运行目录和 `run.json`：
```json
{
  "runId": "20260605_095218",
  "projectName": "项目名称",
  "mode": "deep",
  "status": "running",
  "startedAt": "ISO时间戳",
  "totalPages": 62,
  "completedPages": 0,
  "loginStatus": "success"
}
```

### 第 4 步：逐页测试

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

2. **知识图谱对照**（如已加载）
   - 逐条检查 `interactions` 中列出的交互，确认元素是否真实存在
   - 对照 `apiEndpoints`，检查页面是否调用了预期接口、返回是否正常
   - 逐条验证 `commonIssues`，确认问题是否已修复或仍存在
   - 记录图谱与实际页面的差异

3. **制定测试计划**（根据页面类型选择测试策略）

##### 页面类型识别与测试策略

根据页面内容判断其类型，选择对应的测试策略：

**A. CRUD 管理页（表格+增删改查）**
这是最常见的页面类型，需要走完整的数据生命周期：

```
完整生命周期测试（deep 模式必做）：
  1. 新增 → 填写真实合法数据 → 提交 → 验证列表出现新记录 → 搜索能定位到
  2. 编辑 → 点击刚新增记录的编辑 → 修改某字段 → 提交 → 验证修改生效
  3. 删除 → 点击刚新增记录的删除 → 确认 → 验证列表中消失
  4. 搜索 → 输入各种条件搜索 → 验证过滤结果正确

边界和异常测试：
  - 部分必填项为空提交（留空某些必填字段）
  - 超长文本输入（名称输入200+字符）
  - 特殊字符输入（`<script>`、单引号、中文符号）
  - 重复数据提交（新增已存在的同名记录）
  - 搜索不存在的内容（验证空结果状态）
  - 搜索特殊字符（验证不会报错）
```

**B. 只读展示页（表格/卡片，无新增编辑）**
```
  - 搜索/筛选功能验证
  - 分页切换（如有）
  - 折叠/展开（如有）
  - 空结果状态
  - 数据排序（如有）
```

**C. 配置页（设置/开关/参数）**
```
  - 查看当前配置值
  - 切换开关状态 → 验证状态变更
  - 修改配置值 → 保存 → 刷新页面验证持久化
  - 重置为默认值（如有）
```

**D. 详情/预览页**
```
  - 数据完整性（所有字段都有值或合理的空状态）
  - 返回/导航功能
  - 关联数据加载
```

**E. 复杂交互页（设计器/编辑器/流程）**
```
  - 工具栏功能
  - 拖拽操作（如支持）
  - 保存/加载
  - 元素选择和属性编辑
```

4. **跨页面关联思考**

##### 跨页面关联测试

在 Think 阶段，思考当前页面与其他页面的关联关系：

- **数据流关联**：如果页面 A 新增了数据，页面 B 是否应该能看到？（如：新增应用后，权限页应出现该应用）
- **配置依赖**：页面 A 的配置是否影响页面 B 的行为？（如：数据源配置影响知识库源管理）
- **导航关联**：页面间的跳转链接是否正确？（如：应用管理→应用设置的跳转）
- **状态同步**：在页面 A 的操作结果，在页面 B 是否能正确反映？

记录发现的跨页面关联点，测试时进行验证。如果涉及跨页面验证，记录到 `cross-page-issues.json`。

#### Act（操作）— 核心原则：像真实用户一样测试

**最重要的原则：你不是在执行检查清单，你是一个试图发现 bug 的 QA 工程师。**

**测试想象力引导：**

1. **模拟真实用户路径**
   - 用户来到这个页面，第一件想做的事是什么？
   - 用户最可能犯什么错误？（点错按钮、输错格式、漏填字段）
   - 用户会怎么组合使用页面功能？（先搜索再编辑、先筛选再导出）

2. **完整操作，不要只"看"**
   - 新增弹窗不要只打开就关——填写真实数据，真正提交，验证数据持久化
   - 编辑弹窗不要只打开就关——改一个字段，提交，验证改动生效
   - 删除操作不要只看弹窗——先新增一条测试数据，然后删掉它，验证消失
   - 搜索不要只输入一个字——试试精确搜索、模糊搜索、不存在的数据、特殊字符

3. **主动寻找 bug**
   - 这个页面的"坑"可能在哪里？（日期格式？数字输入负数？下拉选项为空？）
   - 有没有看起来对不上的地方？（数据显示和标签不符？状态和实际不一致？）
   - 快速连续点击按钮会怎样？（双击提交、快速切换Tab）
   - 浏览器控制台有没有隐藏的错误？（网络请求失败、Promise rejection）

4. **数据敏感性测试**
   - 搜索框输入 `<script>alert(1)</script>` → 验证不执行脚本
   - 输入 SQL 注入字符串 `'; DROP TABLE` → 验证不报错
   - 输入超长字符串 → 验证不溢出不崩溃
   - 必填字段只输入空格 → 验证校验能捕获

5. **状态一致性测试**
   - 新增后不刷新页面，列表是否自动更新？
   - 编辑后其他地方引用的数据是否同步？
   - 删除后关联数据怎么处理？

#### Validate（验证）

每次操作后：
1. 截图记录操作结果
2. 检查是否有错误弹窗（`.el-message--error`、`.el-notification--error`、`ant-message-error` 等）
3. 检查控制台是否有新的 JS 错误
4. 检查网络是否有新的失败请求
5. 验证操作结果是否符合预期（列表数据变化、状态更新、页面跳转等）

**验证要具体：**
- 不要只说"新增成功"——验证列表中确实出现了新记录，字段值与输入一致
- 不要只说"搜索正常"——验证搜索结果数量和内容确实匹配搜索条件
- 不要只说"删除成功"——验证列表中确实不再有该记录，总数减少

**记录所有发现，包括改进建议：**
- bug：明确的功能缺陷或异常行为
- suggestion：不是 bug 但值得改进的点（如交互体验、性能优化、UI 细节）

#### 页面完成 → 保存结果 → 关闭标签

每个页面测试完成后：
1. **立即保存结果到磁盘**（`Write` 到 `{e2eDataDir}/runs/{projectName}/{runId}/pages/{pageId}.json`）
2. **更新 run.json** 中的已完成页面数
3. **关闭当前浏览器标签页**（`browser_close`），防止标签页堆积

### 第 5 步：跨页面关联汇总

所有页面测试完成后：
1. 读取所有 `pages/*.json` 文件
2. 汇总跨页面关联问题到 `cross-page-issues.json`
3. 验证是否有之前发现的关联点需要在其他页面补充检查

### 第 6 步：生成报告

所有页面测试完成后：
1. 读取 `run.json` 和所有 `pages/*.json` 文件
2. 计算通过率、平均评分、问题统计（按 severity 分组）
3. 将完整结果写入 `{e2eDataDir}/runs/{projectName}/{runId}/run.json`（含所有页面结果的汇总）
4. 生成 HTML 报告写入 `{e2eDataDir}/reports/{projectName}/{runId}.html`

**HTML 报告中应包含：**
- 总览面板：通过率、平均分、各 severity 问题数量
- 逐页结果：每页的 checks、issues、interactions_tested、截图引用
- 改进建议专区：汇总所有 severity=suggestion 的项
- 跨页面问题专区：汇总所有跨页面关联发现

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
- 不要修改或删除任何真实业务数据（可以新增测试数据用于验证，测试完删除）
- 同一页面不要重复操作已验证过的功能
- 截图文件名要清晰（如 `{pageId}-{操作名}.png`）
- 超时设置：单个页面操作不超过 30 秒，整页测试不超过 5 分钟
- **每页测完必须关闭标签页**，防止浏览器资源耗尽
- **每页测完必须保存结果到磁盘**，防止上下文丢失
