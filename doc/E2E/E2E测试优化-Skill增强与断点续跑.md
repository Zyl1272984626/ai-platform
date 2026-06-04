# E2E 测试优化 — Skill 增强、AI 自主性、断点续跑

**日期**: 2026-06-03

## 背景

在使用 E2E 测试过程中发现以下问题：
1. E2E Skill 的 Act 阶段是固定的「搜索→新增→编辑→删除」套路，AI 不够灵活，无法根据页面实际内容自主决策
2. Playwright 没有并发标签页限制，可能导致浏览器资源耗尽
3. E2E 测试如果中断，整个测试全部丢失，必须从头重跑
4. Settings 页面的 Skill 只有名称和描述，缺少使用场景和限制说明
5. 知识图谱（page-context.json）的利用不够，AI 没有主动读取

## 改动清单

### 一、E2E Skill 重写

**文件**: `skills/tests/e2e-page-test/SKILL.md`

#### 1. Playwright 硬性约束
- 新增规则：同时打开的浏览器标签页不超过 5 个
- 每个页面测试完成后必须关闭标签页再开下一个
- 标签页泄漏时立即关闭多余标签页

#### 2. AI 自主决策模式（替代固定清单）
去掉了原有的固定操作清单，改为 AI 自主制定测试计划：

| 优先级 | 说明 | 适用模式 |
|--------|------|---------|
| P0（必测） | 页面核心功能（列表加载、搜索查询） | standard / deep |
| P1（应测） | 重要交互（新增、编辑、删除流程） | standard / deep |
| P2（选测） | 次要功能（导出、排序、列设置） | standard / deep |
| P3（deep专属） | 边界和异常（空值、超长输入、特殊字符） | deep |

#### 3. 知识图谱主动读取
新增执行步骤「第 2 步：加载知识图谱」：
- 测试开始前先 `Read` 读取 `page-context.json`
- 将所有页面的上下文缓存到内存
- Think 阶段融合知识图谱中的 `expectedElements`、`interactions`、`apiEndpoints`、`commonIssues`

#### 4. 改进建议类型
issues 的 severity 新增 `suggestion` 级别：
- `critical` — 系统崩溃、数据丢失、安全漏洞
- `high` — 核心功能不可用、页面白屏
- `medium` — 功能异常但有变通方式
- `low` — 小问题、样式偏差
- `suggestion` — 非 bug 的改进建议（交互优化、体验改善等）

---

### 二、E2E 按 PageSet 断点续跑

**文件**: `server/src/services/test-runner.ts`

#### 改动前
- E2E 测试只有一个 TestCase，一个 AI 会话跑完所有页面
- 中断后所有进度丢失

#### 改动后
- `createTestSuite` 按 PageSet 拆分为多个 TestCase（每个 PageSet 一个 case）
- 新增函数 `runE2ESinglePageSet()`：每个 PageSet 独立的 AI 会话，独立的 session_id
- 新增函数 `runE2ESingleSession()`：兼容无项目或单 case 的旧模式
- 新增函数 `resolvePageSetPages()` / `resolvePagesFromList()`：PageSet 级别的页面展开
- 新增函数 `tryReadE2EReportPath()`：提取报告路径为独立函数

#### ResumeInfo 机制（与代码审查相同模式）
```typescript
interface ResumeCaseInfo {
  sessionId: string
  status: 'completed' | 'interrupted'
  partialOutput: string
}
```
- 每个 PageSet 完成时记录 `sessionId + status: completed`
- 中断时记录 `sessionId + status: interrupted`
- 恢复时跳过已完成的 PageSet，用 `forkSession` 恢复中断的 PageSet

#### 前端配合
- `canResume()` 支持 E2E 类型（原来只支持 codereview）
- `resumeTestRun()` 后端接口支持 E2E 类型
- 恢复按钮文案区分：「恢复测试」vs「恢复审查」
- 运行面板展示逐 PageSet 进度（`📊 进度: 2/5 页面集完成`）

---

### 三、Skill 卡片增强展示

#### SKILL.md frontmatter 新增字段
所有 8 个 Skill 文件新增：

```yaml
usage: 使用场景描述（一段话）
constraints:
  - 限制条件1
  - 限制条件2
```

| Skill | usage 要点 | constraints 要点 |
|-------|-----------|-----------------|
| e2e-page-test | 测试中心 E2E 自动加载，或生成提示词手动执行 | 最多5标签页、不删数据、单页5分钟 |
| agent-test | Agent 测试时自动加载 | 仅已注册 Agent、不改数据 |
| frontend-test | 前端测试时自动加载 | 只用 Read/Glob/Grep/Write、需先发现组件 |
| code-review | 代码审查时自动加载 | 只用 Read/Glob/Grep/Write、需先发现审查点 |
| page-context-discovery | 设置页生成图谱时加载 | 最多5标签页、每页30秒、需先发现页面 |
| api-discovery | 设置页发现接口时加载 | 只用 Read/Glob/Grep/Write |
| frontend-discovery | 设置页发现组件时加载 | 只用 Read/Glob/Grep/Write |
| review-discovery | 设置页发现审查点时加载 | 只用 Read/Glob/Grep/Write |

#### 后端解析
**文件**: `server/src/services/skill-registry.ts`
- `SkillMeta` 接口增加 `usage?: string` 和 `constraints?: string[]`
- `parseSkillFrontmatter()` 解析 YAML 中的 usage（单行）和 constraints（列表）
- `parseSkillFrontmatter()` 的 type 参数修正为包含 `'base'`

#### 前端展示
**文件**: `web/src/views/SkillView.vue` + `web/src/api/types.ts`
- 卡片上展示红色「N 条限制」标签
- 详情弹窗新增两个区块：
  - 蓝色底「使用场景」
  - 红色底「限制说明」列表

---

## 修改文件总览

| 文件 | 改动类型 |
|------|---------|
| `skills/tests/e2e-page-test/SKILL.md` | 重写 |
| `skills/tests/agent-test/SKILL.md` | 增加 frontmatter |
| `skills/tests/frontend-test/SKILL.md` | 增加 frontmatter |
| `skills/tests/code-review/SKILL.md` | 增加 frontmatter |
| `skills/base/page-context-discovery/SKILL.md` | 增加 frontmatter |
| `skills/base/api-discovery/SKILL.md` | 增加 frontmatter |
| `skills/base/frontend-discovery/SKILL.md` | 增加 frontmatter |
| `skills/base/review-discovery/SKILL.md` | 增加 frontmatter |
| `server/src/services/test-runner.ts` | E2E 按 PageSet 执行 + 断点续跑 |
| `server/src/services/skill-registry.ts` | 解析 usage/constraints |
| `web/src/views/TestView.vue` | canResume 支持 E2E、恢复按钮文案 |
| `web/src/views/SkillView.vue` | 卡片 + 详情弹窗展示 |
| `web/src/api/types.ts` | Skill 接口增加字段 |

## 验证方式

1. 启动后端 `cd server && npm run dev`，确认 skill-registry 正确解析新字段（`GET /api/skills` 返回含 usage/constraints）
2. 启动前端 `cd web && npm run dev`，检查 SkillView 卡片和详情弹窗的新展示
3. E2E 测试：选择一个项目启动测试，观察是否按 PageSet 逐个执行、进度展示是否正常
4. 中断恢复：手动停止 E2E 测试，点击「恢复测试」按钮验证断点续跑
