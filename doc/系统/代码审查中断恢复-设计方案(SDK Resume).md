# 代码审查中断恢复 — SDK Resume 方案详细设计

> 已通过实际测试验证：`@anthropic-ai/claude-code` v1.0.128 的 `resume` + `forkSession` 功能在智谱 CodePlan 下工作正常，Claude 能准确记住之前对话的上下文。

## 一、方案概述

当代码审查因 429 限流、网络中断、用户手动停止等原因中断时，利用 SDK 原生的 `resume` 功能恢复会话上下文，让 Claude 从中断处继续分析，而不是从头重跑。

### 核心机制

```
首次运行：
  query({ prompt, options: { cwd } })
  → 从 system message 中捕获 session_id
  → 实时保存到 suite.config.resumeInfo
  → 中途中断...

恢复运行：
  query({
    prompt: '请继续之前的审查',
    options: {
      resume: session_id,    ← 传入之前保存的 session_id
      forkSession: true,     ← 创建新 session，不污染原会话
      cwd,
    }
  })
  → Claude 拥有之前全部上下文（读过的文件、分析过的代码）
  → 直接继续，无需重新读文件
```

---

## 二、后端改造

### 2.1 数据结构扩展

在 `TestSuite.config` 中新增 `resumeInfo` 字段：

```typescript
// test-runner.ts

interface ResumeInfo {
  // 按模块（case）维度记录 session_id
  cases: Record<string, {
    sessionId: string        // 该模块的 Claude Code session_id
    status: 'completed' | 'interrupted'
    partialOutput: string    // 中断时已有的输出
  }>
}

// suite.config 结构变化：
{
  projectId: 'xxx',
  modules: ['mod1', 'mod2'],
  resumeInfo: {              // ← 新增
    cases: {
      'case-id-1': {
        sessionId: '53b650dd-...',
        status: 'completed',
        partialOutput: '...',
      },
      'case-id-2': {
        sessionId: 'a82fb8d2-...',
        status: 'interrupted',
        partialOutput: '## 审查报告\n### 安全性...',
      }
    }
  }
}
```

### 2.2 `runSingleModuleReview` 改造

**文件**: `server/src/services/test-runner.ts`

改造点：

1. **捕获 session_id**：从 `system` 消息中获取并保存
2. **支持 resume 模式**：当传入 `resumeSessionId` 时，使用 `resume` + `forkSession`
3. **中断时保存状态**：catch 块中保存 partialOutput 和 sessionId

```
改造前：
  query({ prompt, options: { cwd, ... } })
  → 全新对话，无历史

改造后：
  if (resumeSessionId) {
    query({
      prompt: '请继续之前的代码审查，从中断处继续分析。',
      options: {
        resume: resumeSessionId,
        forkSession: true,
        cwd, ...
      }
    })
  } else {
    query({ prompt, options: { cwd, ... } })
  }
  → 从 system 消息捕获新的 session_id
  → 中断时保存 { sessionId, status: 'interrupted', partialOutput }
```

### 2.3 `runCodeReview` 改造

**文件**: `server/src/services/test-runner.ts`

按模块遍历循环中增加判断：

```
for (每个模块) {
  const resumeCase = suite.config.resumeInfo?.cases[tc.id]

  if (resumeCase?.status === 'completed') {
    // 跳过已完成的模块
    continue
  }

  const resumeSessionId = resumeCase?.status === 'interrupted'
    ? resumeCase.sessionId
    : undefined

  await runSingleModuleReview(suite, tc, modulePrompt, cwd, abortController, moduleName, resumeSessionId)
}
```

### 2.4 新增 API：恢复中断的审查

**文件**: `server/src/routes/test.ts`

```
POST /api/tests/runs/:id/resume
```

逻辑：
1. 读取 suite JSON 文件
2. 检查是否有 `resumeInfo`（有中断的 case）
3. 创建新的 suite，复制配置和 resumeInfo
4. 调用 `executeTestRun`，走恢复逻辑
5. 返回新 suiteId

