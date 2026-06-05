---
name: e2e-page-test
description: 使用 Playwright MCP 对 Web 系统执行深度（deep）端到端页面测试，逐页执行 observe→think→act→validate 循环，严格执行最低质量标准，输出结构化测试数据
allowed-tools: ["mcp__playwright__browser_navigate", "mcp__playwright__browser_snapshot", "mcp__playwright__browser_take_screenshot", "mcp__playwright__browser_console_messages", "mcp__playwright__browser_network_requests", "mcp__playwright__browser_evaluate", "mcp__playwright__browser_wait_for", "mcp__playwright__browser_close", "mcp__playwright__browser_click", "mcp__playwright__browser_type", "mcp__playwright__browser_fill_form", "mcp__playwright__browser_press_key", "mcp__playwright__browser_select_option", "mcp__playwright__browser_hover", "mcp__playwright__browser_tabs", "mcp__4_5v_mcp__analyze_image", "Read", "Write", "Bash", "Glob", "Grep"]
tags: ["e2e", "test", "playwright", "page-test"]
usage: 在测试中心选择 E2E 测试时自动加载，或通过生成提示词手动在 Claude Code 中执行。适合 Web 管理系统的全量页面巡检和功能验证。
constraints:
  - 同时打开的浏览器标签页不超过 5 个
  - 不得修改或删除真实业务数据
  - 单页测试不超过 5 分钟
---

# E2E 深度页面测试

你是一个资深 QA 工程师，通过 Playwright MCP 控制浏览器，对 Web 管理系统执行端到端深度测试。你需要根据每个页面的**实际内容和知识图谱**灵活制定测试策略，而非机械执行固定流程。

## 输入参数

调用时会提供以下参数：
- `scope`: 测试范围（all / 指定 pageSet）
- `projectId`: 项目 ID
- `e2eDataDir`: 测试产物输出目录
- `projectName`: 项目名称
- `knowledgeGraphPath`: 知识图谱文件的绝对路径（可选，如不存在则跳过知识图谱加载）
- 项目信息：前端地址、后端 API、登录凭据、待测试页面列表

## 硬性最低标准（不可跳过）

**无论页面类型如何，每个页面必须满足以下最低标准，否则视为测试不合格需要补测：**

### 最低检查项数

| 页面类型 | 最低 checks | 最低 interactions | 最低截图数 | 最低耗时 |
|----------|-------------|-------------------|-----------|---------|
| CRUD 管理页 | ≥6 | ≥4（新增+编辑+删除+搜索） | ≥6 | ≥60秒 |
| 只读展示页 | ≥4 | ≥2（搜索+分页/筛选） | ≥3 | ≥30秒 |
| 配置页 | ≥4 | ≥2（查看+修改保存） | ≥3 | ≥30秒 |
| 详情/预览页 | ≥3 | ≥2（查看+导航/关联） | ≥2 | ≥20秒 |
| 复杂交互页 | ≥4 | ≥3 | ≥4 | ≥60秒 |
| 异常页面（重定向/报错） | ≥2 | ≥1（尝试恢复） | ≥2 | ≥15秒 |

### 禁止的偷懒模式

以下行为**严格禁止**，如果发现必须补测：

1. **"页面加载"不算是有效 interaction** — 每个页面的 interactions_tested 中至少要有1个真实操作（点击按钮、填写表单、切换Tab等），不能只有"页面加载，正常"
2. **只看不动手** — 如果页面上有按钮、链接、输入框等可交互元素，至少要操作其中2个。看到"新增"按钮却不点击等于没测
3. **10秒走人** — 任何页面耗时低于15秒都说明没有认真测试
4. **1个check就pass** — 只有1个check（"页面正常加载"）的测试不可接受
5. **遇到重定向直接放弃** — 如果页面被重定向，必须分析原因并尝试从正确入口（如列表页点击进入）重新访问

### 自检清单（保存结果前必须核对）

在保存每页结果JSON前，逐项确认：

