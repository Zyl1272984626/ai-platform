<template>
  <div class="test-page page-container">
    <PageHeader title="测试中心" description="Agent测试、E2E页面测试、前端单元测试、API接口测试" />

    <!-- 测试类型 Tab -->
    <div class="type-tabs">
      <button
        v-for="t in testTypes"
        :key="t.type"
        class="type-tab"
        :class="{ active: activeType === t.type }"
        @click="activeType = t.type"
      >
        <span class="tab-icon">{{ t.icon }}</span>
        <span class="tab-name">{{ t.name }}</span>
      </button>
    </div>

    <!-- 当前类型描述 + 参数 + 运行按钮 -->
    <div v-if="currentType" class="type-header">
      <div>
        <h2>{{ currentType.icon }} {{ currentType.name }}</h2>
        <p>{{ currentType.description }}</p>
        <!-- Agent 测试：显示 AgentID / userXgh 输入框 -->
        <div v-if="activeType === 'agent'" class="agent-params">
          <div class="param-row">
            <label>Agent ID <span class="required">*</span></label>
            <input
              v-model="agentId"
              type="text"
              placeholder="粘贴 Agent ID，如 zentao-helper"
              class="param-input"
            />
          </div>
          <div class="param-row">
            <label>用户学号 (userXgh)</label>
            <input
              v-model="userXgh"
              type="text"
              placeholder="可选，如 2024001"
              class="param-input"
            />
          </div>
        </div>
        <!-- E2E 测试：项目选择 + 模式/范围 + 并发控制 -->
        <div v-if="activeType === 'e2e'" class="agent-params">
          <div class="param-row">
            <label>目标项目</label>
            <select v-model="selectedProjectId" @change="onProjectChange" class="param-input">
              <option value="">请选择项目</option>
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div class="param-row">
            <label>测试范围</label>
            <select v-model="e2eScope" class="param-input" :disabled="!selectedProjectId">
              <option value="all">全部页面</option>
              <option v-for="ps in currentPageSets" :key="ps.id" :value="ps.id">
                {{ ps.name }}
              </option>
            </select>
          </div>
        </div>
        <!-- API 测试：项目选择 + 模块勾选 -->
        <div v-if="activeType === 'api'" class="agent-params">
          <div class="param-row">
            <label>目标项目</label>
            <select v-model="selectedProjectId" @change="onApiProjectChange" class="param-input">
              <option value="">请选择项目</option>
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div v-if="apiDiscoverySummary" class="api-discovery-info">
            <span class="discovery-info-text">
              已发现: {{ apiDiscoverySummary.totalModules || 0 }} 模块 {{ apiDiscoverySummary.totalEndpoints || 0 }} 接口
            </span>
          </div>
          <div v-if="apiModules.length > 0" class="module-select">
            <div v-for="mod in apiModules" :key="mod.moduleId" class="module-check">
              <label>
                <input type="checkbox" :value="mod.moduleId" v-model="selectedApiModules" />
                {{ mod.moduleName }} ({{ mod.tests?.length || 0 }} 个)
              </label>
            </div>
          </div>
          <div v-else-if="selectedProjectId && !apiLoading" class="no-discovery-hint">
            未发现接口数据，请前往设置页面点击「发现接口」
          </div>
        </div>
        <!-- 并发控制（所有类型通用） -->
        <div v-if="activeType === 'agent' || activeType === 'e2e'" class="agent-params" style="margin-top:8px;">
          <div class="param-row">
            <label>最大并行数</label>
            <select v-model.number="concurrencyVal" @change="updateConcurrency" class="param-input" style="width:100px;">
              <option :value="1">1</option>
              <option :value="2">2</option>
              <option :value="3">3</option>
              <option :value="4">4</option>
              <option :value="5">5</option>
            </select>
          </div>
        </div>
        <!-- 代码审查：项目选择 + 模块勾选 -->
        <div v-if="activeType === 'codereview'" class="agent-params">
          <div class="param-row">
            <label>目标项目</label>
            <select v-model="selectedProjectId" @change="onReviewProjectChange" class="param-input">
              <option value="">请选择项目</option>
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div v-if="reviewRulesInfo" class="api-discovery-info">
            <span class="discovery-info-text">
              审查规则: {{ reviewRulesInfo.dimensionCount || 0 }} 维度 {{ reviewRulesInfo.ruleCount || 0 }} 条规则
            </span>
          </div>
          <div v-else-if="selectedProjectId && !apiLoading" class="no-discovery-hint">
            未发现审查规则，请前往设置页面点击「发现审查点」
          </div>
          <div v-if="reviewModules.length > 0" class="module-select">
            <div class="module-check module-check-all">
              <label>
                <input type="checkbox" :checked="selectedReviewModules.length === reviewModules.length" @change="toggleAllReviewModules" />
                <strong>全选 ({{ selectedReviewModules.length }}/{{ reviewModules.length }})</strong>
              </label>
            </div>
            <div v-for="mod in reviewModules" :key="mod.id" class="module-check">
              <label>
                <input type="checkbox" :value="mod.id" v-model="selectedReviewModules" />
                <span class="risk-dot" :class="'risk-' + mod.riskLevel" :title="riskLabel(mod.riskLevel)"></span>
                {{ mod.name }} ({{ mod.files }} 文件)
              </label>
            </div>
          </div>
        </div>
        <!-- 前端测试：项目选择 + 模块勾选 -->
        <div v-if="activeType === 'frontend'" class="agent-params">
          <div class="param-row">
            <label>目标项目</label>
            <select v-model="selectedProjectId" @change="onFrontendProjectChange" class="param-input">
              <option value="">请选择项目</option>
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div v-if="frontendDiscoverySummary" class="api-discovery-info">
            <span class="discovery-info-text">
              已发现: {{ frontendDiscoverySummary.totalModules || 0 }} 类 {{ frontendDiscoverySummary.totalTestTargets || 0 }} 个目标
            </span>
          </div>
          <div v-if="frontendModules.length > 0" class="module-select">
            <div class="module-check module-check-all">
              <label>
                <input type="checkbox" :checked="selectedFrontendModules.length === frontendModules.length" @change="toggleAllFrontendModules" />
                <strong>全选 ({{ selectedFrontendModules.length }}/{{ frontendModules.length }})</strong>
              </label>
            </div>
            <div v-for="mod in frontendModules" :key="mod.id" class="module-check">
              <label>
                <input type="checkbox" :value="mod.id" v-model="selectedFrontendModules" />
                {{ mod.name }} ({{ mod.files?.length || 0 }} 个文件)
              </label>
            </div>
          </div>
          <div v-else-if="selectedProjectId && !apiLoading" class="no-discovery-hint">
            请先在设置页面点击「发现组件」
          </div>
        </div>
      </div>
      <div class="type-header-actions">
        <button class="btn-run" :disabled="(activeType === 'agent' && !agentId.trim()) || (activeType === 'e2e' && !selectedProjectId) || (activeType === 'api' && !selectedProjectId) || (activeType === 'frontend' && (!selectedProjectId || selectedFrontendModules.length === 0)) || (activeType === 'codereview' && (!selectedProjectId || selectedReviewModules.length === 0))" @click="startTest">
          <Icon :icon="IconAction.play" :size="16" /> 开始测试
        </button>
        <button v-if="activeType === 'e2e' || activeType === 'codereview' || activeType === 'frontend'" class="btn-prompt" :disabled="!selectedProjectId || (activeType === 'codereview' && selectedReviewModules.length === 0) || (activeType === 'frontend' && selectedFrontendModules.length === 0)" @click="doGeneratePrompt">
          生成提示词
        </button>
        <button v-if="activeType === 'e2e' || activeType === 'codereview' || activeType === 'frontend'" class="btn-scan" :disabled="!selectedProjectId" @click="doScanReportFiles">
          检测报告
        </button>
      </div>
    </div>

    <!-- 运行面板：支持多个并行运行 -->
    <template v-for="[streamId, stream] of activeStreams" :key="streamId">
      <div v-if="stream.type === activeType" class="run-panel" :class="{ 'run-panel-done': stream.done }">
        <div class="run-panel-header">
          <div class="run-panel-title">
            <span v-if="stream.isResume && !stream.done" class="streaming-indicator resume-indicator">恢复运行</span>
            <span v-else-if="!stream.done" class="streaming-indicator">运行中</span>
            <span v-else class="stream-done">已完成</span>
            <span>{{ stream.name || '测试运行中...' }}</span>
          </div>
          <div class="run-panel-actions">
            <span class="run-timer">{{ stream.elapsed }}</span>
            <button v-if="!stream.done" class="btn-stop" @click="stopStream(streamId)">⏹ 停止</button>
          </div>
        </div>
        <div v-if="stream.blocks.length === 0 && !stream.done" class="stream-waiting">
          <div class="waiting-spinner"></div>
          <span>{{ stream.type === 'agent' || stream.type === 'e2e' ? '等待 Claude Code 启动中...' : '等待测试启动中...' }}</span>
        </div>
        <div v-else class="agent-stream" :ref="el => setStreamRef(streamId, el)">
          <template v-for="(block, idx) in stream.blocks" :key="idx">
            <div v-if="block.type === 'text'" class="stream-text">
              <div class="stream-text-html" v-html="renderMarkdown(block.content || '')"></div>
            </div>
            <ToolCallBlock
              v-else-if="block.type === 'tool_use'"
              :name="block.name || 'unknown'"
              :input="block.input"
              :result="block.result || ''"
              :done="!!block.result"
            />
          </template>
        </div>
        <!-- 聊天输入区（代码审查和 Agent 类型可用） -->
        <div v-if="stream.type === 'codereview' || stream.type === 'agent'" class="chat-area">
          <div v-if="stream.chatMessages.length > 0" class="chat-messages">
            <template v-for="(msg, idx) in stream.chatMessages" :key="idx">
              <div class="chat-msg chat-user">
                <span class="chat-avatar"><Icon :icon="IconNav.chat" :size="14" /></span>
                <span class="chat-text">{{ msg.text }}</span>
              </div>
              <div v-if="msg.reply" class="chat-msg chat-assistant">
                <span class="chat-avatar brand"><Icon :icon="IconBiz.sparkles" :size="14" /></span>
                <div class="chat-text" v-html="renderMarkdown(msg.reply)"></div>
              </div>
            </template>
          </div>
          <div class="chat-input-row">
            <input
              v-model="stream.chatInput"
              placeholder="输入消息，如'重点看一下 auth.ts 的安全性'..."
              @keydown.enter="sendChat(streamId)"
              :disabled="stream.chatLoading"
            />
            <button @click="sendChat(streamId)" :disabled="stream.chatLoading || !stream.chatInput?.trim()">
              {{ stream.chatLoading ? '...' : '发送' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 历史记录 -->
    <section class="history-section">
      <h3>历史记录</h3>
      <div v-if="filteredRuns.length === 0" class="no-data">暂无测试记录</div>
      <div v-for="run in filteredRuns" :key="run.id" class="run-card" :class="['run-' + run.status, { 'run-card-active': run.status === 'running' }]">
        <div class="run-header" @click="toggleExpand(run.id)">
          <div class="run-left">
            <StatusBadge :status="run.status" size="small" />
            <span class="run-name">{{ run.name }}</span>
            <span v-if="run.config?.agentId" class="run-config-tag">{{ run.config.agentId }}</span>
            <span v-if="run.type === 'e2e' && run.config?.scope" class="run-config-tag">{{ run.config.scope }}</span>
          </div>
          <div class="run-right">
            <span v-if="run.duration" class="run-dur">{{ (run.duration / 1000).toFixed(1) }}s</span>
            <span v-if="run.status === 'running'" class="run-running-badge">运行中</span>
            <span class="run-time">{{ formatTime(run.startedAt) }}</span>
            <button v-if="run.status === 'running'" class="btn-stop-sm" @click.stop="stopRun(run.id)">停止</button>
            <button v-else-if="!activeStreams.has(run.id)" class="btn-view-stream" @click.stop="resumeStream(run.id)">查看日志</button>
            <span v-else class="run-toggle"><Icon :icon="expanded === run.id ? IconArrow.up : IconArrow.down" :size="12" /></span>
          </div>
        </div>
        <div v-if="expanded === run.id" class="run-detail">
          <div v-for="tc in run.cases" :key="tc.id" class="detail-case">
            <div class="detail-case-header">
              <span class="case-title">
                <span class="case-status-dot" :class="'dot-' + tc.status"></span>
                {{ tc.name }}
              </span>
              <span v-if="tc.duration" class="case-dur">{{ (tc.duration / 1000).toFixed(1) }}s</span>
            </div>
            <!-- 有 blocks 时用结构化渲染 -->
            <div v-if="getCaseBlocks(tc).length" class="history-stream">
              <template v-for="(block, idx) in getCaseBlocks(tc)" :key="idx">
                <div v-if="block.type === 'text'" class="stream-text">
                  <div class="stream-text-html" v-html="renderMarkdown(block.content || '')"></div>
                </div>
                <ToolCallBlock
                  v-else-if="block.type === 'tool_use'"
                  :name="block.name || 'unknown'"
                  :input="block.input"
                  :result="block.result || ''"
                  :done="!!block.result"
                />
              </template>
            </div>
            <!-- 无 blocks 时回退到纯文本 -->
            <div v-else-if="tc.output" class="detail-output">
              <pre>{{ tc.output.slice(0, 2000) }}</pre>
            </div>
            <div v-if="tc.error" class="detail-error">{{ tc.error }}</div>
          </div>
          <div class="detail-actions">
            <button v-if="canResume(run)" class="btn-resume" @click.stop="handleResumeRun(run.id)">
              <Icon :icon="IconAction.refresh" :size="14" /> {{ run.type === 'e2e' ? '恢复测试' : '恢复审查' }}
            </button>
            <button v-if="canChat(run) && !canResume(run)" class="btn-chat" @click.stop="openChatStream(run.id)">
              <Icon :icon="IconNav.chat" :size="14" /> 继续对话
            </button>
            <div v-if="(run.type === 'e2e' || run.type === 'codereview') && run.config?.reportPath" class="report-info">
              <span class="report-path">{{ run.config.reportPath }}</span>
              <button class="btn-report" @click.stop="openReport(run.id)">查看报告</button>
            </div>
            <div v-if="run.type === 'e2e' && run.config?.e2eSummary" class="e2e-summary">
              <span>总计 {{ (run.config.e2eSummary as any).totalPages }} 页，通过 {{ (run.config.e2eSummary as any).passed }}，失败 {{ (run.config.e2eSummary as any).failed }}，平均分 {{ (run.config.e2eSummary as any).avgScore }}</span>
            </div>
            <button class="btn-del" @click.stop="handleDelete(run.id)">删除记录</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 提示词弹窗 -->
    <BaseModal v-model:show="showPromptModal" title="生成的提示词" :width="680">
        <p class="field-desc">复制以下内容粘贴到 Claude Code 窗口即可手动执行</p>
        <textarea class="prompt-textarea" readonly :value="generatedPrompt" @click="($event.target as HTMLTextAreaElement).select()"></textarea>
        <template #footer>
          <BaseButton variant="ghost" @click="showPromptModal = false">关闭</BaseButton>
          <BaseButton variant="primary" @click="copyPrompt">{{ promptCopied ? '已复制!' : '复制提示词' }}</BaseButton>
        </template>
    </BaseModal>

    <!-- 报告文件浏览器弹窗 -->
    <BaseModal v-model:show="showReportFilesModal" :width="720">
        <template #title>{{ reportFilesModalTitle }} <span class="modal-subtitle">{{ reportFilesDir }}</span></template>
        <div v-if="reportFilesLoading" class="report-loading">扫描中...</div>
        <div v-else-if="reportFiles.length === 0" class="no-data">未找到报告文件</div>
        <template v-else>
          <div v-if="activeType === 'codereview'" class="report-files-header">
            <label class="select-all-label">
              <input type="checkbox" :checked="selectedMdFiles.length === mdFileList.length && mdFileList.length > 0" @change="toggleAllMdFiles" />
              <strong>全选 MD ({{ selectedMdFiles.length }}/{{ mdFileList.length }})</strong>
            </label>
            <button class="btn btn-build" :disabled="selectedMdFiles.length === 0 || buildLoading" @click="doBuildFromMdFiles">
              {{ buildLoading ? '生成中...' : `生成 HTML (${selectedMdFiles.length} 个MD)` }}
            </button>
          </div>
          <div v-else class="report-files-hint">
            <span class="modal-subtitle">点击「打开」在新窗口查看 HTML 报告（已为成品，无需重新生成）</span>
          </div>
          <div class="report-files-list">
            <div v-for="f in reportFiles" :key="f.path" class="report-file-item" :class="'file-' + f.type">
              <template v-if="f.type === 'md'">
                <input type="checkbox" :value="f.path" v-model="selectedMdFiles" />
                <span class="file-icon"><Icon :icon="IconBiz.doc" :size="16" /></span>
              </template>
              <template v-else-if="f.type === 'json'">
                <span class="file-icon"><Icon :icon="IconBiz.clipboard" :size="16" /></span>
              </template>
              <template v-else>
                <span class="file-icon"><Icon :icon="IconBiz.globe" :size="16" /></span>
              </template>
              <span class="file-name" :title="f.name">{{ f.name }}</span>
              <span class="file-size">{{ (f.size / 1024).toFixed(1) }} KB</span>
              <button v-if="f.type === 'html'" class="btn-open-file" @click="openReportFile(f.path)">打开</button>
            </div>
          </div>
        </template>
        <template #footer>
          <BaseButton variant="ghost" @click="showReportFilesModal = false">关闭</BaseButton>
        </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick, onUnmounted } from 'vue'
import { marked } from 'marked'
import StatusBadge from '../components/common/StatusBadge.vue'
import ToolCallBlock from '../components/chat/ToolCallBlock.vue'
import PageHeader from '../components/layout/PageHeader.vue'
import BaseModal from '../components/ui/BaseModal.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import Icon from '../components/ui/Icon.vue'
import { IconAction, IconNav, IconBiz, IconArrow } from '../composables/icons'
import {
  listTestTypes, listTestRuns, runTest, deleteTestRun as apiDelete,
  abortTestRun as apiAbort, getReportUrl, listRunningTests, subscribeTestStream,
  getConcurrency, setConcurrency as apiSetConcurrency,
  resumeTestRun as apiResume, chatWithReviewApi,
  generateTestPrompt as apiGenerateTestPrompt,
  listReportFiles as apiListReportFiles, buildHtmlFromMdFiles as apiBuildHtmlFromMdFiles,
  type TestTypeInfo, type TestRun, type ReportFile,
} from '../api/tests'
import {
  getProjects as fetchProjects,
  getProjectPages,
  getApiTests,
  getApiDiscovery,
  getFrontendDiscovery,
  getReviewDiscovery,
  getReviewRules,
  type TestProject,
  type PageSet,
} from '../api/projects'

marked.setOptions({ breaks: true, gfm: true })

interface StreamBlock {
  type: 'text' | 'tool_use'
  content?: string
  name?: string
  input?: any
  result?: string
  toolUseId?: string
}

interface ChatMessage {
  text: string
  reply: string
  loading?: boolean
}

interface StreamState {
  blocks: StreamBlock[]
  done: boolean
  elapsed: string
  timer: ReturnType<typeof setInterval> | null
  es: EventSource | null
  name: string
  type: string  // 测试类型，用于过滤显示
  isResume?: boolean  // 是否为恢复模式
  chatMessages: ChatMessage[]
  chatInput: string
  chatLoading: boolean
}

const testTypes = ref<TestTypeInfo[]>([])
const activeType = ref('agent')
const runs = ref<TestRun[]>([])
const expanded = ref<string | null>(null)

// 多运行流管理：suiteId -> StreamState
const activeStreams = ref<Map<string, StreamState>>(new Map())
const streamRefs = new Map<string, HTMLElement>()

// Agent 测试参数
const agentId = ref('')
const userXgh = ref('')

// E2E 测试参数
const e2eScope = ref('all')

// 多项目支持
const projects = ref<TestProject[]>([])
const selectedProjectId = ref<string>('')
const currentPageSets = ref<PageSet[]>([])
const loadingPages = ref(false)

// 并发控制
const concurrencyVal = ref(2)

// API 测试参数
const apiModules = ref<any[]>([])
const selectedApiModules = ref<string[]>([])
const apiDiscoverySummary = ref<any>(null)
const apiLoading = ref(false)

// 代码审查参数
const reviewRulesInfo = ref<any>(null)
const reviewModules = ref<any[]>([])
const selectedReviewModules = ref<string[]>([])

// 前端测试参数
const frontendDiscoverySummary = ref<any>(null)
const frontendModules = ref<any[]>([])
const selectedFrontendModules = ref<string[]>([])

const currentType = computed(() => testTypes.value.find(t => t.type === activeType.value))
const filteredRuns = computed(() => runs.value.filter(r => r.type === activeType.value))

function riskLabel(level: string) {
  if (level === 'high') return '高风险'
  if (level === 'medium') return '中风险'
  return '低风险'
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function toggleExpand(id: string) {
  expanded.value = expanded.value === id ? null : id
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  try {
    return marked.parse(text) as string
  } catch {
    return text.replace(/\n/g, '<br>')
  }
}

function getCaseBlocks(tc: any): StreamBlock[] {
  return tc.blocks || []
}

function setStreamRef(suiteId: string, el: any) {
  if (el) streamRefs.set(suiteId, el as HTMLElement)
}

function scrollToBottom(suiteId: string) {
  nextTick(() => {
    const el = streamRefs.get(suiteId)
    if (el) el.scrollTop = el.scrollHeight
  })
}

function startElapsedTimer(suiteId: string, startTime: number) {
  const stream = activeStreams.value.get(suiteId)
  if (!stream) return
  stream.timer = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000)
    stream.elapsed = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, '0')}s`
  }, 1000)
}

function stopElapsedTimer(suiteId: string) {
  const stream = activeStreams.value.get(suiteId)
  if (stream?.timer) {
    clearInterval(stream.timer)
    stream.timer = null
  }
}

async function refreshRuns() {
  try {
    runs.value = await listTestRuns()
  } catch { /* ignore */ }
}

/** 连接到运行中测试的 SSE 流 */
function connectStream(suiteId: string, startTime: number) {
  const stream = activeStreams.value.get(suiteId)
  if (!stream) return

  startElapsedTimer(suiteId, startTime)

  const es = subscribeTestStream(suiteId)
  stream.es = es

  es.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data)
      handleSSEEvent(evt, suiteId)
    } catch { /* skip */ }
  }

  es.onerror = () => {
    const s = activeStreams.value.get(suiteId)
    if (s) {
      s.done = true
      if (s.es) { s.es.close(); s.es = null }
      // 从 activeStreams 中移除，避免残留面板
      // 延迟 2 秒移除，让用户看到完成状态
      setTimeout(() => {
        activeStreams.value.delete(suiteId)
        stopElapsedTimer(suiteId)
        refreshRuns()
      }, 2000)
    }
    stopElapsedTimer(suiteId)
    refreshRuns()
  }
}

/** 处理 SSE 事件 */
function handleSSEEvent(evt: any, suiteId: string) {
  const stream = activeStreams.value.get(suiteId)
  if (!stream) return

  if (evt.event === 'agent:stream') {
    if (evt.type === 'text' && evt.content) {
      const last = stream.blocks[stream.blocks.length - 1]
      if (last && last.type === 'text') {
        last.content += evt.content
      } else {
        stream.blocks.push({ type: 'text', content: evt.content })
      }
      scrollToBottom(suiteId)
    } else if (evt.type === 'tool_use') {
      stream.blocks.push({
        type: 'tool_use',
        name: evt.name,
        input: evt.input,
        toolUseId: evt.id,
      })
      scrollToBottom(suiteId)
    } else if (evt.type === 'tool_result') {
      const block = stream.blocks.find(
        b => b.type === 'tool_use' && b.toolUseId === evt.toolUseId
      )
      if (block) {
        block.result = evt.content || '(无输出)'
      }
      scrollToBottom(suiteId)
    }
  } else if (evt.event === 'test:error') {
    stream.done = true
    stream.blocks.push({ type: 'text', content: `\n\n> **测试中断**: ${evt.error || '用户手动停止'}` })
    if (stream.es) { stream.es.close(); stream.es = null }
    stopElapsedTimer(suiteId)
    refreshRuns()
  } else if (evt.event === 'test:done') {
    stream.done = true
    // 对于非 Agent/E2E 测试，显示完成信息
    if (stream.type !== 'agent' && stream.type !== 'e2e') {
      stream.blocks.push({ type: 'text', content: `\n**测试运行完成** (${evt.status || 'finished'})` })
    }
    if (stream.es) { stream.es.close(); stream.es = null }
    stopElapsedTimer(suiteId)
    refreshRuns()
  } else if (evt.event === 'test:start') {
    // 获取名称
    refreshRuns().then(() => {
      const run = runs.value.find(r => r.id === suiteId)
      if (run) stream.name = run.name
    })
    // 对于非 Agent/E2E 测试，显示启动信息
    if (stream.type !== 'agent' && stream.type !== 'e2e') {
      stream.blocks.push({ type: 'text', content: '测试开始运行...\n' })
    }
  } else if (evt.event === 'test:update') {
    // 对于非 Agent/E2E 测试，用文本 block 显示进度
    if (stream.type !== 'agent' && stream.type !== 'e2e') {
      const statusMap: Record<string, string> = {
        running: '运行中',
        passed: '通过',
        failed: '失败',
        error: '错误',
        pending: '等待',
      }
      const label = statusMap[evt.status] || '更新'
      const dur = evt.duration ? ` (${(evt.duration / 1000).toFixed(1)}s)` : ''
      stream.blocks.push({
        type: 'text',
        content: `**${label}** ${evt.caseName || evt.caseId || '测试用例'}${dur}\n`,
      })
      scrollToBottom(suiteId)
    }
    // 同时刷新 runs 以更新历史
    refreshRuns()
  } else if (evt.event === 'test:resumed') {
    // 恢复模式提示
    const skipped = evt.skippedCases?.length || 0
    const resumed = evt.resumedCases?.length || 0
    stream.isResume = true
    stream.blocks.push({
      type: 'text',
      content: `**恢复模式**：跳过 ${skipped} 个已完成模块，恢复 ${resumed} 个中断模块\n`,
    })
    scrollToBottom(suiteId)
  } else if (evt.event === 'agent:chat') {
    // 聊天消息事件
    if (evt.type === 'text' && evt.content) {
      // 追加到聊天消息的回复中
      const lastMsg = stream.chatMessages[stream.chatMessages.length - 1]
      if (lastMsg && lastMsg.loading) {
        lastMsg.reply += evt.content
        lastMsg.loading = false
      } else if (lastMsg) {
        lastMsg.reply += evt.content
      }
      scrollToBottom(suiteId)
    } else if (evt.type === 'tool_use') {
      // 工具调用在聊天回复中简要显示
      const lastMsg = stream.chatMessages[stream.chatMessages.length - 1]
      if (lastMsg) {
        const toolLine = `\n调用 ${evt.name}(${Object.keys(evt.input || {}).slice(0, 2).join(', ')}...)\n`
        lastMsg.reply += toolLine
      }
      scrollToBottom(suiteId)
    }
  }
}

/** 从 UI 开始新测试 */
// ========== 生成提示词 ==========
const showPromptModal = ref(false)
const generatedPrompt = ref('')
const promptCopied = ref(false)

async function doGeneratePrompt() {
  const config: Record<string, unknown> = {}
  if (activeType.value === 'e2e') {
    config.mode = 'deep'
    config.scope = e2eScope.value
    config.projectId = selectedProjectId.value
  }
  if (activeType.value === 'codereview') {
    config.projectId = selectedProjectId.value
    config.modules = selectedReviewModules.value
  }
  if (activeType.value === 'frontend') {
    config.projectId = selectedProjectId.value
    config.modules = selectedFrontendModules.value
  }

  try {
    const result = await apiGenerateTestPrompt(activeType.value, config)
    generatedPrompt.value = result.prompt
    showPromptModal.value = true
    promptCopied.value = false
  } catch (e: any) {
    alert('生成提示词失败: ' + (e.response?.data?.error || e.message))
  }
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(generatedPrompt.value)
    promptCopied.value = true
    setTimeout(() => { promptCopied.value = false }, 2000)
  } catch {
    // fallback: select textarea
    const ta = document.querySelector('.prompt-textarea') as HTMLTextAreaElement
    if (ta) { ta.select(); document.execCommand('copy') }
    promptCopied.value = true
    setTimeout(() => { promptCopied.value = false }, 2000)
  }
}

// ========== 报告文件浏览器 ==========
const showReportFilesModal = ref(false)
const reportFiles = ref<ReportFile[]>([])
const reportFilesDir = ref('')
const reportFilesLoading = ref(false)
const selectedMdFiles = ref<string[]>([])
const buildLoading = ref(false)

const mdFileList = computed(() => reportFiles.value.filter(f => f.type === 'md'))

function toggleAllMdFiles() {
  if (selectedMdFiles.value.length === mdFileList.value.length) {
    selectedMdFiles.value = []
  } else {
    selectedMdFiles.value = mdFileList.value.map(f => f.path)
  }
}

async function doScanReportFiles() {
  if (!selectedProjectId.value) return
  // 仅 codereview/frontend/e2e 显示按钮，这里断言为安全的报告扫描类型
  const scanType = activeType.value as 'codereview' | 'frontend' | 'e2e'
  showReportFilesModal.value = true
  reportFilesLoading.value = true
  reportFiles.value = []
  selectedMdFiles.value = []
  try {
    const res = await apiListReportFiles(selectedProjectId.value, scanType)
    reportFiles.value = res.files
    reportFilesDir.value = res.reportsDir
  } catch (e: any) {
    reportFiles.value = []
    reportFilesDir.value = ''
    window.alert('检测报告失败: ' + (e?.response?.data?.error || e.message))
  } finally {
    reportFilesLoading.value = false
  }
}

/** 报告弹窗标题：按当前测试类型显示对应名称 */
const reportFilesModalTitle = computed(() => {
  const map: Record<string, string> = {
    codereview: '代码审查报告',
    frontend: '前端单元测试报告',
    e2e: 'E2E 页面测试报告',
  }
  return map[activeType.value] || '报告文件'
})

async function doBuildFromMdFiles() {
  if (selectedMdFiles.value.length === 0 || !selectedProjectId.value) return
  buildLoading.value = true
  try {
    const res = await apiBuildHtmlFromMdFiles(selectedProjectId.value, selectedMdFiles.value)
    alert(`生成成功！${res.moduleCount} 个模块 → ${res.htmlPath}`)
    // 重新扫描
    await doScanReportFiles()
  } catch (e: any) {
    alert('生成失败: ' + (e?.response?.data?.error || e.message))
  } finally {
    buildLoading.value = false
  }
}

function openReportFile(filePath: string) {
  // 在新窗口打开 HTML 报告（用 file:// 协议）
  window.open('file:///' + filePath.replace(/\\/g, '/'), '_blank')
}

async function startTest() {
  if (!currentType.value) return

  // Agent 类型需要 agentId
  if (activeType.value === 'agent' && !agentId.value.trim()) return

  const config: Record<string, unknown> = {}
  if (activeType.value === 'agent') {
    config.agentId = agentId.value.trim()
    config.userXgh = userXgh.value.trim()
  }
  if (activeType.value === 'e2e') {
    config.mode = 'deep'
    config.scope = e2eScope.value
    config.projectId = selectedProjectId.value
  }
  if (activeType.value === 'api') {
    config.projectId = selectedProjectId.value
    config.modules = selectedApiModules.value
  }
  if (activeType.value === 'codereview') {
    config.projectId = selectedProjectId.value
    config.modules = selectedReviewModules.value
  }
  if (activeType.value === 'frontend') {
    config.projectId = selectedProjectId.value
    config.modules = selectedFrontendModules.value
  }

  try {
    const { suiteId } = await runTest(activeType.value, config)

    // 创建流状态
    const stream = reactive<StreamState>({
      blocks: [],
      done: false,
      elapsed: '0s',
      timer: null,
      es: null,
      name: '',
      type: activeType.value,
      isResume: false,
      chatMessages: [],
      chatInput: '',
      chatLoading: false,
    })
    activeStreams.value.set(suiteId, stream)

    // 连接 SSE
    connectStream(suiteId, Date.now())

    // 刷新历史
    refreshRuns()
  } catch (e: any) {
    alert('测试执行失败: ' + (e.response?.data?.error || e.message))
  }
}

/** 恢复运行中测试的 SSE 连接（用于页面刷新后） */
function resumeStream(suiteId: string) {
  if (activeStreams.value.has(suiteId)) return

  const run = runs.value.find(r => r.id === suiteId)
  if (!run) return

  const stream = reactive<StreamState>({
    blocks: [],
    done: false,
    elapsed: '...',
    timer: null,
    es: null,
    name: run.name,
    type: run.type,
    isResume: false,
    chatMessages: [],
    chatInput: '',
    chatLoading: false,
  })
  activeStreams.value.set(suiteId, stream)

  const startTime = new Date(run.startedAt).getTime()
  connectStream(suiteId, startTime)
}

/** 停止运行中的测试 */
async function stopStream(suiteId: string) {
  try {
    await apiAbort(suiteId)
  } catch (e: any) {
    alert('停止失败: ' + e.message)
  }
}

async function stopRun(runId: string) {
  try {
    await apiAbort(runId)
    runs.value = await listTestRuns()
  } catch { /* ignore */ }
}

async function handleDelete(id: string) {
  try {
    await apiDelete(id)
    activeStreams.value.delete(id)
    runs.value = await listTestRuns()
    if (expanded.value === id) expanded.value = null
  } catch { /* ignore */ }
}

async function updateConcurrency() {
  try {
    await apiSetConcurrency(activeType.value, concurrencyVal.value)
  } catch { /* ignore */ }
}

async function onProjectChange() {
  currentPageSets.value = []
  e2eScope.value = 'all'
  if (!selectedProjectId.value) return

  loadingPages.value = true
  try {
    const res = await getProjectPages(selectedProjectId.value)
    currentPageSets.value = res.data || []
  } catch { /* ignore */ }
  loadingPages.value = false
}

async function onApiProjectChange() {
  apiModules.value = []
  selectedApiModules.value = []
  apiDiscoverySummary.value = null
  if (!selectedProjectId.value) return

  apiLoading.value = true
  try {
    const [discoveryRes, testsRes] = await Promise.all([
      getApiDiscovery(selectedProjectId.value).catch(() => ({ data: null })),
      getApiTests(selectedProjectId.value).catch(() => ({ data: null })),
    ])
    if (discoveryRes.data) {
      apiDiscoverySummary.value = discoveryRes.data.summary
    }
    if (testsRes.data?.testModules) {
      apiModules.value = testsRes.data.testModules
      selectedApiModules.value = testsRes.data.testModules.map((m: any) => m.moduleId)
    }
  } catch { /* ignore */ }
  apiLoading.value = false
}

async function onReviewProjectChange() {
  reviewRulesInfo.value = null
  reviewModules.value = []
  selectedReviewModules.value = []
  if (!selectedProjectId.value) return

  apiLoading.value = true
  try {
    const [rulesRes, discoveryRes] = await Promise.all([
      getReviewRules(selectedProjectId.value).catch(() => ({ data: null })),
      getReviewDiscovery(selectedProjectId.value).catch(() => ({ data: null })),
    ])
    if (rulesRes.data?.dimensions) {
      const dims = rulesRes.data.dimensions
      const ruleCount = dims.reduce((s: number, d: any) => s + (d.rules?.length || 0), 0)
      reviewRulesInfo.value = { dimensionCount: dims.length, ruleCount }
    }
    if (discoveryRes.data?.modules) {
      reviewModules.value = discoveryRes.data.modules
      // 默认全选
      selectedReviewModules.value = discoveryRes.data.modules.map((m: any) => m.id)
    }
  } catch { /* ignore */ }
  apiLoading.value = false
}

function openReport(runId: string) {
  window.open(getReportUrl(runId), '_blank')
}

function toggleAllReviewModules() {
  if (selectedReviewModules.value.length === reviewModules.value.length) {
    selectedReviewModules.value = []
  } else {
    selectedReviewModules.value = reviewModules.value.map((m: any) => m.id)
  }
}

async function onFrontendProjectChange() {
  frontendDiscoverySummary.value = null
  frontendModules.value = []
  selectedFrontendModules.value = []
  if (!selectedProjectId.value) return

  apiLoading.value = true
  try {
    const discoveryRes = await getFrontendDiscovery(selectedProjectId.value).catch(() => ({ data: null }))
    if (discoveryRes.data?.summary) {
      frontendDiscoverySummary.value = discoveryRes.data.summary
    }
    if (discoveryRes.data?.modules) {
      frontendModules.value = discoveryRes.data.modules
      // 默认全选
      selectedFrontendModules.value = discoveryRes.data.modules.map((m: any) => m.id)
    }
  } catch { /* ignore */ }
  apiLoading.value = false
}

function toggleAllFrontendModules() {
  if (selectedFrontendModules.value.length === frontendModules.value.length) {
    selectedFrontendModules.value = []
  } else {
    selectedFrontendModules.value = frontendModules.value.map((m: any) => m.id)
  }
}

/** 恢复中断的代码审查 */
async function handleResumeRun(runId: string) {
  try {
    const { suiteId } = await apiResume(runId)

    // 创建流状态
    const run = runs.value.find(r => r.id === runId)
    const stream = reactive<StreamState>({
      blocks: [],
      done: false,
      elapsed: '0s',
      timer: null,
      es: null,
      name: run?.name || '恢复审查中...',
      type: 'codereview',
      isResume: true,
      chatMessages: [],
      chatInput: '',
      chatLoading: false,
    })
    activeStreams.value.set(suiteId, stream)
    connectStream(suiteId, Date.now())
    refreshRuns()

    // 切换到代码审查 tab
    activeType.value = 'codereview'
  } catch (e: any) {
    alert('恢复失败: ' + (e.response?.data?.error || e.message))
  }
}

/** 检查 run 是否有可恢复的模块 */
function canResume(run: TestRun): boolean {
  if (run.type !== 'codereview' && run.type !== 'e2e') return false
  if (run.status !== 'error' && run.status !== 'failed') return false
  const resumeInfo = run.config?.resumeInfo as any
  if (!resumeInfo?.cases) return false
  return Object.values(resumeInfo.cases).some((c: any) => c.status === 'interrupted')
}

/** 检查 run 是否可以发起对话 */
function canChat(run: TestRun): boolean {
  if (run.type !== 'codereview') return false
  if (run.status === 'running') return false
  const resumeInfo = run.config?.resumeInfo as any
  if (!resumeInfo?.cases) return false
  return Object.values(resumeInfo.cases).some((c: any) => c.sessionId)
}

/** 发送聊天消息 */
async function sendChat(streamId: string) {
  const stream = activeStreams.value.get(streamId)
  if (!stream || !stream.chatInput?.trim()) return

  const message = stream.chatInput.trim()
  stream.chatInput = ''
  stream.chatMessages.push({ text: message, reply: '', loading: true })
  stream.chatLoading = true

  try {
    await chatWithReviewApi(streamId, message)
    // SSE 会自动接收 agent:chat 事件，追加到 chatMessages
  } catch (e: any) {
    const lastMsg = stream.chatMessages[stream.chatMessages.length - 1]
    if (lastMsg) {
      lastMsg.reply = `发送失败: ${e.response?.data?.error || e.message}`
      lastMsg.loading = false
    }
  } finally {
    stream.chatLoading = false
  }
}

/** 从历史记录打开对话流 */
function openChatStream(runId: string) {
  if (activeStreams.value.has(runId)) return

  const run = runs.value.find(r => r.id === runId)
  if (!run) return

  const stream = reactive<StreamState>({
    blocks: [],
    done: false,
    elapsed: '...',
    timer: null,
    es: null,
    name: run.name,
    type: run.type,
    isResume: false,
    chatMessages: [],
    chatInput: '',
    chatLoading: false,
  })
  activeStreams.value.set(runId, stream)
  activeType.value = run.type

  // 连接 SSE（已完成的项目会立即收到 test:done）
  connectStream(runId, new Date(run.startedAt).getTime())
}

// 页面加载：初始化 + 恢复运行中的测试
onMounted(async () => {
  try {
    // 先加载类型和 runs（cleanupStaleRuns 在 listTestRuns 内部执行）
    const [types, r, concurrency, projRes] = await Promise.all([
      listTestTypes(),
      listTestRuns(),
      getConcurrency(),
      fetchProjects(),
    ])
    testTypes.value = types
    runs.value = r
    projects.value = projRes.data

    // 自动选择默认项目
    if (projects.value.length > 0 && !selectedProjectId.value) {
      selectedProjectId.value = projects.value[0].id
      onProjectChange()
    }

    // 之后再查 running，确保拿到清理后的数据
    const running = await listRunningTests()

    // 设置当前类型的并发数
    const typeKey = activeType.value as string
    if (concurrency && (concurrency as any)[typeKey]) {
      concurrencyVal.value = (concurrency as any)[typeKey]
    }

    // 恢复所有运行中的测试的 SSE 连接
    for (const suite of running) {
      const stream = reactive<StreamState>({
        blocks: [],
        done: false,
        elapsed: '...',
        timer: null,
        es: null,
        name: suite.name,
        type: suite.type,
        isResume: false,
        chatMessages: [],
        chatInput: '',
        chatLoading: false,
      })
      activeStreams.value.set(suite.id, stream)

      const startTime = new Date(suite.startedAt).getTime()
      connectStream(suite.id, startTime)
    }
  } catch { /* ignore */ }
})

// 监听 activeType 变化，更新并发数显示
import { watch } from 'vue'
watch(activeType, async (newType) => {
  try {
    const concurrency = await getConcurrency()
    if (concurrency && (concurrency as any)[newType]) {
      concurrencyVal.value = (concurrency as any)[newType]
    }
  } catch { /* ignore */ }

  // 切换类型时，如果已有选中项目，自动加载对应数据
  if (selectedProjectId.value) {
    if (newType === 'e2e') onProjectChange()
    else if (newType === 'api') onApiProjectChange()
    else if (newType === 'codereview') onReviewProjectChange()
    else if (newType === 'frontend') onFrontendProjectChange()
  }
})

onUnmounted(() => {
  for (const [, stream] of activeStreams.value) {
    if (stream.es) stream.es.close()
    if (stream.timer) clearInterval(stream.timer)
  }
  activeStreams.value.clear()
})
</script>

<style scoped>

/* 类型 Tab */
.type-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
}
.type-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: #fff;
  border: 2px solid #eee;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  color: #666;
  transition: all 0.15s;
}
.type-tab:hover { border-color: #c0c0e0; }
.type-tab.active {
  border-color: #667eea;
  background: var(--brand-soft);
  color: #667eea;
  font-weight: 600;
}
.tab-icon { font-size: 18px; }
.tab-name { white-space: nowrap; }

/* 类型头部 */
.type-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  background: #fff;
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.type-header h2 { font-size: 16px; font-weight: 600; color: var(--text-1); margin-bottom: 4px; }
.type-header p { font-size: 13px; color: #888; }
.btn-run {
  padding: 10px 28px;
  background: var(--brand);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  transition: background var(--duration) var(--ease);
  flex-shrink: 0;
  margin-top: 4px;
}
.btn-run:hover:not(:disabled) { background: var(--brand-hover); }
.btn-run:disabled { opacity: 0.5; cursor: not-allowed; }
.type-header-actions {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex-shrink: 0;
}
.btn-prompt {
  padding: 10px 20px;
  background: #fff;
  color: #667eea;
  border: 2px solid #667eea;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  transition: all 0.15s;
  margin-top: 4px;
}
.btn-prompt:hover { background: var(--brand-soft); }
.btn-prompt:disabled { opacity: 0.5; cursor: not-allowed; }

/* 提示词弹窗 */
.prompt-textarea {
  width: 100%;
  min-height: 280px;
  max-height: 60vh;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  background: var(--bg-surface-2);
  color: #333;
}
.btn-copy {
  padding: 8px 20px;
  background: linear-gradient(135deg, #667eea, var(--brand-active));
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.btn-copy:hover { opacity: 0.9; }

/* Agent 参数 */
.agent-params {
  margin-top: 14px;
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.param-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.param-row label {
  font-size: 12px;
  font-weight: 500;
  color: #666;
}
.required { color: var(--error); }
.param-input {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  width: 240px;
  outline: none;
  transition: border-color 0.15s;
}
.param-input:focus { border-color: #667eea; }
select.param-input { cursor: pointer; appearance: auto; }

/* 运行面板 */
.run-panel {
  background: #fff;
  border-radius: 12px;
  padding: 0;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  border: 2px solid #667eea;
  overflow: hidden;
}
.run-panel-done {
  border-color: var(--success);
}
.run-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: var(--brand-soft);
  font-size: 13px;
  font-weight: 600;
  color: #333;
}
.run-panel-done .run-panel-header {
  background: var(--success-bg);
}
.run-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.run-panel-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.run-timer {
  font-family: monospace;
  font-size: 13px;
  color: #667eea;
  font-weight: 600;
}
.run-panel-done .run-timer {
  color: var(--success);
}
.streaming-indicator {
  font-size: 12px;
  color: var(--info);
  font-weight: 500;
}
.streaming-indicator::before {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  background: var(--info);
  border-radius: 50%;
  margin-right: 4px;
  animation: pulse 1s infinite;
}
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
.stream-done {
  font-size: 12px;
  color: var(--success);
  font-weight: 500;
}
.btn-stop {
  padding: 6px 16px;
  background: var(--error);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition: opacity 0.15s;
}
.btn-stop:hover { opacity: 0.85; }

/* 等待状态 */
.stream-waiting {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 24px;
  color: #999;
  font-size: 13px;
}
.waiting-spinner {
  width: 16px; height: 16px;
  border: 2px solid var(--border);
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* 实时流内容 */
.agent-stream {
  max-height: 500px;
  overflow-y: auto;
  padding: 12px 20px;
}
.stream-text {
  margin-bottom: 8px;
}
.stream-text-html {
  font-size: 13px;
  line-height: 1.7;
  color: #333;
}
.stream-text-html :deep(pre) {
  background: var(--code-bg);
  color: var(--code-text);
  padding: 10px 14px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 12px;
  margin: 6px 0;
}
.stream-text-html :deep(code) {
  background: var(--bg-surface-2);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
  font-family: monospace;
}
.stream-text-html :deep(pre code) {
  background: none;
  padding: 0;
}
.stream-text-html :deep(p) { margin: 4px 0; }
.stream-text-html :deep(ul), .stream-text-html :deep(ol) { padding-left: 18px; }
.stream-text-html :deep(strong) { color: var(--text-1); }
.stream-text-html :deep(h1), .stream-text-html :deep(h2), .stream-text-html :deep(h3) {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  margin: 10px 0 6px;
}

/* 历史 */
.history-section { margin-top: 8px; }
.history-section h3 { font-size: 16px; font-weight: 600; color: #333; margin-bottom: 14px; }
.no-data { color: #bbb; font-size: 13px; padding: 20px 0; }
.run-card {
  background: #fff;
  border-radius: 10px;
  margin-bottom: 8px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  overflow: hidden;
  transition: box-shadow 0.2s;
}
.run-card-active {
  box-shadow: 0 0 0 2px var(--info), 0 2px 8px rgba(24,144,255,0.15);
}
.run-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.15s;
}
.run-header:hover { background: var(--bg-surface-2); }
.run-left { display: flex; align-items: center; gap: 10px; }
.run-name { font-size: 13px; font-weight: 500; color: #333; }
.run-config-tag {
  font-size: 11px;
  color: #667eea;
  background: var(--brand-soft);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: monospace;
}
.run-right { display: flex; align-items: center; gap: 10px; }
.run-dur { font-size: 12px; color: #999; font-family: monospace; }
.run-time { font-size: 11px; color: #bbb; }
.run-toggle { font-size: 10px; color: #ccc; }
.run-running-badge {
  font-size: 11px;
  color: var(--info);
  font-weight: 500;
  animation: pulse 1s infinite;
}
.btn-stop-sm {
  padding: 3px 10px;
  background: var(--error);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: opacity 0.15s;
}
.btn-stop-sm:hover { opacity: 0.85; }
.btn-view-stream {
  padding: 3px 10px;
  background: #667eea;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: opacity 0.15s;
}
.btn-view-stream:hover { opacity: 0.85; }
.run-detail {
  padding: 0 16px 16px;
  border-top: 1px solid var(--border-light);
}
.detail-case { margin-bottom: 10px; }

/* 历史记录结构化 blocks 渲染 */
.history-stream {
  max-height: 500px;
  overflow-y: auto;
  padding: 8px 12px;
  background: #fafbfc;
  border-radius: 6px;
  margin-top: 6px;
}
.detail-case-header {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-2);
  padding: 6px 0;
}
.case-title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.case-status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}
.dot-passed { background: var(--success); }
.dot-failed { background: var(--error); }
.dot-running { background: var(--info); }
.dot-error { background: var(--error); }
.dot-pending { background: var(--text-4); }
.dot-skipped { background: var(--text-4); }
.dot-interrupted { background: var(--warning); }
.case-dur { font-size: 11px; color: var(--text-3); font-family: var(--font-mono); }
.detail-output pre {
  background: var(--code-bg);
  color: var(--code-text);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 11px;
  font-family: monospace;
  overflow-x: auto;
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
}
.detail-error {
  color: var(--error);
  font-size: 12px;
  padding: 4px 8px;
  background: var(--error-bg);
  border-radius: 4px;
  margin-top: 4px;
}
.btn-del {
  background: none;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  color: #999;
  cursor: pointer;
  margin-top: 8px;
}
.btn-del:hover { color: var(--error); border-color: var(--error-border); }
.btn-report {
  background: none;
  border: 1px solid #667eea;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  color: #667eea;
  cursor: pointer;
}
.btn-report:hover { background: var(--brand-soft); }

/* API 发现信息 */
.api-discovery-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--brand-soft);
  border-radius: 6px;
  font-size: 12px;
  color: #667eea;
  width: 100%;
}
.discovery-info-text {
  font-weight: 500;
}
.module-select {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  width: 100%;
}
.module-check label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #555;
  cursor: pointer;
  background: var(--bg-surface-2);
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
}
.module-check input[type="checkbox"] {
  accent-color: #667eea;
}
.module-check-all {
  width: 100%;
}
.module-check-all label {
  background: var(--brand-soft);
  border-color: #c0c0e0;
  font-size: 12px;
  color: #667eea;
}
/* 风险等级圆点 */
.risk-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}
.risk-high { background: var(--error); box-shadow: 0 0 0 3px var(--error-bg); }
.risk-medium { background: var(--warning); box-shadow: 0 0 0 3px var(--warning-bg); }
.risk-low { background: var(--info); box-shadow: 0 0 0 3px var(--info-bg); }
.no-discovery-hint {
  font-size: 12px;
  color: var(--warning);
  background: var(--warning-bg);
  padding: 6px 10px;
  border-radius: 4px;
  width: 100%;
}

.report-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.report-path {
  font-size: 11px;
  color: #888;
  font-family: monospace;
  background: var(--bg-surface-2);
  padding: 2px 8px;
  border-radius: 4px;
  max-width: 500px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.e2e-summary {
  font-size: 12px;
  color: #555;
  background: #f9f9fb;
  padding: 4px 10px;
  border-radius: 4px;
  flex: 1;
}
.detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  align-items: center;
  flex-wrap: wrap;
}

/* 恢复按钮 */
.btn-resume {
  background: none;
  border: 1px solid var(--warning);
  border-radius: var(--radius-sm);
  padding: 4px 12px;
  font-size: 12px;
  color: var(--warning);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  transition: background var(--duration-fast) var(--ease);
}
.btn-resume:hover { background: var(--warning-bg); }
.btn-chat {
  background: none;
  border: 1px solid var(--brand);
  border-radius: var(--radius-sm);
  padding: 4px 12px;
  font-size: 12px;
  color: var(--brand);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  transition: background var(--duration-fast) var(--ease);
}
.btn-chat:hover { background: var(--brand-soft); }

/* 恢复模式标识 */
.resume-indicator { color: var(--warning) !important; }
.resume-indicator::before { background: var(--warning) !important; }

/* 聊天区域 */
.chat-area {
  border-top: 1px solid var(--border-light);
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
.chat-avatar {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  background: var(--bg-surface-2);
  color: var(--text-2);
}
.chat-avatar.brand { background: var(--brand-soft); color: var(--brand); }
.chat-user .chat-text {
  background: var(--brand-soft);
  padding: 6px 12px;
  border-radius: 8px;
  color: #333;
}
.chat-assistant .chat-text {
  background: var(--bg-surface-2);
  padding: 6px 12px;
  border-radius: 8px;
  flex: 1;
}
.chat-assistant .chat-text :deep(pre) {
  background: var(--code-bg);
  color: var(--code-text);
  padding: 8px 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 12px;
  margin: 4px 0;
}
.chat-assistant .chat-text :deep(code) {
  background: var(--bg-surface-2);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
.chat-assistant .chat-text :deep(pre code) {
  background: none;
  padding: 0;
}
.chat-input-row {
  display: flex;
  gap: 8px;
}
.chat-input-row input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.chat-input-row input:focus { border-color: #667eea; }
.chat-input-row button {
  padding: 8px 16px;
  background: #667eea;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: opacity 0.15s;
}
.chat-input-row button:disabled { opacity: 0.5; cursor: not-allowed; }
.chat-input-row button:hover:not(:disabled) { opacity: 0.85; }

/* 报告文件浏览器 */
.btn-scan {
  padding: 8px 18px;
  background: #722ed1;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.btn-scan:hover:not(:disabled) { background: #531dab; }
.btn-scan:disabled { opacity: 0.5; cursor: not-allowed; }

.report-files-modal { width: 640px; max-height: 80vh; }
.report-files-modal .modal-subtitle { font-size: 12px; color: var(--text-3); font-weight: 400; margin-left: 8px; }
.report-loading, .no-data { text-align: center; padding: 24px; color: var(--text-3); }

.report-files-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; border-bottom: 1px solid var(--border-light); margin-bottom: 8px;
}
.select-all-label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; }
.report-files-hint { padding: 10px 0; border-bottom: 1px solid var(--border-light); margin-bottom: 8px; }
.btn-build {
  padding: 5px 14px; background: #667eea; color: white; border: none; border-radius: 4px;
  cursor: pointer; font-size: 12px;
}
.btn-build:hover:not(:disabled) { background: #5a6fd6; }
.btn-build:disabled { opacity: 0.5; cursor: not-allowed; }

.report-files-list { max-height: 400px; overflow-y: auto; }
.report-file-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-bottom: 1px solid var(--bg-surface-2); font-size: 13px;
}
.report-file-item:hover { background: var(--bg-surface-2); }
.file-icon { font-size: 14px; flex-shrink: 0; }
.file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { color: var(--text-3); font-size: 11px; flex-shrink: 0; }
.btn-open-file {
  padding: 2px 10px; background: var(--info-bg); color: var(--info); border: 1px solid #91d5ff;
  border-radius: 3px; cursor: pointer; font-size: 11px; flex-shrink: 0;
}
.btn-open-file:hover { background: #bae7ff; }
</style>