### 2.5 SSE 事件扩展

新增事件类型 `test:resumed`，让前端知道这是恢复运行：

```typescript
testBus.emit('test:resumed', {
  suiteId: suite.id,
  resumedCases: ['case-id-2', 'case-id-3'],  // 被恢复的模块
  skippedCases: ['case-id-1'],                // 跳过的模块
})
```

---

## 三、前端改造

### 3.1 历史记录卡片 — 增加「恢复」按钮

**文件**: `web/src/views/TestView.vue`

在历史记录的 `run-card` 中，当 run 状态为 `error` 且类型为 `codereview` 时，显示「🔄 恢复审查」按钮：

```
┌──────────────────────────────────────────────────────────────┐
│ 💥 代码审查(主系统(Agent))测试     195.6s   06/03 09:46   ▼  │
├──────────────────────────────────────────────────────────────┤
│ 💥 API 安全与加密封装 (19 文件, 高风险)        195.5s        │
│    API Error: 429 已达到使用上限                              │
│ 🔵 数据模型与状态管理 (12 文件, 低风险)          ---         │
│    (未执行)                                                   │
│ ✅ 路由与权限控制 (8 文件, 中风险)             120.3s        │
│                                                              │
│  [🔄 恢复审查]   [查看报告]   [删除记录]                       │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 运行面板 — 恢复提示

当恢复运行时，运行面板头部显示「恢复运行」而非「运行中」，并在开头追加一条提示：

```
┌──────────────────────────────────────────────────────────────┐
│ 🔄 恢复运行  代码审查(主系统(Agent))测试     45s   ⏹ 停止    │
├──────────────────────────────────────────────────────────────┤
│ ℹ️ 恢复模式：跳过 1 个已完成模块，恢复 1 个中断模块          │
│                                                              │
│ ---                                                          │
│ ## 🔍 恢复审查: API 安全与加密封装                           │
│ (Claude 从之前的上下文继续分析...)                            │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 前端 API 新增

**文件**: `web/src/api/tests.ts`

```typescript
/** 恢复中断的代码审查 */
export function resumeTestRun(id: string) {
  return api.post<{ suiteId: string }>(`/tests/runs/${id}/resume`).then(r => r.data)
}
```

### 3.4 前端事件处理

在 `handleSSEEvent` 中增加 `test:resumed` 事件处理：

```typescript
} else if (evt.event === 'test:resumed') {
  stream.blocks.push({
    type: 'text',
    content: `ℹ️ 恢复模式：跳过 ${evt.skippedCases?.length || 0} 个已完成模块，恢复 ${evt.resumedCases?.length || 0} 个中断模块\n`,
  })
  scrollToBottom(suiteId)
}
```

---

## 四、完整流程图

### 首次运行

```
用户点击「开始测试」
  │
  ├─ POST /run → 创建 suite（无 resumeInfo）
  │
  ├─ SSE 连接 → 显示运行面板
  │
  └─ 后端 executeTestRun()
       │
       ├─ 模块 A: query() → 捕获 session_id=A1 → 完成 → 保存 {status:'completed', sessionId:'A1'}
       ├─ 模块 B: query() → 捕获 session_id=B1 → 中途 429 中断
       │                                 → 保存 {status:'interrupted', sessionId:'B1', partialOutput:'...'}
       ├─ 模块 C: (未开始)
       │
       └─ suite 状态 → error
```

### 恢复运行

