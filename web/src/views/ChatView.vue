<template>
  <div class="chat-layout">
    <SessionList
      :sessions="sessions"
      :current-id="currentSession?.id"
      :scene-skills="sceneSkills"
      @create="handleCreate"
      @select="handleSelect"
      @delete="handleDelete"
      @command="handleCommand"
    />
    <div class="chat-main">
      <!-- 空状态 -->
      <EmptyState
        v-if="!currentSession"
        icon="💬"
        title="AI 工程助手"
        description="创建一个新会话开始与 Claude Code 对话，自动执行工程任务"
      >
        <button class="start-btn" @click="handleCreate">开始对话</button>
      </EmptyState>

      <!-- 对话区域 -->
      <template v-else>
        <div class="messages-area" ref="messagesEl">
          <!-- 欢迎消息 -->
          <div v-if="currentSession.messages.length === 0 && !streaming" class="welcome-hints">
            <div class="welcome-title">你可以问我任何事情，例如：</div>
            <div class="hint-list">
              <div class="hint-item" v-for="h in quickHints" :key="h" @click="chatInput?.setInput(h)">{{ h }}</div>
            </div>
          </div>

          <!-- 消息列表 -->
          <template v-for="(item, i) in displayItems" :key="i">
            <MessageBubble v-if="item.type === 'message'" :role="item.role" :content="item.content" />
            <ToolCallBlock
              v-else-if="item.type === 'tool'"
              :name="item.name"
              :input="item.input"
              :result="item.result"
              :done="item.done"
            />
            <div v-else-if="item.type === 'thinking'" class="thinking-block">
              <div class="thinking-header" @click="toggleThinking(i)">
                <span class="thinking-icon">💭</span>
                <span>思考过程</span>
                <span class="thinking-toggle">{{ openThinking.has(i) ? '收起' : '展开' }}</span>
              </div>
              <pre v-if="openThinking.has(i)" class="thinking-content">{{ item.content }}</pre>
            </div>
            <div v-else-if="item.type === 'system'" class="system-hint">{{ item.content }}</div>
            <div v-else-if="item.type === 'error'" class="inline-error">{{ item.content }}</div>
          </template>

          <!-- 流式输出 -->
          <div v-if="streaming && streamText" class="message assistant streaming-msg">
            <div class="msg-avatar">AI</div>
            <div class="msg-body" v-html="renderStreamHtml"></div>
          </div>
          <div v-if="streaming && !streamText" class="thinking-indicator">
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
          </div>
        </div>

        <ChatInput ref="chatInput" :streaming="streaming" @send="handleSend" @stop="handleStop" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { marked } from 'marked'
import SessionList from '../components/chat/SessionList.vue'
import MessageBubble from '../components/chat/MessageBubble.vue'
import ToolCallBlock from '../components/chat/ToolCallBlock.vue'
import ChatInput from '../components/chat/ChatInput.vue'
import EmptyState from '../components/common/EmptyState.vue'
import { listSessions, createSession, getSession, deleteSession as apiDeleteSession, sendMessage } from '../api/sessions'
import { listSkills } from '../api/skills'
import { toast } from '../composables/useToast'
import type { Session, Skill } from '../api/types'

interface DisplayMessage { type: 'message'; role: 'user' | 'assistant'; content: string }
interface DisplayTool { type: 'tool'; name: string; input?: any; result?: string; done: boolean }
interface DisplayError { type: 'error'; content: string }
interface DisplayThinking { type: 'thinking'; content: string }
interface DisplaySystem { type: 'system'; content: string }
type DisplayItem = DisplayMessage | DisplayTool | DisplayError | DisplayThinking | DisplaySystem

const sessions = ref<Session[]>([])
const currentSession = ref<Session | null>(null)
const sceneSkills = ref<Skill[]>([])
const streaming = ref(false)
const streamText = ref('')
const displayItems = ref<DisplayItem[]>([])
const messagesEl = ref<HTMLElement>()
const chatInput = ref<InstanceType<typeof ChatInput>>()
// 当前生成的 abort 函数（streaming 时非空，供停止按钮调用）
const abortRef = ref<(() => void) | null>(null)
// 已展开的思考过程块下标集合
const openThinking = ref<Set<number>>(new Set())
function toggleThinking(index: number) {
  const s = new Set(openThinking.value)
  if (s.has(index)) s.delete(index); else s.add(index)
  openThinking.value = s
}