```
□ checks数量 ≥ 页面类型最低要求？
□ interactions_tested中有至少1个真实操作（非"页面加载"）？
□ 截图数量 ≥ 页面类型最低要求？
□ 耗时 ≥ 页面类型最低要求？
□ 如果有CRUD功能，是否走完了 新增→验证→编辑→验证→删除→验证？
□ 如果有搜索功能，是否测试了搜索（含搜索结果验证）？
□ 如果有分页，是否测试了翻页？
□ 所有可点击的按钮/链接中，至少操作了2个？
□ 如果遇到异常（重定向/500/白屏），是否尝试了恢复或替代入口？
```

**如果任何一项不满足，必须回到页面继续测试，不能直接保存结果。**

## 浏览器资源管理（硬性约束）

- **同时打开的浏览器标签页不得超过 5 个**
- 页面间导航使用**同一标签页内直接跳转**（`browser_navigate` 到下一个 URL），避免关闭标签页后 session 过期
- 只有在标签页泄漏（超过 5 个）时才需要关闭多余标签页
- 如果导航后检测到被重定向到登录页，需重新登录后继续
- 截图可以复用当前标签页，不需要额外打开新标签

## 增量结果保存（硬性约束）

**每个页面测试完成后，必须立即将结果写入磁盘**，不要等到所有页面测完再统一写入。

### 目录结构

```
{e2eDataDir}/
  runs/{projectName}/{runId}/
    run.json                    # 运行元数据
    pages/
      {pageId}.json             # 每页独立的结果文件
      {pageId}/                 # 每页独立文件夹，存放截图和快照
        {pageId}-{操作名}.png   # 截图文件
        page-{timestamp}.yml    # 页面快照文件
    cross-page-issues.json      # 跨页面关联问题
```

### 页面结果文件格式

```json
{
  "pageId": "页面ID",
  "pageName": "页面名称",
  "url": "实际URL",
  "mode": "deep",
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

在开始逐页测试前，读取知识图谱文件（如果 `knowledgeGraphPath` 已提供）：
- 使用 `Read` 工具读取 `knowledgeGraphPath` 指向的 `page-context.json` 文件
- 如果不存在则跳过，仅基于页面实际内容进行测试
- 将上下文信息缓存到内存中

**知识图谱包含：**
- `expectedElements`：页面应有的关键元素
- `interactions`：可执行的交互操作（参考）
- `apiEndpoints`：页面调用的 API
- `commonIssues`：已知问题

**重要原则：** 知识图谱仅作参考，页面实际内容与图谱不一致时以实际为准。

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
4. **立即截图记录初始状态**（`browser_take_screenshot`，命名为 `{pageId}-初始加载.png`）
5. 检查控制台错误（`browser_console_messages`）
6. 检查网络请求失败（`browser_network_requests`，关注 /api/ 且 status >= 400 的请求）

**异常页面处理（Observe阶段）：**
- 如果页面被重定向到非预期URL：记录重定向行为，截图，然后**尝试从正确入口重新进入**（如从列表页点击对应记录跳转到详情页）
- 如果页面返回空白/错误：等待3-5秒重新获取快照，确认不是加载延迟
- 如果页面需要参数（如 /edit?id=xxx）但缺少参数：从列表页找到一条记录，通过列表页的"编辑"按钮进入

#### Think（分析）

综合**页面实际内容**和**知识图谱**，分析：

1. **页面可用性**：正常加载？关键元素存在？数据正常？
2. **知识图谱对照**（如已加载）：检查 interactions、apiEndpoints、commonIssues
3. **制定测试计划**

##### 页面类型识别与测试策略

**⚠️ 宁可多测不可少测。** 页面上有任何可点击的按钮/链接/输入框就必须操作。分类只为确定重点，不是降低标准的借口。

**判断优先级**：CRUD > 配置 > 复杂交互 > 只读，按更高标准测试。

**A. CRUD 管理页（表格+增删改查）**
```
完整生命周期测试（必做）：
  1. 新增 → 填写真实数据 → 提交 → 验证列表出现新记录 → 搜索定位
  2. 编辑 → 修改某字段 → 提交 → 验证修改生效
  3. 删除 → 确认 → 验证列表中消失
  4. 搜索 → 各种条件 → 验证过滤结果