```
用户在历史记录点击「🔄 恢复审查」
  │
  ├─ POST /runs/:id/resume
  │     → 读取 suite，检测 resumeInfo
  │     → 创建新 suite（携带 resumeInfo）
  │
  ├─ SSE 连接 → 显示运行面板（标记「恢复运行」）
  │
  └─ 后端 executeTestRun()
       │
       ├─ test:resumed 事件 → 前端显示"跳过 1 个，恢复 1 个"
       │
       ├─ 模块 A: resumeInfo.status='completed' → 跳过
       │
       ├─ 模块 B: resumeInfo.status='interrupted'
       │     → query({ resume: 'B1', forkSession: true, prompt: '继续审查' })
       │     → Claude 拥有之前上下文，继续分析
       │     → 捕获新 session_id=B2
       │     → 完成
       │
       ├─ 模块 C: 无 resumeInfo → 全新 query()
       │     → 完成
       │
       └─ suite 状态 → passed
```

---

## 五、涉及文件清单

| 文件 | 改动内容 |
|------|---------|
| `server/src/services/test-runner.ts` | `runSingleModuleReview` 支持 resume 模式；`runCodeReview` 模块循环增加跳过/恢复判断；捕获 session_id 并持久化 |
| `server/src/routes/test.ts` | 新增 `POST /runs/:id/resume` 路由 |
| `web/src/api/tests.ts` | 新增 `resumeTestRun()` API 函数 |
| `web/src/views/TestView.vue` | 历史记录增加「恢复审查」按钮；运行面板支持恢复模式显示；处理 `test:resumed` 事件 |

---

## 六、边界情况处理

| 场景 | 处理方式 |
|------|---------|
| session_id 对应的 Claude Code transcript 被清理 | 回退为全新 query()（等同方案 A） |
| 用户从未中断过，直接点恢复 | 按钮不显示（无 resumeInfo） |
| 全部模块都已完成 | 不显示恢复按钮 |
| 同一个 suite 被恢复多次 | 每次创建新 suite，互不影响 |
| 恢复时原项目的审查规则已更新 | 使用新规则，但 prompt 说明"按新规则继续检查" |
| 服务器重启后恢复 | 从 JSON 文件读取 resumeInfo，可正常恢复 |

---

## 七、验证方式

1. 启动一个 3+ 模块的代码审查
2. 在第二个模块运行时手动停止
3. 确认历史记录显示「🔄 恢复审查」按钮
4. 点击恢复，确认：
   - 第一个模块显示跳过
   - 第二个模块从上下文续接（不重新读文件）
   - 第三个模块正常执行
5. 确认恢复后的报告内容完整，包含所有模块的结果

---

## 八、人工对话功能（Chat with Review Context）

### 8.1 功能描述

在代码审查运行中或完成后，用户可以直接向 Claude 发送自定义消息进行对话。本质上是利用 SDK 的 `resume` 功能，将用户的自定义消息作为 prompt 续接到审查会话上，Claude 拥有完整的审查上下文。

### 8.2 使用场景

| 场景 | 用户消息示例 |
|------|------------|
| 深入追查 | "刚才提到的 SQL 注入风险，具体在哪个文件哪一行？" |
| 聚焦分析 | "重点看一下 src/api/auth.ts 这个文件的安全性" |
| 补充要求 | "除了已有的审查维度，再检查一下国际化处理有没有问题" |
| 确认建议 | "你建议用 parameterized query，能给出具体的代码修改示例吗？" |
| 自由提问 | "这个项目整体代码质量在什么水平？和同类项目比怎么样？" |

### 8.3 运行面板 UI 设计

在运行面板底部增加聊天输入框：