const quickHints = [
  '帮我分析一下当前项目的代码结构',
  '检查一下有没有潜在的安全问题',
  '帮我写一个单元测试',
  '当前有哪些 Java 文件使用了 LIMIT 语法？',
]

const renderStreamHtml = computed(() => {
  if (!streamText.value) return ''
  try { return marked.parse(streamText.value) as string }
  catch { return streamText.value.replace(/\n/g, '<br>') }
})

onMounted(async () => {
  try {
    const [sess, sks] = await Promise.all([listSessions(), listSkills()])
    sessions.value = sess
    sceneSkills.value = sks.filter(s => s.type === 'scene')
  } catch { /* ignore */ }
})

async function handleCreate() {
  try {
    const s = await createSession()
    sessions.value.unshift(s)
    currentSession.value = s
    displayItems.value = []
  } catch (e: any) {
    toast.error('创建会话失败: ' + e.message)
  }
}

function handleSelect(s: Session) {
  currentSession.value = s
  rebuildDisplayItems(s)
}

async function handleDelete(id: string) {
  if (!confirm('确认删除此会话？')) return
  try {
    await apiDeleteSession(id)
    sessions.value = sessions.value.filter(s => s.id !== id)
    if (currentSession.value?.id === id) {
      currentSession.value = null
      displayItems.value = []
    }
  } catch { /* ignore */ }
}

function handleCommand(cmd: string) {
  if (!currentSession.value) {
    handleCreate().then(() => {
      chatInput.value?.setInput(cmd + ' ')
    })
  } else {
    chatInput.value?.setInput(cmd + ' ')
  }
}

async function handleSend(message: string) {
  if (!currentSession.value || streaming.value) return

  // 添加用户消息到显示
  displayItems.value.push({ type: 'message', role: 'user', content: message })
  streaming.value = true
  streamText.value = ''
  scrollToBottom()

  const sessionId = currentSession.value.id
  let fullText = ''

  /** 把当前流式文本固化为一条 assistant 消息（done / aborted 共用） */
  function finalizeStream(suffix = '') {
    const text = fullText + (suffix ? `\n\n${suffix}` : '')
    if (text.trim()) {
      displayItems.value.push({ type: 'message', role: 'assistant', content: text })
    }
    streamText.value = ''
    fullText = ''
  }

  try {
    const { promise, abort } = sendMessage(sessionId, message, (event: any) => {
      switch (event.type) {
        case 'text':
          fullText += event.content
          streamText.value = fullText
          scrollToBottom()
          break
        case 'thinking':
          // 思考过程：累加到当前 thinking 块（若末尾已是 thinking 则续接，否则新建）
          streamText.value = ''
          {
            const last = displayItems.value[displayItems.value.length - 1]
            if (last && last.type === 'thinking') {
              last.content += event.content
            } else {
              displayItems.value.push({ type: 'thinking', content: event.content })
            }
          }
          scrollToBottom()
          break
        case 'system':
          // 会话初始化信息（模型名等），展示为轻量提示条
          displayItems.value.push({ type: 'system', content: event.content })
          scrollToBottom()
          break
        case 'tool_use':
          streamText.value = ''
          displayItems.value.push({
            type: 'tool',
            name: event.content,
            input: event.metadata?.input,
            done: false,
          })
          scrollToBottom()
          break
        case 'tool_result': {
          // 找到最近的未完成 tool block 并更新
          for (let i = displayItems.value.length - 1; i >= 0; i--) {
            const item = displayItems.value[i]
            if (item.type === 'tool' && !item.done) {
              item.result = event.content?.slice(0, 5000)
              item.done = true
              break
            }
          }
          break
        }
        case 'error':
          displayItems.value.push({ type: 'error', content: event.content })
          scrollToBottom()
          break
        case 'aborted':
          // 后端已停止：固化已生成文本（标注中断），后端负责落盘
          finalizeStream('> ⏹ 已停止')
          scrollToBottom()
          break
        case 'done':
          // 后端是数据源（已 push + 落盘），前端只负责展示
          finalizeStream()
          // 刷新 currentSession 以拿到准确 title / messageCount
          if (currentSession.value && currentSession.value.id === sessionId) {
            getSession(sessionId).then(s => {
              if (s && currentSession.value?.id === sessionId) {
                currentSession.value = s
              }
            }).catch(() => { /* ignore */ })
          }
          break
      }
    })
    abortRef.value = abort
    await promise
  } catch (e: any) {
    displayItems.value.push({ type: 'error', content: `请求失败: ${e.message}` })
  } finally {
    streaming.value = false
    abortRef.value = null
    scrollToBottom()
  }
}

