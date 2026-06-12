<template>
  <div class="memory-page" @click="openMenuId = null">
    <header class="page-header">
      <div>
        <h1>会话中心</h1>
        <p class="page-desc">聚合 Claude Code 与 Codex 对话，提炼洞察，生成 Skill 和提示词</p>
      </div>
      <div class="header-actions">
        <button class="btn-scan" :disabled="scanning" @click="doScan">
          {{ scanning ? '扫描中...' : '扫描对话' }}
        </button>
      </div>
    </header>

    <!-- 标签页 -->
    <div class="main-tabs">
      <button class="mtab" :class="{ active: mainTab === 'conversations' }" @click="mainTab = 'conversations'">
        对话 ({{ conversations.length }})
      </button>
      <button class="mtab" :class="{ active: mainTab === 'insights' }" @click="mainTab = 'insights'">
        洞察 ({{ insights.length }})
      </button>
      <button class="mtab" :class="{ active: mainTab === 'artifacts' }" @click="mainTab = 'artifacts'">
        制品 ({{ artifacts.length }})
      </button>
      <button class="mtab" :class="{ active: mainTab === 'skills' }" @click="mainTab = 'skills'">
        会话 Skills
      </button>
    </div>

    <!-- 对话列表 -->
    <div v-if="mainTab === 'conversations'">
      <!-- 筛选栏 -->
      <div class="filter-row">
        <input v-model="search" class="search-input" placeholder="搜索对话标题、项目..." />
        <div class="filter-group">
          <span class="filter-label">来源:</span>
          <button class="ftab" :class="{ active: sourceFilter === 'all' }" @click="sourceFilter = 'all'">全部</button>
          <button class="ftab" :class="{ active: sourceFilter === 'claude-code' }" @click="sourceFilter = 'claude-code'">Claude Code</button>
          <button class="ftab" :class="{ active: sourceFilter === 'codex' }" @click="sourceFilter = 'codex'">Codex</button>
        </div>
        <div class="filter-group">
          <span class="filter-label">时间:</span>
          <button class="ftab" :class="{ active: timeFilter === 'all' }" @click="timeFilter = 'all'; dateFrom=''; dateTo=''">全部</button>
          <button class="ftab" :class="{ active: timeFilter === 'today' }" @click="timeFilter = 'today'; dateFrom=''; dateTo=''">今日</button>
          <button class="ftab" :class="{ active: timeFilter === 'week' }" @click="timeFilter = 'week'; dateFrom=''; dateTo=''">本周</button>
          <button class="ftab" :class="{ active: timeFilter === 'month' }" @click="timeFilter = 'month'; dateFrom=''; dateTo=''">本月</button>
          <button class="ftab" :class="{ active: timeFilter === 'custom' }" @click="timeFilter = 'custom'">自定义</button>
          <template v-if="timeFilter === 'custom'">
            <input type="date" v-model="dateFrom" class="date-input" />
            <span class="date-sep">~</span>
            <input type="date" v-model="dateTo" class="date-input" />
          </template>
        </div>
        <div class="filter-group">
          <span class="filter-label">项目:</span>
          <button class="ftab" :class="{ active: projectFilter === 'all' }" @click="projectFilter = 'all'">全部</button>
          <button v-for="p in projectList" :key="p.path" class="ftab" :class="{ active: projectFilter === p.path }" @click="projectFilter = p.path">
            {{ p.name }}
          </button>
        </div>
      </div>

      <div class="list-summary">
        <span>共 {{ filteredConversations.length }} 条对话</span>
        <button v-if="!batchMode" class="btn-link" @click="batchMode = true">批量管理</button>
        <template v-else>
          <button class="btn-link" @click="selectAll">全选当前</button>
          <button class="btn-link" @click="clearSelection">清空选择</button>
          <button class="btn-link btn-link-done" @click="exitBatchMode">完成</button>
          <span v-if="selectedIds.size" class="selected-count">已选 {{ selectedIds.size }} 条</span>
        </template>
      </div>

      <div class="conv-grid">
        <div
          v-for="conv in filteredConversations"
          :key="conv.id"
          class="conv-card"
          :class="{ selected: batchMode && selectedIds.has(conv.id) }"
        >
          <div v-if="batchMode" class="conv-check" @click.stop="toggleSelect(conv.id)">
            <span class="checkbox" :class="{ checked: selectedIds.has(conv.id) }">{{ selectedIds.has(conv.id) ? '☑' : '☐' }}</span>
          </div>
          <div class="conv-body" @click="batchMode ? toggleSelect(conv.id) : openDetail(conv.id)">
            <div class="conv-top-row">
              <span class="source-badge" :class="conv.source">{{ conv.source === 'claude-code' ? 'Claude' : 'Codex' }}</span>
              <span class="conv-time">{{ formatTime(conv.startedAt) }}</span>
              <span v-if="conv.summary" class="summarized-badge">已总结</span>
            </div>
            <div class="conv-title">{{ conv.title }}</div>
            <div class="conv-bottom">
              <span class="conv-project">{{ shortProject(conv.projectPath || conv.projectSlug) }}</span>
              <span class="conv-stats">{{ conv.messageCount }} 条消息<span v-if="conv.toolCallCount"> &middot; {{ conv.toolCallCount }} 次工具</span></span>
            </div>
          </div>
          <div v-if="!batchMode" class="conv-more-wrap">
            <button class="btn-more" @click.stop="toggleMenu(conv.id)">&#8943;</button>
            <div v-if="openMenuId === conv.id" class="card-menu" @click.stop>
              <button class="menu-item danger" :disabled="deleting" @click="doDeleteSingle(conv.id)">
                {{ deleting ? '删除中...' : '彻底删除' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="filteredConversations.length === 0" class="no-result">
        {{ conversations.length === 0 ? '点击「扫描对话」导入历史记录' : '没有找到匹配的对话' }}
      </div>

      <!-- 浮动批量操作栏 -->
      <Transition name="float-bar">
        <div v-if="batchMode && selectedIds.size" class="float-bar">
          <span class="float-bar-text">已选择 {{ selectedIds.size }} 条对话</span>
          <div class="float-bar-actions">
            <button class="btn-float-cancel" @click="clearSelection">清空</button>
            <button class="btn-float-delete" :disabled="deleting" @click="doBatchDelete">
              {{ deleting ? '删除中...' : '彻底删除' }}
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 洞察列表 -->
    <div v-if="mainTab === 'insights'">
      <div class="filter-tabs" style="margin-bottom: 16px;">
        <button class="ftab" :class="{ active: insightFilter === 'all' }" @click="insightFilter = 'all'">全部</button>
        <button class="ftab" :class="{ active: insightFilter === 'preference' }" @click="insightFilter = 'preference'">偏好</button>
        <button class="ftab" :class="{ active: insightFilter === 'pattern' }" @click="insightFilter = 'pattern'">模式</button>
        <button class="ftab" :class="{ active: insightFilter === 'correction' }" @click="insightFilter = 'correction'">纠正</button>
        <button class="ftab" :class="{ active: insightFilter === 'knowledge' }" @click="insightFilter = 'knowledge'">知识</button>
        <button class="ftab" :class="{ active: insightFilter === 'skill-idea' }" @click="insightFilter = 'skill-idea'">Skill 想法</button>
      </div>
      <div class="insight-grid">
        <div v-for="ins in filteredInsights" :key="ins.id" class="insight-card">
          <div class="insight-top">
            <span class="insight-type-badge" :class="ins.type">{{ insightTypeLabel(ins.type) }}</span>
            <span class="insight-confidence">{{ Math.round(ins.confidence * 100) }}%</span>
          </div>
          <div class="insight-content">{{ ins.content }}</div>
          <div class="insight-meta">{{ formatTime(ins.generatedAt) }}</div>
        </div>
      </div>
      <div v-if="filteredInsights.length === 0" class="no-result">暂无洞察，请在对话详情中提取</div>
    </div>

    <!-- 制品列表 -->
    <div v-if="mainTab === 'artifacts'">
      <div class="artifact-grid">
        <div v-for="art in artifacts" :key="art.id" class="artifact-card">
          <div class="artifact-top">
            <span class="artifact-type-badge" :class="art.type">{{ artifactTypeLabel(art.type) }}</span>
            <span v-if="art.applied" class="applied-badge">已应用</span>
          </div>
          <div class="artifact-title">{{ art.title }}</div>
          <div class="artifact-actions">
            <button class="btn-sm" @click="previewArtifact(art)">预览</button>
            <button v-if="!art.applied" class="btn-sm btn-apply" @click="doApplyArtifact(art.id)">应用</button>
          </div>
        </div>
      </div>
      <div v-if="artifacts.length === 0" class="no-result">暂无制品，请在对话详情中生成</div>
    </div>

    <!-- 会话 Skills -->
    <div v-if="mainTab === 'skills'">
      <p class="skills-desc">点击 Skill 卡片查看提示词，复制后粘贴到 Claude Code 或 Codex 窗口即可执行。</p>
      <div class="skill-grid">
        <div v-for="sk in conversationSkills" :key="sk.id" class="skill-action-card">
          <div class="sk-top">
            <span class="sk-icon">{{ sk.icon }}</span>
            <span class="sk-name">{{ sk.name }}</span>
          </div>
          <div class="sk-desc">{{ sk.description }}</div>
          <div class="sk-tags">
            <span v-for="tag in sk.tags" :key="tag" class="tag">{{ tag }}</span>
          </div>
          <button class="btn-copy-prompt" @click="openSkillPrompt(sk)">查看提示词</button>
        </div>
      </div>
    </div>

    <!-- 对话详情浮层 -->
    <div v-if="detailOpen" class="detail-overlay" @click.self="detailOpen = false">
      <div class="detail-card">
        <div class="detail-header">
          <div>
            <span class="source-badge" :class="detailData?.source">{{ detailData?.source === 'claude-code' ? 'Claude Code' : 'Codex' }}</span>
            <h2>{{ detailData?.title }}</h2>
            <div class="detail-meta">
              {{ detailData?.model }} &middot; {{ detailData?.messageCount }} 条消息 &middot; {{ formatTime(detailData?.startedAt) }}
            </div>
          </div>
          <button class="close-btn" @click="detailOpen = false">&#10005;</button>
        </div>
        <div class="detail-tabs">
          <button class="dtab" :class="{ active: detailTab === 'messages' }" @click="detailTab = 'messages'">对话</button>
          <button class="dtab" :class="{ active: detailTab === 'summary' }" @click="detailTab = 'summary'">总结</button>
          <button class="dtab" :class="{ active: detailTab === 'insights' }" @click="detailTab = 'insights'">洞察</button>
          <button class="dtab" :class="{ active: detailTab === 'generate' }" @click="detailTab = 'generate'">生成</button>
        </div>
        <div v-if="detailTab === 'messages'" class="message-timeline">
          <div v-for="(msg, idx) in detailData?.messages" :key="idx" class="msg-bubble" :class="msg.role">
            <div class="msg-role">{{ msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : '系统' }}</div>
            <div class="msg-content" :class="{ 'tool-call': msg.contentType === 'tool_use' }">
              <template v-if="msg.contentType === 'tool_use'">
                <span class="tool-icon">&#128295;</span> {{ msg.toolName || 'Tool' }}
              </template>
              <template v-else>{{ msg.content.slice(0, 500) }}{{ msg.content.length > 500 ? '...' : '' }}</template>
            </div>
          </div>
          <div v-if="!detailData?.messages?.length" class="no-result">无消息记录</div>
        </div>
        <div v-if="detailTab === 'summary'" class="summary-panel">
          <div v-if="detailData?.summary" class="summary-text">{{ detailData.summary }}</div>
          <div v-else class="no-result">暂无总结</div>
          <button class="btn-action" :disabled="analyzing" @click="doSummarize">
            {{ analyzing ? '生成中...' : (detailData?.summary ? '重新生成总结' : '生成总结') }}
          </button>
        </div>
        <div v-if="detailTab === 'insights'" class="insights-panel">
          <div v-if="detailInsights.length" class="insight-list">
            <div v-for="ins in detailInsights" :key="ins.id" class="insight-item">
              <span class="insight-type-badge" :class="ins.type">{{ insightTypeLabel(ins.type) }}</span>
              <span class="insight-text">{{ ins.content }}</span>
            </div>
          </div>
          <div v-else class="no-result">暂无洞察</div>
          <button class="btn-action" :disabled="analyzing" @click="doExtractInsights">
            {{ analyzing ? '提取中...' : '提取洞察' }}
          </button>
        </div>
        <div v-if="detailTab === 'generate'" class="generate-panel">
          <p class="gen-desc">从本对话生成可复用的 Skill、提示词或记忆条目</p>
          <div class="gen-buttons">
            <button class="btn-gen" :disabled="analyzing" @click="doGenerate('skill')">生成 Skill</button>
            <button class="btn-gen" :disabled="analyzing" @click="doGenerate('prompt')">生成提示词</button>
            <button class="btn-gen" :disabled="analyzing" @click="doGenerate('memory-note')">生成记忆</button>
          </div>
          <div v-if="genResult" class="gen-result">
            <div class="gen-result-header">
              <span>生成结果</span>
              <button class="btn-sm" @click="copyGenResult">复制</button>
            </div>
            <pre class="gen-result-content">{{ genResult.content }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- 制品预览浮层 -->
    <div v-if="previewOpen" class="detail-overlay" @click.self="previewOpen = false">
      <div class="detail-card">
        <div class="detail-header">
          <h2>{{ previewData?.title }}</h2>
          <button class="close-btn" @click="previewOpen = false">&#10005;</button>
        </div>
        <pre class="preview-content">{{ previewData?.content }}</pre>
      </div>
    </div>

    <!-- Skill 提示词浮层 -->
    <div v-if="skillPromptOpen" class="detail-overlay" @click.self="skillPromptOpen = false">
      <div class="detail-card">
        <div class="detail-header">
          <div>
            <h2>{{ activeSkillPrompt?.name }}</h2>
            <p class="detail-meta">{{ activeSkillPrompt?.description }}</p>
          </div>
          <button class="close-btn" @click="skillPromptOpen = false">&#10005;</button>
        </div>
        <div class="prompt-params" v-if="activeSkillPrompt?.params?.length">
          <div v-for="p in activeSkillPrompt.params" :key="p.key" class="param-row">
            <label>{{ p.label }}</label>
            <select v-if="p.type === 'select'" v-model="promptParams[p.key]" class="param-input">
              <option v-for="opt in p.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
            <input v-else v-model="promptParams[p.key]" class="param-input" :placeholder="p.placeholder || ''" />
          </div>
        </div>
        <textarea class="prompt-textarea" readonly :value="renderedSkillPrompt" @click="($event.target as HTMLTextAreaElement).select()"></textarea>
        <div class="prompt-actions">
          <button class="btn-action" @click="copySkillPrompt">{{ skillPromptCopied ? '已复制!' : '复制提示词' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  listConversations,
  getConversation,
  scanConversations,
  summarizeConversation,
  extractInsights,
  generateArtifact,
  listInsights,
  listArtifacts,
  applyArtifact,
  deleteConversations,
} from '../api/memory'
import type { ConversationSummary, ConversationDetail, MemoryInsight, GeneratedArtifact } from '../api/types'

const conversations = ref<ConversationSummary[]>([])
const insights = ref<MemoryInsight[]>([])
const artifacts = ref<GeneratedArtifact[]>([])
const search = ref('')
const sourceFilter = ref<'all' | 'claude-code' | 'codex'>('all')
const timeFilter = ref<'all' | 'today' | 'week' | 'month' | 'custom'>('all')
const dateFrom = ref('')
const dateTo = ref('')
const projectFilter = ref('all')
const insightFilter = ref<'all' | 'preference' | 'pattern' | 'correction' | 'knowledge' | 'skill-idea'>('all')
const mainTab = ref<'conversations' | 'insights' | 'artifacts' | 'skills'>('conversations')
const scanning = ref(false)
const analyzing = ref(false)
const deleting = ref(false)
const openMenuId = ref<string | null>(null)
const batchMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

// 详情相关
const detailOpen = ref(false)
const detailTab = ref<'messages' | 'summary' | 'insights' | 'generate'>('messages')
const detailData = ref<ConversationDetail | null>(null)
const detailInsights = ref<MemoryInsight[]>([])
const genResult = ref<GeneratedArtifact | null>(null)

// 会话 Skills
interface ConversationSkill {
  id: string
  name: string
  icon: string
  description: string
  tags: string[]
  params?: { key: string; label: string; type?: string; placeholder?: string; options?: string[] }[]
  promptTemplate: string
}

const skillPromptOpen = ref(false)
const activeSkillPrompt = ref<ConversationSkill | null>(null)
const promptParams = ref<Record<string, string>>({})
const skillPromptCopied = ref(false)

const aiPlatformRoot = 'C:/FengSuKeJi/ai-platform'

const conversationSkills: ConversationSkill[] = [
  {
    id: 'filter-valuable',
    name: '筛选有价值会话',
    icon: '🔍',
    description: '从会话历史中筛选出有价值的对话，标注价值等级，生成筛选报告',
    tags: ['筛选', '分析'],
    promptTemplate: `请执行"筛选有价值会话"Skill。

读取会话索引文件: ${aiPlatformRoot}/server/data/memory/index.json
读取 Skill 文件: ${aiPlatformRoot}/skills/conversations/filter-valuable/SKILL.md

按照 Skill 中的步骤，分析每条会话的价值等级，将筛选报告写入 ${aiPlatformRoot}/doc/conversation-filter-report.md`,
  },
  {
    id: 'summarize-single',
    name: '单会话总结',
    icon: '📋',
    description: '对单个会话进行深度总结，提取关键决策、知识要点、用户偏好',
    tags: ['总结', '知识提取'],
    params: [
      { key: 'convId', label: '会话 ID', placeholder: '粘贴会话 ID，如 claude-code:xxx 或 codex:yyy' },
    ],
    promptTemplate: `请执行"单会话深度总结"Skill。

目标会话 ID: {{convId}}

读取 Skill 文件: ${aiPlatformRoot}/skills/conversations/summarize-single/SKILL.md
读取会话详情: ${aiPlatformRoot}/server/data/memory/conversations/ 文件夹中找到对应文件

按照 Skill 中的总结结构，将结果写入 ${aiPlatformRoot}/doc/conversation-summary-{shortId}.md`,
  },
  {
    id: 'summarize-batch',
    name: '群体会话总结',
    icon: '📊',
    description: '批量总结多个会话，提炼跨会话的共性模式、偏好规律、知识体系',
    tags: ['总结', '群体分析', '画像'],
    params: [
      { key: 'scope', label: '分析范围', type: 'select', options: ['全部会话', '仅 Claude Code', '仅 Codex'] },
    ],
    promptTemplate: `请执行"群体会话总结"Skill。

分析范围: {{scope}}

读取 Skill 文件: ${aiPlatformRoot}/skills/conversations/summarize-batch/SKILL.md
会话索引: ${aiPlatformRoot}/server/data/memory/index.json
会话详情: ${aiPlatformRoot}/server/data/memory/conversations/

按照 Skill 中的输出结构，将群体分析报告写入 ${aiPlatformRoot}/doc/conversation-batch-summary.md`,
  },
  {
    id: 'fridge-glossary',
    name: '冰箱 — 高频术语表',
    icon: '🧊',
    description: '从会话中提取高频术语、缩写、内部黑话，建立个人术语表，不用每次重复解释',
    tags: ['术语', '高频词', '冰箱'],
    promptTemplate: `请执行"冰箱 — 高频术语表"Skill。

读取 Skill 文件: ${aiPlatformRoot}/skills/conversations/fridge-glossary/SKILL.md
会话索引: ${aiPlatformRoot}/server/data/memory/index.json
会话详情: ${aiPlatformRoot}/server/data/memory/conversations/

按照 Skill 中的格式，将术语表写入 ${aiPlatformRoot}/doc/fridge-glossary.md

完成后，建议在 CLAUDE.md 中添加引用：
* 高频术语表见 /doc/fridge-glossary.md，对话开始时参考`,
  },
  {
    id: 'pattern-analysis',
    name: '会话模式分析',
    icon: '📈',
    description: '分析用户的工作模式、常见任务流程、效率瓶颈，生成优化建议',
    tags: ['分析', '模式', '优化'],
    promptTemplate: `请执行"会话模式分析"Skill。

读取 Skill 文件: ${aiPlatformRoot}/skills/conversations/pattern-analysis/SKILL.md
会话索引: ${aiPlatformRoot}/server/data/memory/index.json
会话详情: ${aiPlatformRoot}/server/data/memory/conversations/

按照 Skill 中的分析维度和输出格式，将分析报告写入 ${aiPlatformRoot}/doc/conversation-pattern-analysis.md`,
  },
]

const renderedSkillPrompt = computed(() => {
  if (!activeSkillPrompt.value) return ''
  let prompt = activeSkillPrompt.value.promptTemplate
  for (const [key, val] of Object.entries(promptParams.value)) {
    prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val || `{${key}}`)
  }
  return prompt
})

function openSkillPrompt(skill: ConversationSkill) {
  activeSkillPrompt.value = skill
  promptParams.value = {}
  if (skill.params) {
    for (const p of skill.params) {
      promptParams.value[p.key] = p.type === 'select' ? (p.options?.[0] || '') : ''
    }
  }
  skillPromptCopied.value = false
  skillPromptOpen.value = true
}

async function copySkillPrompt() {
  try {
    await navigator.clipboard.writeText(renderedSkillPrompt.value)
    skillPromptCopied.value = true
    setTimeout(() => { skillPromptCopied.value = false }, 2000)
  } catch { /* ignore */ }
}

// ========== 删除 ==========

function shortProject(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}

function toggleSelect(id: string) {
  const newSet = new Set(selectedIds.value)
  if (newSet.has(id)) newSet.delete(id)
  else newSet.add(id)
  selectedIds.value = newSet
}

function selectAll() {
  const newSet = new Set(selectedIds.value)
  for (const c of filteredConversations.value) newSet.add(c.id)
  selectedIds.value = newSet
}

function clearSelection() {
  selectedIds.value = new Set()
}

function exitBatchMode() {
  batchMode.value = false
  selectedIds.value = new Set()
}

async function doDeleteSingle(id: string) {
  openMenuId.value = null
  if (!confirm('确认彻底删除此会话？原始文件将被删除，不可恢复。')) return
  deleting.value = true
  try {
    await deleteConversations([id])
    await loadData()
  } catch (err: any) {
    alert('删除失败：' + err.message)
  } finally {
    deleting.value = false
  }
}

async function doBatchDelete() {
  const ids = Array.from(selectedIds.value)
  if (!ids.length) return
  if (!confirm(`确认彻底删除 ${ids.length} 条会话？原始文件将被删除，不可恢复。`)) return
  deleting.value = true
  try {
    await deleteConversations(ids)
    selectedIds.value = new Set()
    batchMode.value = false
    await loadData()
  } catch (err: any) {
    alert('删除失败：' + err.message)
  } finally {
    deleting.value = false
  }
}

// 预览相关
const previewOpen = ref(false)
const previewData = ref<GeneratedArtifact | null>(null)

// 项目列表
const projectList = computed(() => {
  const map = new Map<string, { name: string; path: string }>()
  for (const c of conversations.value) {
    const p = c.projectPath || c.projectSlug
    if (!map.has(p)) {
      const parts = p.replace(/\\/g, '/').split('/')
      const name = parts[parts.length - 1] || p
      map.set(p, { name, path: p })
    }
  }
  return Array.from(map.values())
})

const filteredConversations = computed(() => {
  let list = conversations.value
  if (sourceFilter.value !== 'all') list = list.filter(c => c.source === sourceFilter.value)
  if (projectFilter.value !== 'all') {
    list = list.filter(c => (c.projectPath || c.projectSlug) === projectFilter.value)
  }
  if (timeFilter.value !== 'all') {
    const now = new Date()
    let cutoff: Date | null = null
    let endDate: Date | null = null
    if (timeFilter.value === 'today') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    } else if (timeFilter.value === 'week') {
      cutoff = new Date(now)
      cutoff.setDate(cutoff.getDate() - 7)
    } else if (timeFilter.value === 'month') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1)
    } else if (timeFilter.value === 'custom') {
      if (dateFrom.value) cutoff = new Date(dateFrom.value)
      if (dateTo.value) {
        endDate = new Date(dateTo.value)
        endDate.setHours(23, 59, 59, 999)
      }
    }
    if (cutoff || endDate) {
      list = list.filter(c => {
        const d = new Date(c.startedAt || c.lastActivityAt || c.importedAt)
        if (cutoff && d < cutoff) return false
        if (endDate && d > endDate) return false
        return true
      })
    }
  }
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.projectPath.toLowerCase().includes(q) ||
      c.model.toLowerCase().includes(q)
    )
  }
  return list
})