```
┌──────────────────────────────────────────────────────────────┐
│ 🔍 运行中  代码审查(主系统(Agent))测试     2m15s   ⏹ 停止    │
├──────────────────────────────────────────────────────────────┤
│ (已有的流式内容...审查报告、工具调用等)                       │
│                                                              │
│ ✅ 模块审查完成: API 安全与加密封装 (195.3s)                 │
│ 🔍 开始审查: 数据模型与状态管理...                            │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ 💬 对话 (基于当前审查上下文)                                  │
│ ┌──────────────────────────────────────────────────┐ [发送] │
│ │ 输入消息，如"重点看一下 auth.ts 的安全性"...                │
│ └──────────────────────────────────────────────────┘        │
│                                                              │
│ 💬 你: 重点看一下 auth.ts 的安全性                            │
│ 🤖 Claude: 我来仔细检查 auth.ts...                           │
│    经过分析，发现以下问题：                                   │
│    1. 🔴 第 45 行的 token 验证存在时序攻击风险...             │
│    2. 🟡 第 78 行缺少 rate limiting...                       │
│                                                              │
│ ┌──────────────────────────────────────────────────┐ [发送] │
│ │ 继续提问...                                                │
│ └──────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

### 8.4 历史记录中的对话入口

已完成的审查记录展开后，也能发起对话（基于该审查的上下文）：

```
┌──────────────────────────────────────────────────────────────┐
│ ✅ 代码审查(主系统(Agent))测试     320.5s   06/03 10:30   ▼  │
├──────────────────────────────────────────────────────────────┤
│ (审查结果详情...)                                            │
│                                                              │
│  [💬 继续对话]   [🔄 恢复审查]   [查看报告]   [删除记录]     │
└──────────────────────────────────────────────────────────────┘
```

### 8.5 后端实现

#### 新增 API：发送对话消息

**文件**: `server/src/routes/test.ts`

```
POST /api/tests/runs/:id/chat
Body: { message: string }
```

逻辑：
1. 读取 suite JSON，获取最近一个模块的 `sessionId`
2. 如果是正在运行的 suite，等当前模块完成后再发送
3. 调用 `query({ prompt: 用户消息, options: { resume: sessionId, forkSession: true, cwd } })`
4. 通过 `testBus` 广播 SSE 事件（`agent:chat` 类型）
5. 返回 `{ suiteId }` 前端用来建立 SSE 连接

```typescript
// 核心伪代码
async function chatWithReview(suiteId: string, message: string) {
  const suite = getRun(suiteId)
  // 找到最近有 sessionId 的 case
  const lastCase = findLatestCaseWithSession(suite)
  if (!lastCase?.sessionId) {
    throw new Error('无可用的会话上下文')
  }

  // 创建一个虚拟的 chat case
  const chatCase = { id: uuid(), name: `💬 ${message.slice(0, 30)}`, status: 'running' }
  suite.cases.push(chatCase)
  saveRun(suite)

  // 用 resume 续接会话
  const response = query({
    prompt: message,
    options: {
      resume: lastCase.sessionId,
      forkSession: true,
      cwd: suite.config.projectSourcePath,
      allowedTools: ['Read', 'Glob', 'Grep'],
      maxTurns: 9999,
      permissionMode: 'bypassPermissions',
    },
  })

  // 广播 SSE 事件，与正常审查共用流式通道
  for await (const msg of response) {
    // 处理 assistant/user/result 消息，发射 agent:stream 事件
    // ...
  }
}
```

#### SSE 事件类型区分

对话消息使用 `agent:chat` 标记，前端可以区分渲染样式：

```typescript
testBus.emit('agent:chat', {
  suiteId: suite.id,
  caseId: chatCase.id,
  type: 'text',         // text / tool_use / tool_result
  content: '...',
})
```

### 8.6 前端实现

#### 运行面板聊天输入框

**文件**: `web/src/views/TestView.vue`

在运行面板 `.run-panel` 底部增加聊天区域：

```html
<!-- 聊天输入区 -->
<div class="chat-area" v-if="stream.type === 'codereview'">
  <div class="chat-messages">
    <template v-for="(msg, idx) in stream.chatMessages" :key="idx">
      <div class="chat-msg chat-user">
        <span class="chat-avatar">💬</span>
        <span class="chat-text">{{ msg.text }}</span>
      </div>
      <div v-if="msg.reply" class="chat-msg chat-assistant">
        <span class="chat-avatar">🤖</span>
        <div class="chat-text" v-html="renderMarkdown(msg.reply)"></div>
      </div>
    </template>
  </div>
  <div class="chat-input-row">
    <input
      v-model="stream.chatInput"
      placeholder="输入消息，如'重点看一下 auth.ts'..."
      @keydown.enter="sendChat(streamId)"
      :disabled="stream.chatLoading"
    />
    <button @click="sendChat(streamId)" :disabled="stream.chatLoading || !stream.chatInput?.trim()">
      {{ stream.chatLoading ? '...' : '发送' }}
    </button>
  </div>