/** 用户主动停止生成 */
function handleStop() {
  abortRef.value?.()
}

function rebuildDisplayItems(session: Session) {
  const items: DisplayItem[] = []
  for (const msg of session.messages) {
    // assistant 消息可能携带工具记录：先还原工具块（时序上工具调用先于最终文本），再插文本
    if (msg.role === 'assistant' && msg.toolEvents?.length) {
      for (const te of msg.toolEvents) {
        items.push({
          type: 'tool',
          name: te.name,
          input: te.input,
          result: te.result,
          done: true,
        } satisfies DisplayTool)
      }
    }
    // 只有内容非空才插消息块（避免“纯工具调用无文本”时插入空气泡）
    if (msg.content) {
      items.push({ type: 'message', role: msg.role, content: msg.content })
    }
  }
  displayItems.value = items
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  })
}
</script>

<style scoped>
.chat-layout {
  display: flex;
  height: 100%;
}
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}
.start-btn {
  margin-top: 12px;
  padding: 10px 28px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
}
.start-btn:hover { opacity: 0.9; }

/* 欢迎提示 */
.welcome-hints { padding: 20px 0; }
.welcome-title { font-size: 14px; color: #888; margin-bottom: 12px; }
.hint-list { display: flex; flex-direction: column; gap: 8px; }
.hint-item {
  padding: 10px 16px;
  background: #fff;
  border-radius: 8px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  border: 1px solid #eee;
  transition: all 0.15s;
}
.hint-item:hover { border-color: #667eea; color: #667eea; }

/* 流式消息 */
.streaming-msg {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  max-width: 85%;
}
.streaming-msg .msg-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: #f0f0f5;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}
.streaming-msg .msg-body {
  background: #fff;
  border-radius: 14px;
  border-bottom-left-radius: 4px;
  padding: 10px 16px;
  line-height: 1.6;
  font-size: 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  color: #333;
}
.streaming-msg .msg-body :deep(pre) {
  background: #1e1e2e;
  color: #cdd6f4;
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
}

/* 思考指示器 */
.thinking-indicator {
  display: flex;
  gap: 4px;
  padding: 10px 16px;
}
.thinking-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #667eea;
  animation: bounce 1.4s infinite ease-in-out both;
}
.thinking-dot:nth-child(1) { animation-delay: 0s; }
.thinking-dot:nth-child(2) { animation-delay: 0.2s; }
.thinking-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* 错误信息 */
.inline-error {
  background: #fff2f0;
  color: #ff4d4f;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  border: 1px solid #ffccc7;
  margin: 8px 0;
}

/* 思考过程块 */
.thinking-block {
  margin: 6px 0;
  border-radius: 8px;
  border: 1px dashed #d6d6e8;
  background: #fafaff;
  overflow: hidden;
  max-width: 85%;
}
.thinking-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 12px;
  color: #888;
  user-select: none;
  transition: background 0.15s;
}
.thinking-header:hover { background: #f0f0f8; }
.thinking-icon { font-size: 13px; }
.thinking-toggle {
  margin-left: auto;
  color: #667eea;
  font-weight: 500;
}
.thinking-content {
  margin: 0;
  padding: 10px 14px;
  border-top: 1px dashed #e0e0ee;
  font-size: 12px;
  color: #666;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  max-height: 320px;
  overflow-y: auto;
}

/* 系统提示条（模型名等） */
.system-hint {
  margin: 6px 0;
  padding: 5px 12px;
  font-size: 11px;
  color: #999;
  background: #f7f7fa;
  border-radius: 6px;
  border-left: 3px solid #d0d0e0;
}
</style>