const filteredInsights = computed(() => {
  if (insightFilter.value === 'all') return insights.value
  return insights.value.filter(i => i.type === insightFilter.value)
})

onMounted(async () => {
  await Promise.all([loadData(), loadInsightsData(), loadArtifactsData()])
})

async function loadData() {
  try { conversations.value = await listConversations() } catch { /* ignore */ }
}

async function loadInsightsData() {
  try { insights.value = await listInsights() } catch { /* ignore */ }
}

async function loadArtifactsData() {
  try { artifacts.value = await listArtifacts() } catch { /* ignore */ }
}

async function doScan() {
  scanning.value = true
  try {
    const result = await scanConversations()
    await loadData()
    alert(`扫描完成：共 ${result.scanned} 个对话，新增 ${result.newCount} 个`)
  } catch (err: any) {
    alert('扫描失败：' + err.message)
  } finally {
    scanning.value = false
  }
}

async function openDetail(id: string) {
  detailTab.value = 'messages'
  detailInsights.value = []
  genResult.value = null
  try {
    detailData.value = await getConversation(id)
    detailOpen.value = true
  } catch (err: any) {
    alert('加载失败：' + err.message)
  }
}

async function doSummarize() {
  if (!detailData.value) return
  analyzing.value = true
  try {
    const result = await summarizeConversation(detailData.value.id)
    if (detailData.value) detailData.value.summary = result.summary
  } catch (err: any) {
    alert('生成失败：' + err.message)
  } finally {
    analyzing.value = false
  }
}