</div>
```

#### API 函数

**文件**: `web/src/api/tests.ts`

```typescript
/** 对话（基于审查上下文） */
export function chatWithReview(runId: string, message: string) {
  return api.post<{ suiteId: string }>(`/tests/runs/${runId}/chat`, { message }).then(r => r.data)
}
```

#### 发送聊天消息

```typescript
async function sendChat(streamId: string) {
  const stream = activeStreams.value.get(streamId)
  if (!stream || !stream.chatInput?.trim()) return

  const message = stream.chatInput.trim()
  stream.chatInput = ''
  stream.chatMessages.push({ text: message, reply: '' })
  stream.chatLoading = true

  try {
    const { suiteId: chatSuiteId } = await chatWithReview(streamId, message)
    // SSE 会自动接收新的 agent:chat 事件，追加到 stream.chatMessages
  } catch (e: any) {
    alert('发送失败: ' + e.message)
  } finally {
    stream.chatLoading = false
  }
}
```

### 8.7 StreamState 扩展

```typescript
interface StreamState {
  // ... 现有字段 ...
  chatMessages: Array<{ text: string; reply: string }>
  chatInput: string
  chatLoading: boolean
}
```

### 8.8 聊天样式

```css
/* 聊天区域 */
.chat-area {
  border-top: 1px solid #f0f0f0;
  padding: 12px 20px;
}
.chat-messages {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 10px;
}
.chat-msg {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
  line-height: 1.6;
}
.chat-avatar { flex-shrink: 0; }
.chat-user .chat-text {
  background: #f0f0ff;
  padding: 6px 12px;
  border-radius: 8px;
  color: #333;
}
.chat-assistant .chat-text {
  background: #fafafa;
  padding: 6px 12px;
  border-radius: 8px;
  flex: 1;
}
.chat-input-row {
  display: flex;
  gap: 8px;
}
.chat-input-row input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 13px;
}
.chat-input-row button {
  padding: 8px 16px;
  background: #667eea;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
```

### 8.9 完整对话流程

```
代码审查运行中/已完成
  │
  ├─ 用户在聊天输入框输入 "重点看一下 auth.ts 的安全性"
  │
  ├─ POST /tests/runs/:id/chat { message: "重点看一下 auth.ts..." }
  │     → 后端找到最近的 session_id
  │     → query({ resume: sessionId, forkSession: true, prompt: 用户消息 })
  │     → Claude 拥有完整审查上下文，针对性回答
  │
  ├─ SSE 流式返回 Claude 的回复
  │     → agent:chat { type: 'text', content: '我来检查 auth.ts...' }
  │     → agent:chat { type: 'tool_use', name: 'Read', input: {...} }
  │     → agent:chat { type: 'text', content: '发现以下问题：...' }
  │
  ├─ 前端实时渲染到聊天区域
  │
  └─ 用户继续输入 → 再次 resume（上下文持续累积）
```

---

## 九、涉及文件清单（更新）

| 文件 | 改动内容 |
|------|---------|
| `server/src/services/test-runner.ts` | `runSingleModuleReview` 支持 resume；新增 `chatWithReviewModule` 对话函数；捕获 session_id |
| `server/src/routes/test.ts` | 新增 `POST /runs/:id/resume`；新增 `POST /runs/:id/chat` |
| `web/src/api/tests.ts` | 新增 `resumeTestRun()`、`chatWithReview()` |
| `web/src/views/TestView.vue` | 运行面板聊天输入框；历史记录恢复/对话按钮；`test:resumed`/`agent:chat` 事件处理；聊天样式 |

---

## 十、边界情况处理（更新）

| 场景 | 处理方式 |
|------|---------|
| session_id 对应的 Claude Code transcript 被清理 | 回退为全新 query()（等同方案 A） |
| 用户从未中断过，直接点恢复 | 按钮不显示（无 resumeInfo） |
| 全部模块都已完成 | 不显示恢复按钮，但可显示"继续对话" |
| 同一个 suite 被恢复多次 | 每次创建新 suite，互不影响 |
| 恢复时原项目的审查规则已更新 | 使用新规则，但 prompt 说明"按新规则继续检查" |
| 服务器重启后恢复 | 从 JSON 文件读取 resumeInfo，可正常恢复 |
| **审查正在运行时发送聊天消息** | 等当前模块完成后发送，或创建独立对话流 |
| **聊天对话的 session 超出上下文窗口** | 提示用户"上下文已满"，建议开新审查 |
| **多次对话后 transcript 过大** | 每次 forkSession 创建新 session，控制 transcript 增长 |

---

## 附录 A：全平台「人工对话」适用范围统计

以下是项目中所有调用 `query()` 与 Claude Code 互动的功能点，分析每个是否适合增加「人工对话」能力。

### A.1 功能全景

| # | 功能 | 页面 | 后端文件 | query() 调用位置 | 适合加对话？ | 优先级 |
|---|------|------|---------|-----------------|------------|-------|
| 1 | Agent 智能体测试 | `/tests` (Agent Tab) | `test-runner.ts:286` `runAgentTest()` | 单次对话，测试 Agent 能力 | ✅ 很适合 | P1 |
| 2 | E2E 页面测试 | `/tests` (E2E Tab) | `test-runner.ts:484` `runE2ETest()` | Playwright 浏览器测试 | ⚠️ 意义不大 | P3 |
| 3 | 前端单元测试 | `/tests` (Frontend Tab) | `test-runner.ts` | 生成测试用例 | ⚠️ 意义不大 | P3 |
| 4 | API 接口测试 | `/tests` (API Tab) | `test-runner.ts` | 测试 API 接口 | ⚠️ 意义不大 | P3 |
| 5 | 代码审查 | `/tests` (CodeReview Tab) | `test-runner.ts:1128,1237` | 按模块审查代码 | ✅ 非常适合 | P0 |
| 6 | AI 对话 | `/chat` | `claude-client.ts:129,266` | 自由对话 | ❌ 本身就是对话 | - |
| 7 | 发现页面 | `/settings` 项目卡片 | `page-discovery.ts` | 扫描前端路由 | ✅ 适合 | P2 |
| 8 | 发现组件 | `/settings` 项目卡片 | `frontend-discovery.ts:106` | 扫描前端组件 | ✅ 适合 | P2 |
| 9 | 发现接口 | `/settings` 项目卡片 | `api-discovery.ts:113` | 扫描 API 路由 | ✅ 适合 | P2 |
| 10 | 发现审查点 | `/settings` 项目卡片 | `review-discovery.ts:108` | 扫描审查模块 | ✅ 适合 | P2 |
| 11 | 发现页面上下文 | `/settings` 项目卡片 | `page-context-discovery.ts:84` | 分析页面功能 | ✅ 适合 | P2 |

### A.2 详细分析

#### P0：代码审查（已在第八章设计）

最核心的场景，审查报告出来后用户想追问细节。

#### P1：Agent 智能体测试

```
现状：用户输入 AgentID → 自动跑测试 → 出结果
增加对话后：
  - "刚才测试第 3 个用例失败了，帮我看看为什么"
  - "再跑一次，这次只测对话响应能力"
  - "这个 Agent 的工具调用能力怎么样？详细说说"
```

改造方式：与代码审查完全一致。Agent 测试的 `runAgentTest` 已经有 SSE 流式输出，在运行面板底部加聊天输入框，用 `resume` 续接。

**涉及**：`test-runner.ts:runAgentTest()`、`TestView.vue` 的 Agent 运行面板

#### P2：设置页面的发现功能（4 个）

```
现状：用户点「发现页面/接口/审查点」→ 自动扫描 → 出结果
增加对话后：
  - 发现页面："为什么没有发现 /admin 路由？可能是权限路由没被探测到"
  - 发现接口："帮我看看有没有遗漏的 API 模块"
  - 发现审查点："重点关注 src/utils/ 下的加密工具函数"
  - 发现组件："这个表格组件为什么没被发现？"
```

这 4 个发现的 UI 是统一的（`discover-stream-panel`），改造方式相同：

在发现进度面板底部加聊天输入框：

```
┌──────────────────────────────────────────────────────────┐
│ 📡 发现页面进度                            [中断]        │
├──────────────────────────────────────────────────────────┤
│ (已有的发现流式内容...)                                  │
│ ✅ 发现 /web/index.html#/login                           │
│ ✅ 发现 /web/index.html#/dashboard                       │
│ 🔍 正在扫描 /web/src/router...                           │
├──────────────────────────────────────────────────────────┤
│ 💬 [扫描完成了？帮我看看有没有遗漏的路由]       [发送]   │
└──────────────────────────────────────────────────────────┘
```

**涉及**：
- `page-discovery.ts`、`api-discovery.ts`、`frontend-discovery.ts`、`review-discovery.ts` — 捕获 session_id
- `SettingsView.vue` — 发现面板增加聊天输入框
- 新增路由 `POST /api/projects/:id/discovery/chat`

#### P3：E2E / 前端 / API 测试

这三类测试偏自动化执行，用户不太需要追问。优先级最低，后期如果有需求再考虑。

### A.3 通用聊天组件抽象

由于 6 个功能都需要相似的聊天 UI，建议抽象为通用组件：

```
web/src/components/chat/
  ├── ChatInput.vue        ← 通用聊天输入框（输入框 + 发送按钮）
  ├── ChatMessages.vue     ← 消息列表（用户消息 + AI 回复 + 工具调用）
  └── useChatStream.ts     ← 通用 composable（管理 session_id、发送消息、接收 SSE）
```

这样 TestView 和 SettingsView 只需引入组件，传入 `suiteId` 或 `projectId` + `discoveryType` 即可。

### A.4 后端通用抽象

建议在 `claude-client.ts` 中新增一个通用的 `resumeChat` 函数：

```typescript
// claude-client.ts 新增
export async function resumeChat(
  sessionId: string,
  message: string,
  cwd: string,
  emitter: EventEmitter,
  options?: { allowedTools?: string[] }
): Promise<{ newSessionId: string; output: string }> {
  const query = await getClaudeQuery()

  const response = query({
    prompt: message,
    options: {
      resume: sessionId,
      forkSession: true,
      cwd,
      allowedTools: options?.allowedTools || ['Read', 'Glob', 'Grep'],
      maxTurns: 9999,
      permissionMode: 'bypassPermissions',
    },
  })

  let newSessionId = ''
  let output = ''

  for await (const msg of response) {
    if (msg.type === 'system') {
      newSessionId = (msg as any).session_id || ''
    }
    // ... 处理 assistant/user/result，通过 emitter 广播
  }

  return { newSessionId, output }
}
```

所有需要对话的功能（测试、发现）都调用这个函数，避免重复代码。

### A.5 实施顺序建议

```
第 1 批（核心）：
  ✅ P0 代码审查 — 中断恢复 + 人工对话（第八章已设计）
  ✅ P1 Agent 测试 — 人工对话

第 2 批（发现类）：
  ✅ P2 设置页面的 4 个发现功能 — 人工对话

第 3 批（可选）：
  ⬜ P3 E2E / 前端 / API 测试
```

通用组件和 `resumeChat` 抽象在第 1 批中实现，第 2 批直接复用。