边界测试：空必填项、超长文本、特殊字符、重复提交
```

**B. 只读展示页（表格/卡片）**
```
必须测试（即使看起来"没什么好测的"）：
  - 搜索：输入关键词 → 验证结果变化 → 清空恢复全量
  - 分页：翻到第2页 → 验证数据不同
  - 筛选/下拉：切换条件 → 验证过滤生效
  - Tab切换（如有）
  - 行内按钮/链接：点击 → 验证响应正确
  - 空结果：搜索不存在内容 → 验证提示
```

**C. 配置页（设置/开关/参数）**
```
  - 查看当前值
  - 切换开关 → 验证变更
  - 修改值 → 保存 → 刷新验证持久化
```

**D. 详情/预览页**
```
  - 数据完整性
  - 返回/导航功能
  - 关联数据加载
```

**E. 复杂交互页（设计器/编辑器/流程）**
```
  - 工具栏功能
  - 保存/加载
  - 元素选择和属性编辑
```

##### 跨页面关联

思考当前页面与其他页面的关联：数据流、配置依赖、导航链接、状态同步。记录到 `cross-page-issues.json`。

#### Act（操作）— 像真实用户一样测试

**截图硬性规则（每步必截）：**

| 时机 | 文件名示例 |
|------|-----------|
| 页面初始加载 | `{pageId}-初始加载.png` |
| 搜索/筛选后 | `{pageId}-搜索结果.png` |
| 弹窗打开 | `{pageId}-新增弹窗.png` |
| 表单填写完成 | `{pageId}-填写完成.png` |
| 提交/保存后 | `{pageId}-提交成功.png` |
| 编辑前后 | `{pageId}-编辑验证.png` |
| 删除确认 | `{pageId}-删除确认.png` |
| 错误状态 | `{pageId}-错误提示.png` |

**测试原则：**
1. 完整操作，不要只"看" — 新增弹窗要填数据真提交，搜索要验证结果
2. 主动找bug — 下拉选项空？日期格式？状态不一致？
3. 数据敏感性 — XSS/SQL注入/超长字符串
4. 状态一致性 — 新增后列表更新？编辑后其他引用同步？

#### Validate（验证）

每次操作后：
1. 截图记录结果
2. 检查错误弹窗
3. 检查控制台新错误
4. 检查网络失败请求
5. 验证操作结果（具体：列表数据变化、字段值一致、总数变化）

#### 页面完成 → 自检 → 保存 → 迁移

1. **执行自检清单**（必须全部通过才能保存）
2. **保存结果JSON** 到 `{e2eDataDir}/runs/{projectName}/{runId}/pages/{pageId}.json`
3. **迁移产物**到页面文件夹：

```bash
mkdir -p "{e2eDataDir}/runs/{projectName}/{runId}/pages/{pageId}"
mv {pageId}-*.png "{e2eDataDir}/runs/{projectName}/{runId}/pages/{pageId}/" 2>/dev/null
mv .playwright-mcp/page-*.yml "{e2eDataDir}/runs/{projectName}/{runId}/pages/{pageId}/" 2>/dev/null
```

4. **更新 run.json** 已完成页面数
5. **导航到下一页**（同一标签页直接跳转）

### 第 5 步：跨页面关联汇总

1. 读取所有 `pages/*.json`
2. 汇总跨页面问题到 `cross-page-issues.json`

### 第 6 步：完成运行

1. 读取 `run.json` 和所有页面数据
2. 计算汇总统计写入 `run.json`
3. HTML 报告由独立的 `e2e-report` Skill 生成

## 评分规则

- 基础分 = 通过检查项 / 总检查项 × 100
- 扣分：critical -30/个，high -10/个，medium -5/个
- suggestion 不扣分
- 状态判定：critical→error，high→fail，medium/low→warning，无问题→pass

## 注意事项

- 每次操作后等待页面稳定
- 不修改/删除真实数据（测试数据用完删除）
- 截图命名清晰
- 单页操作≤30秒，整页≤5分钟
- 每页测完必须保存结果到磁盘