async function doExtractInsights() {
  if (!detailData.value) return
  analyzing.value = true
  try {
    detailInsights.value = await extractInsights(detailData.value.id)
    await loadInsightsData()
  } catch (err: any) {
    alert('提取失败：' + err.message)
  } finally {
    analyzing.value = false
  }
}

async function doGenerate(type: 'skill' | 'prompt' | 'memory-note') {
  if (!detailData.value) return
  analyzing.value = true
  try {
    genResult.value = await generateArtifact(detailData.value.id, type)
    await loadArtifactsData()
  } catch (err: any) {
    alert('生成失败：' + err.message)
  } finally {
    analyzing.value = false
  }
}

function copyGenResult() {
  if (genResult.value?.content) {
    navigator.clipboard.writeText(genResult.value.content)
  }
}

async function previewArtifact(art: GeneratedArtifact) {
  previewData.value = art
  previewOpen.value = true
}

async function doApplyArtifact(id: string) {
  try {
    await applyArtifact(id)
    await loadArtifactsData()
    alert('应用成功！')
  } catch (err: any) {
    alert('应用失败：' + err.message)
  }
}

function formatTime(ts?: string): string {
  if (!ts) return '-'
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ts.slice(0, 10)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return ts.slice(0, 10) }
}

function insightTypeLabel(type: MemoryInsight['type']) {
  const labels: Record<string, string> = {
    preference: '偏好',
    pattern: '模式',
    correction: '纠正',
    knowledge: '知识',
    'skill-idea': 'Skill',
  }
  return labels[type] || type
}

function artifactTypeLabel(type: GeneratedArtifact['type']) {
  const labels: Record<string, string> = { skill: 'Skill', prompt: '提示词', 'memory-note': '记忆' }
  return labels[type] || type
}
</script>

<style scoped>
.memory-page {
  padding: 28px 32px;
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.page-header h1 { font-size: 22px; font-weight: 700; color: #1a1a2e; }
.page-desc { font-size: 13px; color: #999; margin-top: 4px; }
.btn-scan {
  padding: 8px 20px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}
.btn-scan:hover { opacity: 0.9; }
.btn-scan:disabled { opacity: 0.5; cursor: not-allowed; }

/* 主标签 */
.main-tabs { display: flex; gap: 4px; margin-bottom: 20px; }
.mtab {
  padding: 8px 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  color: #666;
  transition: all 0.15s;
}
.mtab.active { background: #667eea; color: #fff; border-color: #667eea; }

/* 筛选栏 */
.filter-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding: 12px 16px;
  background: #f9f9fb;
  border-radius: 10px;
}
.search-input {
  padding: 7px 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  width: 220px;
}
.search-input:focus { border-color: #667eea; }
.filter-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.filter-label {
  font-size: 12px;
  color: #999;
  margin-right: 4px;
  white-space: nowrap;
}
.date-input {
  padding: 5px 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 12px;
  outline: none;
}
.date-input:focus { border-color: #667eea; }
.date-sep { color: #999; font-size: 13px; }
.ftab {
  padding: 5px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  color: #666;
  transition: all 0.15s;
}
.ftab.active { background: #667eea; color: #fff; border-color: #667eea; }

/* 列表摘要 */
.list-summary {
  font-size: 13px;
  color: #888;
  margin-bottom: 8px;
  padding-left: 2px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.btn-link {
  background: none;
  border: none;
  color: #667eea;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.btn-link:hover { text-decoration: underline; }
.btn-link-done { color: #999; }
.selected-count { color: #667eea; font-weight: 500; }

/* 对话卡片 */
.conv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;
}
.conv-card {
  background: #fff;
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: all 0.15s;
  border: 2px solid transparent;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.conv-card:hover {
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.12);
}
.conv-card.selected {
  border-color: #667eea;
  background: #f5f5ff;
}
.conv-check {
  flex-shrink: 0;
  padding-top: 4px;
}
.checkbox {
  font-size: 18px;
  cursor: pointer;
  color: #ccc;
  user-select: none;
}
.checkbox.checked { color: #667eea; }
.conv-body {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.conv-top-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.source-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.source-badge.claude-code { background: #eef0ff; color: #667eea; }
.source-badge.codex { background: #ecfdf3; color: #087443; }
.conv-time { font-size: 11px; color: #bbb; }
.summarized-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f0fff4;
  color: #52c41a;
}
.conv-title {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 6px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.conv-project {
  font-size: 11px;
  color: #bbb;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-stats {
  font-size: 11px;
  color: #999;
  white-space: nowrap;
  flex-shrink: 0;
}
.no-result {
  text-align: center;
  color: #bbb;
  padding: 40px;
  font-size: 14px;
}

/* 更多操作按钮 */
.conv-more-wrap {
  position: relative;
  flex-shrink: 0;
}
.btn-more {
  background: none;
  border: none;
  font-size: 20px;
  color: #ccc;
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
  border-radius: 4px;
  transition: all 0.15s;
}
.btn-more:hover {
  color: #666;
  background: #f0f0f0;
}
.card-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  min-width: 120px;
  z-index: 50;
  overflow: hidden;
}
.menu-item {
  display: block;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: none;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  color: #333;
}
.menu-item:hover { background: #f5f5f7; }
.menu-item.danger { color: #ff4d4f; }
.menu-item.danger:hover { background: #fff2f0; }
.menu-item:disabled { opacity: 0.5; cursor: not-allowed; }

/* 浮动批量操作栏 */
.float-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #1a1a2e;
  color: #fff;
  padding: 12px 24px;
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.25);
  display: flex;
  align-items: center;
  gap: 16px;
  z-index: 200;
}
.float-bar-text { font-size: 14px; font-weight: 500; }
.float-bar-actions { display: flex; gap: 8px; }
.btn-float-cancel {
  padding: 6px 16px;
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 8px;
  background: transparent;
  color: rgba(255,255,255,0.7);
  cursor: pointer;
  font-size: 13px;
}
.btn-float-cancel:hover { border-color: rgba(255,255,255,0.6); color: #fff; }
.btn-float-delete {
  padding: 6px 20px;
  border: none;
  border-radius: 8px;
  background: #ff4d4f;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.btn-float-delete:hover { background: #ff7875; }
.btn-float-delete:disabled { opacity: 0.5; cursor: not-allowed; }
.float-bar-enter-active,
.float-bar-leave-active { transition: all 0.25s ease; }
.float-bar-enter-from,
.float-bar-leave-to { opacity: 0; transform: translateX(-50%) translateY(20px); }

/* 洞察网格 */
.insight-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.insight-card {
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.insight-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.insight-type-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.insight-type-badge.preference { background: #eef0ff; color: #667eea; }
.insight-type-badge.pattern { background: #e6f7ff; color: #1890ff; }
.insight-type-badge.correction { background: #fff2f0; color: #ff4d4f; }
.insight-type-badge.knowledge { background: #f0fff4; color: #52c41a; }
.insight-type-badge.skill-idea { background: #fff7e6; color: #fa8c16; }
.insight-confidence { font-size: 11px; color: #999; }
.insight-content { font-size: 13px; color: #555; line-height: 1.5; }
.insight-meta { font-size: 11px; color: #bbb; margin-top: 6px; }

/* 制品网格 */
.artifact-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.artifact-card {
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.artifact-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.artifact-type-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.artifact-type-badge.skill { background: #fff7e6; color: #fa8c16; }
.artifact-type-badge.prompt { background: #f9f0ff; color: #722ed1; }
.artifact-type-badge.memory-note { background: #eef0ff; color: #667eea; }
.applied-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f0fff4;
  color: #52c41a;
}
.artifact-title { font-size: 14px; font-weight: 600; color: #1a1a2e; margin-bottom: 8px; }
.artifact-actions { display: flex; gap: 8px; }
.btn-sm {
  padding: 4px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  color: #666;
}
.btn-sm:hover { border-color: #667eea; color: #667eea; }
.btn-apply { background: #667eea; color: #fff; border-color: #667eea; }
.btn-apply:hover { opacity: 0.9; }

/* 详情浮层 */
.detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.detail-card {
  background: #fff;
  border-radius: 14px;
  padding: 24px;
  width: 700px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}
.detail-header h2 { font-size: 18px; font-weight: 700; color: #1a1a2e; margin-top: 4px; }
.detail-meta { font-size: 12px; color: #999; margin-top: 4px; }
.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: #999;
  cursor: pointer;
  padding: 4px;
}
.close-btn:hover { color: #333; }

.detail-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
.dtab {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  color: #666;
}
.dtab.active { background: #667eea; color: #fff; }

/* 消息时间线 */
.message-timeline { display: flex; flex-direction: column; gap: 10px; }
.msg-bubble {
  max-width: 90%;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
}
.msg-bubble.user { align-self: flex-end; background: #667eea; color: #fff; }
.msg-bubble.assistant { align-self: flex-start; background: #f5f5f7; color: #333; }
.msg-bubble.system { align-self: center; background: #fff7e6; color: #fa8c16; font-size: 12px; }
.msg-role { font-size: 11px; opacity: 0.7; margin-bottom: 4px; }
.msg-content.tool-call { font-family: monospace; font-size: 12px; color: #722ed1; background: #f9f0ff; }
.tool-icon { margin-right: 4px; }

/* 总结面板 */
.summary-panel { text-align: center; }
.summary-text {
  font-size: 14px;
  color: #555;
  line-height: 1.8;
  padding: 20px;
  background: #f9f9fb;
  border-radius: 10px;
  margin-bottom: 16px;
  text-align: left;
}

.insight-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.insight-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background: #f9f9fb;
  border-radius: 8px;
}
.insight-text { font-size: 13px; color: #555; line-height: 1.5; }

.gen-desc { font-size: 13px; color: #999; margin-bottom: 12px; }
.gen-buttons { display: flex; gap: 10px; margin-bottom: 16px; }
.btn-gen {
  padding: 8px 18px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  color: #666;
  transition: all 0.15s;
}
.btn-gen:hover { border-color: #667eea; color: #667eea; }
.btn-gen:disabled { opacity: 0.5; cursor: not-allowed; }
.gen-result { border: 1px solid #eee; border-radius: 10px; overflow: hidden; }
.gen-result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  background: #f5f5f7;
  font-size: 13px;
  font-weight: 600;
  color: #555;
}
.gen-result-content {
  padding: 14px;
  font-size: 12px;
  line-height: 1.6;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.btn-action {
  padding: 8px 24px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}
.btn-action:hover { opacity: 0.9; }
.btn-action:disabled { opacity: 0.5; cursor: not-allowed; }

.preview-content {
  padding: 16px;
  font-size: 12px;
  line-height: 1.6;
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  background: #f9f9fb;
  border-radius: 8px;
}

/* 会话 Skills */
.skills-desc { font-size: 13px; color: #999; margin-bottom: 16px; }
.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.skill-action-card {
  background: #fff;
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  border: 2px solid transparent;
  transition: all 0.15s;
}
.skill-action-card:hover { border-color: #667eea; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.12); }
.sk-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sk-icon { font-size: 20px; }
.sk-name { font-size: 14px; font-weight: 600; color: #1a1a2e; }
.sk-desc { font-size: 13px; color: #888; line-height: 1.5; margin-bottom: 10px; }
.sk-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 12px; }
.btn-copy-prompt {
  width: 100%;
  padding: 8px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.btn-copy-prompt:hover { opacity: 0.9; }

/* 提示词浮层 */
.prompt-params { margin-bottom: 16px; }
.param-row { margin-bottom: 10px; }
.param-row label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; }
.param-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.param-input:focus { border-color: #667eea; }
.prompt-textarea {
  width: 100%;
  height: 300px;
  padding: 14px;
  font-size: 12px;
  line-height: 1.6;
  font-family: monospace;
  border: 1px solid #eee;
  border-radius: 8px;
  background: #f9f9fb;
  resize: none;
  outline: none;
  box-sizing: border-box;
}
.prompt-actions { margin-top: 12px; text-align: right; }
</style>
