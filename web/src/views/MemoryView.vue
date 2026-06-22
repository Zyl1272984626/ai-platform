<template>
  <div class="memory-workbench" @click="openMenuId = null">
    <header class="memory-header">
      <div>
        <p class="eyebrow">Memory Hub</p>
        <h1>会话冷库工作台</h1>
        <p class="page-desc">采集 Claude Code、Codex、ZCode 会话，沉淀术语、偏好、流程和项目经验，让根 AI 下次少猜一点。</p>
      </div>
      <div class="header-actions">
        <button class="btn-secondary" @click="mainTab = 'lab'">召回实验</button>
        <button class="btn-primary" :disabled="scanning" @click="doScan">
          {{ scanning ? '扫描中...' : '扫描会话' }}
        </button>
      </div>
    </header>

    <section class="signal-grid">
      <div class="signal-card">
        <span class="signal-label">会话原料</span>
        <strong>{{ conversations.length }}</strong>
        <small>Claude / Codex / ZCode</small>
      </div>
      <div class="signal-card">
        <span class="signal-label">已摘要</span>
        <strong>{{ summarizedCount }}</strong>
        <small>{{ percent(summarizedCount, conversations.length) }} 覆盖</small>
      </div>
      <div class="signal-card">
        <span class="signal-label">洞察</span>
        <strong>{{ insights.length }}</strong>
        <small>偏好、模式、纠偏、知识</small>
      </div>
      <div class="signal-card">
        <span class="signal-label">冷库候选</span>
        <strong>{{ coldItems.length }}</strong>
        <small>可直接复制注入</small>
      </div>
    </section>

    <nav class="main-tabs">
      <button class="mtab" :class="{ active: mainTab === 'overview' }" @click="mainTab = 'overview'">总览</button>
      <button class="mtab" :class="{ active: mainTab === 'conversations' }" @click="mainTab = 'conversations'">会话</button>
      <button class="mtab" :class="{ active: mainTab === 'cold' }" @click="mainTab = 'cold'">冷库</button>
      <button class="mtab" :class="{ active: mainTab === 'lab' }" @click="mainTab = 'lab'">召回实验</button>
      <button class="mtab" :class="{ active: mainTab === 'insights' }" @click="mainTab = 'insights'">洞察</button>
      <button class="mtab" :class="{ active: mainTab === 'artifacts' }" @click="mainTab = 'artifacts'">制品</button>
      <button class="mtab" :class="{ active: mainTab === 'actions' }" @click="mainTab = 'actions'">行动台</button>
    </nav>

    <section v-if="mainTab === 'overview'" class="overview-grid">
      <div class="panel wide">
        <div class="panel-head">
          <div>
            <h2>来源热力</h2>
            <p>zcode 已作为第三个本地会话来源接入，扫描路径为用户目录下的 `.zcode/cli/rollout`。</p>
          </div>
        </div>
        <div class="source-bars">
          <div v-for="src in sourceStats" :key="src.id" class="source-row">
            <div class="source-name">
              <span class="source-dot" :class="src.id"></span>
              <span>{{ src.label }}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" :class="src.id" :style="{ width: src.percent + '%' }"></div>
            </div>
            <strong>{{ src.count }}</strong>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>下一步优先级</h2>
        <div class="priority-list">
          <div v-for="item in priorities" :key="item.title" class="priority-item">
            <span class="priority-rank">{{ item.rank }}</span>
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.desc }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>项目分布</h2>
        <div class="project-list">
          <button
            v-for="p in projectStats"
            :key="p.path"
            class="project-chip"
            :class="{ active: projectFilter === p.path }"
            @click="projectFilter = projectFilter === p.path ? 'all' : p.path; mainTab = 'conversations'"
          >
            <span>{{ p.name }}</span>
            <b>{{ p.count }}</b>
          </button>
        </div>
      </div>
    </section>

    <section v-if="mainTab === 'conversations'" class="workspace-section">
      <div class="filter-row">
        <input v-model="search" class="search-input" placeholder="搜索标题、项目、模型、内容摘要" />
        <div class="segmented">
          <button v-for="src in sourceOptions" :key="src.id" :class="{ active: sourceFilter === src.id }" @click="sourceFilter = src.id">
            {{ src.label }}
          </button>
        </div>
        <div class="segmented">
          <button v-for="tf in timeOptions" :key="tf.id" :class="{ active: timeFilter === tf.id }" @click="setTimeFilter(tf.id)">
            {{ tf.label }}
          </button>
        </div>
      </div>

      <div class="list-summary">
        <span>当前筛选 {{ filteredConversations.length }} 条</span>
        <button v-if="!batchMode" class="btn-link" @click="batchMode = true">批量管理</button>
        <template v-else>
          <button class="btn-link" @click="selectAll">全选当前</button>
          <button class="btn-link" @click="clearSelection">清空</button>
          <button class="btn-link" @click="exitBatchMode">完成</button>
          <span v-if="selectedIds.size" class="selected-count">已选 {{ selectedIds.size }} 条</span>
        </template>
      </div>

      <div class="conv-grid">
        <article
          v-for="conv in filteredConversations"
          :key="conv.id"
          class="conv-card"
          :class="{ selected: batchMode && selectedIds.has(conv.id) }"
        >
          <button v-if="batchMode" class="check-btn" :class="{ checked: selectedIds.has(conv.id) }" @click.stop="toggleSelect(conv.id)">
            {{ selectedIds.has(conv.id) ? '✓' : '' }}
          </button>
          <div class="conv-body" @click="batchMode ? toggleSelect(conv.id) : openDetail(conv.id)">
            <div class="conv-top-row">
              <span class="source-badge" :class="conv.source">{{ sourceLabel(conv.source) }}</span>
              <span class="conv-time">{{ formatTime(conv.lastActivityAt || conv.startedAt) }}</span>
              <span v-if="conv.summary" class="summarized-badge">已摘要</span>
            </div>
            <h3>{{ cleanTitle(conv.title) }}</h3>
            <p v-if="conv.summary" class="conv-summary">{{ conv.summary }}</p>
            <div class="conv-bottom">
              <span>{{ shortProject(conv.projectPath || conv.projectSlug) }}</span>
              <span>{{ conv.messageCount }} 消息<span v-if="conv.toolCallCount"> · {{ conv.toolCallCount }} 工具</span></span>
            </div>
          </div>
          <div v-if="!batchMode" class="conv-more-wrap">
            <button class="btn-more" @click.stop="toggleMenu(conv.id)">...</button>
            <div v-if="openMenuId === conv.id" class="card-menu" @click.stop>
              <button class="menu-item" @click="openDetail(conv.id)">查看详情</button>
              <button class="menu-item danger" :disabled="deleting" @click="doDeleteSingle(conv.id)">彻底删除</button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="filteredConversations.length === 0" class="empty-state">
        {{ conversations.length === 0 ? '还没有导入会话，先点击右上角扫描。' : '没有匹配的会话。' }}
      </div>

      <Transition name="float-bar">
        <div v-if="batchMode && selectedIds.size" class="float-bar">
          <span>已选择 {{ selectedIds.size }} 条会话</span>
          <button class="btn-float-cancel" @click="clearSelection">清空</button>
          <button class="btn-float-delete" :disabled="deleting" @click="doBatchDelete">
            {{ deleting ? '删除中...' : '彻底删除' }}
          </button>
        </div>
      </Transition>
    </section>

    <section v-if="mainTab === 'cold'" class="workspace-section">
      <div class="panel-head cold-head">
        <div>
          <h2>冷库候选</h2>
          <p>这里先把能立即提高根 AI 质量的记忆整理出来。后续可以升级成审批流和自动注入。</p>
        </div>
        <button class="btn-secondary" @click="copyColdPack">复制冷库包</button>
      </div>
      <div class="memory-grid">
        <article v-for="item in coldItems" :key="item.id" class="memory-card" :class="item.type">
          <div class="memory-card-top">
            <span class="memory-type">{{ memoryTypeLabel(item.type) }}</span>
            <span class="memory-scope">{{ item.scope }}</span>
          </div>
          <h3>{{ item.title }}</h3>
          <p>{{ item.content }}</p>
          <small>{{ item.evidence }}</small>
        </article>
      </div>
    </section>

    <section v-if="mainTab === 'lab'" class="lab-layout">
      <div class="panel lab-input-panel">
        <h2>召回实验</h2>
        <p>输入一个未来你可能问根 AI 的问题，看看冷库会注入哪些上下文。</p>
        <textarea v-model="memoryQuery" class="lab-textarea" placeholder="比如：帮我继续优化会话冷库页面，接入 zcode，并让根 AI 下次自动理解我的术语。"></textarea>
        <div class="lab-actions">
          <button class="btn-primary" @click="copyRetrievalBundle">复制注入上下文</button>
          <button class="btn-secondary" @click="memoryQuery = sampleQuery">填入样例</button>
        </div>
      </div>
      <div class="panel lab-output-panel">
        <h2>拟注入上下文</h2>
        <pre class="bundle-preview">{{ retrievalBundle }}</pre>
      </div>
    </section>

    <section v-if="mainTab === 'insights'" class="workspace-section">
      <div class="filter-row compact">
        <div class="segmented">
          <button v-for="it in insightOptions" :key="it.id" :class="{ active: insightFilter === it.id }" @click="insightFilter = it.id">
            {{ it.label }}
          </button>
        </div>
      </div>
      <div class="insight-grid">
        <article v-for="ins in filteredInsights" :key="ins.id" class="insight-card">
          <div class="insight-top">
            <span class="insight-type-badge" :class="ins.type">{{ insightTypeLabel(ins.type) }}</span>
            <span>{{ Math.round(ins.confidence * 100) }}%</span>
          </div>
          <p>{{ ins.content }}</p>
          <small>{{ formatTime(ins.generatedAt) }}</small>
        </article>
      </div>
      <div v-if="filteredInsights.length === 0" class="empty-state">暂无洞察。可以从会话详情里提取，或后续接入批量萃取。</div>
    </section>

    <section v-if="mainTab === 'artifacts'" class="workspace-section">
      <div class="artifact-grid">
        <article v-for="art in artifacts" :key="art.id" class="artifact-card">
          <div class="artifact-top">
            <span class="artifact-type-badge" :class="art.type">{{ artifactTypeLabel(art.type) }}</span>
            <span v-if="art.applied" class="applied-badge">已应用</span>
          </div>
          <h3>{{ art.title }}</h3>
          <div class="artifact-actions">
            <button class="btn-sm" @click="previewArtifact(art)">预览</button>
            <button v-if="!art.applied" class="btn-sm primary" @click="doApplyArtifact(art.id)">应用</button>
          </div>
        </article>
      </div>
      <div v-if="artifacts.length === 0" class="empty-state">暂无制品。可以从高价值会话生成 Skill、Prompt 或记忆条目。</div>
    </section>

    <section v-if="mainTab === 'actions'" class="workspace-section">
      <div class="action-grid">
        <article v-for="sk in conversationSkills" :key="sk.id" class="action-card">
          <div class="action-card-top">
            <span>{{ sk.name }}</span>
            <small>{{ sk.tags.join(' / ') }}</small>
          </div>
          <p>{{ sk.description }}</p>
          <button class="btn-secondary full" @click="openSkillPrompt(sk)">查看提示词</button>
        </article>
      </div>
    </section>

    <div v-if="detailOpen" class="modal-overlay" @click.self="detailOpen = false">
      <div class="detail-card">
        <div class="detail-header">
          <div>
            <span class="source-badge" :class="detailData?.source">{{ detailData ? sourceLabel(detailData.source) : '' }}</span>
            <h2>{{ detailData?.title }}</h2>
            <p>{{ detailData?.model || 'unknown model' }} · {{ detailData?.messageCount }} 消息 · {{ formatTime(detailData?.startedAt) }}</p>
          </div>
          <button class="close-btn" @click="detailOpen = false">×</button>
        </div>
        <div class="detail-tabs">
          <button class="dtab" :class="{ active: detailTab === 'messages' }" @click="detailTab = 'messages'">对话</button>
          <button class="dtab" :class="{ active: detailTab === 'summary' }" @click="detailTab = 'summary'">总结</button>
          <button class="dtab" :class="{ active: detailTab === 'insights' }" @click="detailTab = 'insights'">洞察</button>
          <button class="dtab" :class="{ active: detailTab === 'generate' }" @click="detailTab = 'generate'">生成</button>
        </div>

        <div v-if="detailTab === 'messages'" class="message-timeline">
          <div v-for="(msg, idx) in detailData?.messages" :key="idx" class="msg-bubble" :class="msg.role">
            <div class="msg-role">{{ roleLabel(msg.role) }}</div>
            <div v-if="msg.contentType === 'tool_use'" class="msg-content tool-call">{{ msg.toolName || 'Tool' }}</div>
            <div v-else class="msg-content">{{ msg.content.slice(0, 900) }}{{ msg.content.length > 900 ? '...' : '' }}</div>
          </div>
        </div>

        <div v-if="detailTab === 'summary'" class="summary-panel">
          <p v-if="detailData?.summary" class="summary-text">{{ detailData.summary }}</p>
          <div v-else class="empty-state small">暂无总结</div>
          <button class="btn-primary" :disabled="analyzing" @click="doSummarize">
            {{ analyzing ? '生成中...' : (detailData?.summary ? '重新生成总结' : '生成总结') }}
          </button>
        </div>

        <div v-if="detailTab === 'insights'" class="summary-panel">
          <div v-if="detailInsights.length" class="insight-list">
            <div v-for="ins in detailInsights" :key="ins.id" class="insight-item">
              <span class="insight-type-badge" :class="ins.type">{{ insightTypeLabel(ins.type) }}</span>
              <span>{{ ins.content }}</span>
            </div>
          </div>
          <div v-else class="empty-state small">暂无洞察</div>
          <button class="btn-primary" :disabled="analyzing" @click="doExtractInsights">
            {{ analyzing ? '提取中...' : '提取洞察' }}
          </button>
        </div>

        <div v-if="detailTab === 'generate'" class="generate-panel">
          <div class="gen-buttons">
            <button class="btn-secondary" :disabled="analyzing" @click="doGenerate('skill')">生成 Skill</button>
            <button class="btn-secondary" :disabled="analyzing" @click="doGenerate('prompt')">生成 Prompt</button>
            <button class="btn-secondary" :disabled="analyzing" @click="doGenerate('memory-note')">生成记忆</button>
          </div>
          <div v-if="genResult" class="gen-result">
            <div class="gen-result-header">
              <span>{{ genResult.title }}</span>
              <button class="btn-sm" @click="copyGenResult">复制</button>
            </div>
            <pre>{{ genResult.content }}</pre>
          </div>
        </div>
      </div>
    </div>

    <div v-if="previewOpen" class="modal-overlay" @click.self="previewOpen = false">
      <div class="detail-card narrow">
        <div class="detail-header">
          <h2>{{ previewData?.title }}</h2>
          <button class="close-btn" @click="previewOpen = false">×</button>
        </div>
        <pre class="preview-content">{{ previewData?.content }}</pre>
      </div>
    </div>

    <div v-if="skillPromptOpen" class="modal-overlay" @click.self="skillPromptOpen = false">
      <div class="detail-card narrow">
        <div class="detail-header">
          <div>
            <h2>{{ activeSkillPrompt?.name }}</h2>
            <p>{{ activeSkillPrompt?.description }}</p>
          </div>
          <button class="close-btn" @click="skillPromptOpen = false">×</button>
        </div>
        <div v-if="activeSkillPrompt?.params?.length" class="prompt-params">
          <label v-for="p in activeSkillPrompt.params" :key="p.key">
            <span>{{ p.label }}</span>
            <input v-model="promptParams[p.key]" :placeholder="p.placeholder || ''" />
          </label>
        </div>
        <textarea class="prompt-textarea" readonly :value="renderedSkillPrompt" @click="($event.target as HTMLTextAreaElement).select()"></textarea>
        <div class="prompt-actions">
          <button class="btn-primary" @click="copySkillPrompt">{{ skillPromptCopied ? '已复制' : '复制提示词' }}</button>
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

type SourceFilter = 'all' | ConversationSummary['source']
type MainTab = 'overview' | 'conversations' | 'cold' | 'lab' | 'insights' | 'artifacts' | 'actions'
type TimeFilter = 'all' | 'today' | 'week' | 'month'

interface ColdItem {
  id: string
  type: 'glossary' | 'preference' | 'workflow' | 'project' | 'source'
  title: string
  content: string
  scope: string
  evidence: string
}

interface ConversationSkill {
  id: string
  name: string
  description: string
  tags: string[]
  params?: { key: string; label: string; placeholder?: string }[]
  promptTemplate: string
}

const conversations = ref<ConversationSummary[]>([])
const insights = ref<MemoryInsight[]>([])
const artifacts = ref<GeneratedArtifact[]>([])

const mainTab = ref<MainTab>('overview')
const search = ref('')
const sourceFilter = ref<SourceFilter>('all')
const timeFilter = ref<TimeFilter>('all')
const projectFilter = ref('all')
const insightFilter = ref<'all' | MemoryInsight['type']>('all')
const scanning = ref(false)
const analyzing = ref(false)
const deleting = ref(false)
const openMenuId = ref<string | null>(null)
const batchMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

const detailOpen = ref(false)
const detailTab = ref<'messages' | 'summary' | 'insights' | 'generate'>('messages')
const detailData = ref<ConversationDetail | null>(null)
const detailInsights = ref<MemoryInsight[]>([])
const genResult = ref<GeneratedArtifact | null>(null)

const previewOpen = ref(false)
const previewData = ref<GeneratedArtifact | null>(null)
const skillPromptOpen = ref(false)
const activeSkillPrompt = ref<ConversationSkill | null>(null)
const promptParams = ref<Record<string, string>>({})
const skillPromptCopied = ref(false)

const sampleQuery = '帮我继续优化会话冷库页面，接入 zcode，并让根 AI 下次自动理解我的术语和做事习惯。'
const memoryQuery = ref(sampleQuery)
const aiPlatformRoot = 'C:/FengSuKeJi/ai-platform'

const sourceOptions: { id: SourceFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'zcode', label: 'ZCode' },
]

const timeOptions: { id: TimeFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'today', label: '今日' },
  { id: 'week', label: '近 7 天' },
  { id: 'month', label: '本月' },
]

const insightOptions: { id: 'all' | MemoryInsight['type']; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'preference', label: '偏好' },
  { id: 'pattern', label: '模式' },
  { id: 'correction', label: '纠偏' },
  { id: 'knowledge', label: '知识' },
  { id: 'skill-idea', label: 'Skill 想法' },
]

const conversationSkills: ConversationSkill[] = [
  {
    id: 'fridge-glossary',
    name: '冷库术语表',
    description: '从会话中提取高频术语、特殊叫法和项目黑话，形成根 AI 可引用的个人词典。',
    tags: ['术语', '冷库'],
    promptTemplate: `请执行冷库术语表分析。
读取会话索引: ${aiPlatformRoot}/server/data/memory/index.json
读取 Skill 文件: ${aiPlatformRoot}/skills/conversations/fridge-glossary/SKILL.md
将结果写入: ${aiPlatformRoot}/doc/fridge-glossary.md`,
  },
  {
    id: 'pattern-analysis',
    name: '会话模式分析',
    description: '分析跨会话工作习惯、常见流程和效率瓶颈，生成个人 AI 协作画像。',
    tags: ['模式', '画像'],
    promptTemplate: `请执行会话模式分析。
读取会话索引: ${aiPlatformRoot}/server/data/memory/index.json
读取 Skill 文件: ${aiPlatformRoot}/skills/conversations/pattern-analysis/SKILL.md
将结果写入: ${aiPlatformRoot}/doc/conversation-pattern-analysis.md`,
  },
  {
    id: 'summarize-batch',
    name: '群体会话总结',
    description: '批量总结会话，提炼偏好、决策、复用流程和项目知识体系。',
    tags: ['总结', '批处理'],
    promptTemplate: `请执行群体会话总结。
读取会话索引: ${aiPlatformRoot}/server/data/memory/index.json
读取 Skill 文件: ${aiPlatformRoot}/skills/conversations/summarize-batch/SKILL.md
将结果写入: ${aiPlatformRoot}/doc/conversation-batch-summary.md`,
  },
  {
    id: 'summarize-single',
    name: '单会话深度总结',
    description: '对指定会话做深度总结，提取关键决策、知识要点和用户偏好。',
    tags: ['单条', '总结'],
    params: [
      { key: 'convId', label: '会话 ID', placeholder: '例如 claude-code:xxx、codex:xxx 或 zcode:xxx' },
    ],
    promptTemplate: `请执行单会话深度总结。
目标会话 ID: {{convId}}
读取 Skill 文件: ${aiPlatformRoot}/skills/conversations/summarize-single/SKILL.md
读取会话详情: ${aiPlatformRoot}/server/data/memory/conversations/
将结果写入: ${aiPlatformRoot}/doc/conversation-summary-{shortId}.md`,
  },
]

const summarizedCount = computed(() => conversations.value.filter(c => !!c.summary).length)

const sourceStats = computed(() => {
  const total = Math.max(1, conversations.value.length)
  return sourceOptions.filter(s => s.id !== 'all').map(src => {
    const count = conversations.value.filter(c => c.source === src.id).length
    return { ...src, count, percent: Math.round((count / total) * 100) }
  })
})

const projectStats = computed(() => {
  const map = new Map<string, { name: string; path: string; count: number }>()
  for (const c of conversations.value) {
    const path = c.projectPath || c.projectSlug || 'unknown'
    const parts = path.replace(/\\/g, '/').split('/')
    const name = parts[parts.length - 1] || path
    const old = map.get(path)
    if (old) old.count++
    else map.set(path, { name, path, count: 1 })
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 8)
})

const priorities = computed(() => [
  { rank: '01', title: '先把 zcode 原料接稳', desc: `当前 ZCode 会话 ${conversations.value.filter(c => c.source === 'zcode').length} 条，后续可继续补 SQLite 标题。` },
  { rank: '02', title: '把高价值会话批量摘要', desc: `还有 ${Math.max(0, conversations.value.length - summarizedCount.value)} 条未摘要，冷库质量主要卡在这里。` },
  { rank: '03', title: '建立审批后的注入层', desc: '冷库候选可以先复制使用，下一步适合做 approved 记忆和 Chat 自动注入。' },
])

const seedColdItems = computed<ColdItem[]>(() => [
  {
    id: 'seed-cold-storage',
    type: 'glossary',
    title: '冷库',
    content: '本地会话沉淀出的个人上下文资产，包含术语、偏好、流程、纠偏和项目知识，不是普通聊天记录。',
    scope: '全局',
    evidence: '来自用户对会话页面目标的明确纠正',
  },
  {
    id: 'seed-root-ai',
    type: 'glossary',
    title: '根 AI',
    content: '负责主导对话、调度工具、串联平台和读取冷库上下文的主 AI。',
    scope: '全局',
    evidence: '来自多次关于根 AI 对话质量和效率的讨论',
  },
  {
    id: 'seed-style',
    type: 'preference',
    title: '偏好深度方案',
    content: '用户不满足浅层判断，希望方案参考业内实践、有设计文档、有实现路径，并能说服团队。',
    scope: '全局',
    evidence: '来自本轮对设计深度的反馈',
  },
  {
    id: 'seed-zcode',
    type: 'source',
    title: 'ZCode 平台',
    content: '智谱 ZCode 是新的本地会话来源，应与 Claude Code、Codex 一样进入 Memory Hub。',
    scope: '平台来源',
    evidence: '来自本轮新增平台要求和本机 .zcode/cli/rollout 目录',
  },
  {
    id: 'seed-project-rule',
    type: 'project',
    title: 'ai-platform 项目规则',
    content: '文档放 /doc；后端接口只用 GET/POST，写操作用 POST；开发时 server 3100 和 web 3200 同时启动。',
    scope: 'C:/FengSuKeJi/ai-platform',
    evidence: '来自 AGENTS.md 项目规则',
  },
])

const insightColdItems = computed<ColdItem[]>(() => insights.value.slice(0, 12).map(ins => ({
  id: `insight-${ins.id}`,
  type: ins.type === 'preference' ? 'preference' : ins.type === 'pattern' ? 'workflow' : 'project',
  title: insightTypeLabel(ins.type),
  content: ins.content,
  scope: '洞察',
  evidence: `${Math.round(ins.confidence * 100)}% 置信度`,
})))

const coldItems = computed(() => [...seedColdItems.value, ...insightColdItems.value])

const filteredConversations = computed(() => {
  let list = conversations.value
  if (sourceFilter.value !== 'all') list = list.filter(c => c.source === sourceFilter.value)
  if (projectFilter.value !== 'all') list = list.filter(c => (c.projectPath || c.projectSlug) === projectFilter.value)
  if (timeFilter.value !== 'all') {
    const now = new Date()
    const cutoff = new Date(now)
    if (timeFilter.value === 'today') cutoff.setHours(0, 0, 0, 0)
    if (timeFilter.value === 'week') cutoff.setDate(cutoff.getDate() - 7)
    if (timeFilter.value === 'month') cutoff.setDate(1)
    list = list.filter(c => new Date(c.startedAt || c.lastActivityAt || c.importedAt) >= cutoff)
  }
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(c =>
      (c.title || '').toLowerCase().includes(q) ||
      (c.projectPath || '').toLowerCase().includes(q) ||
      (c.model || '').toLowerCase().includes(q) ||
      (c.summary || '').toLowerCase().includes(q)
    )
  }
  return list
})

const filteredInsights = computed(() => {
  if (insightFilter.value === 'all') return insights.value
  return insights.value.filter(i => i.type === insightFilter.value)
})

const retrievalItems = computed(() => {
  const q = memoryQuery.value.toLowerCase()
  const scored = coldItems.value.map(item => {
    const text = `${item.title} ${item.content} ${item.scope}`.toLowerCase()
    let score = 0
    for (const token of q.split(/\s+/).filter(Boolean)) {
      if (text.includes(token)) score += 2
    }
    if (q.includes('zcode') && item.title.toLowerCase().includes('zcode')) score += 5
    if (q.includes('冷库') && item.content.includes('冷库')) score += 5
    if (q.includes('根 ai') || q.includes('根ai')) {
      if (item.content.includes('根 AI')) score += 4
    }
    return { item, score }
  })
  return scored
    .sort((a, b) => b.score - a.score)
    .filter((x, index) => x.score > 0 || index < 5)
    .slice(0, 8)
    .map(x => x.item)
})

const retrievalBundle = computed(() => {
  const lines = retrievalItems.value.map(item => `- [${memoryTypeLabel(item.type)} / ${item.scope}] ${item.title}: ${item.content}`)
  return `## 个人冷库上下文

### 当前请求
${memoryQuery.value || '(空)'}

### 建议注入
${lines.join('\n')}

### 调用建议
- 将以上内容放在用户请求前，不覆盖用户原始意图。
- 若涉及实现，优先遵守项目 AGENTS.md。
- 若记忆与当前代码冲突，以当前代码和用户最新指令为准。`
})

const renderedSkillPrompt = computed(() => {
  let text = activeSkillPrompt.value?.promptTemplate || ''
  for (const [key, value] of Object.entries(promptParams.value)) {
    text = text.split(`{{${key}}}`).join(value || `{${key}}`)
  }
  return text
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
    alert(`扫描完成：共 ${result.scanned} 个会话，新增 ${result.newCount} 个，更新 ${result.updated} 个。`)
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
    await loadData()
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

async function doApplyArtifact(id: string) {
  try {
    await applyArtifact(id)
    await loadArtifactsData()
    alert('应用成功')
  } catch (err: any) {
    alert('应用失败：' + err.message)
  }
}

async function doDeleteSingle(id: string) {
  if (!confirm('确认彻底删除该会话及源文件？')) return
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
  if (!confirm(`确认彻底删除 ${ids.length} 条会话及源文件？`)) return
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

function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function selectAll() {
  selectedIds.value = new Set(filteredConversations.value.map(c => c.id))
}

function clearSelection() {
  selectedIds.value = new Set()
}

function exitBatchMode() {
  batchMode.value = false
  clearSelection()
}

function setTimeFilter(value: TimeFilter) {
  timeFilter.value = value
}

function previewArtifact(art: GeneratedArtifact) {
  previewData.value = art
  previewOpen.value = true
}

function openSkillPrompt(skill: ConversationSkill) {
  activeSkillPrompt.value = skill
  promptParams.value = {}
  for (const p of skill.params || []) promptParams.value[p.key] = ''
  skillPromptCopied.value = false
  skillPromptOpen.value = true
}

function copyGenResult() {
  if (genResult.value?.content) navigator.clipboard.writeText(genResult.value.content)
}

function copySkillPrompt() {
  navigator.clipboard.writeText(renderedSkillPrompt.value)
  skillPromptCopied.value = true
}

function copyColdPack() {
  const text = coldItems.value.map(item => `- [${memoryTypeLabel(item.type)}] ${item.title}: ${item.content}`).join('\n')
  navigator.clipboard.writeText(`# 冷库候选\n\n${text}\n`)
}

function copyRetrievalBundle() {
  navigator.clipboard.writeText(retrievalBundle.value)
}

function sourceLabel(source: ConversationSummary['source']) {
  const labels: Record<ConversationSummary['source'], string> = {
    'claude-code': 'Claude',
    codex: 'Codex',
    zcode: 'ZCode',
  }
  return labels[source] || source
}

function roleLabel(role: ConversationDetail['messages'][number]['role']) {
  if (role === 'user') return '用户'
  if (role === 'assistant') return '助手'
  return '系统'
}

function memoryTypeLabel(type: ColdItem['type']) {
  const labels: Record<ColdItem['type'], string> = {
    glossary: '术语',
    preference: '偏好',
    workflow: '流程',
    project: '项目',
    source: '来源',
  }
  return labels[type]
}

function insightTypeLabel(type: MemoryInsight['type']) {
  const labels: Record<MemoryInsight['type'], string> = {
    preference: '偏好',
    pattern: '模式',
    correction: '纠偏',
    knowledge: '知识',
    'skill-idea': 'Skill',
  }
  return labels[type]
}

function artifactTypeLabel(type: GeneratedArtifact['type']) {
  const labels: Record<GeneratedArtifact['type'], string> = {
    skill: 'Skill',
    prompt: 'Prompt',
    'memory-note': '记忆',
  }
  return labels[type]
}

function cleanTitle(title?: string) {
  return title?.replace(/\s+/g, ' ').trim() || '无标题'
}

function shortProject(p?: string) {
  if (!p) return 'unknown'
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

function formatTime(ts?: string) {
  if (!ts) return '-'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function percent(value: number, total: number) {
  if (!total) return '0%'
  return `${Math.round((value / total) * 100)}%`
}
</script>

<style scoped>
.memory-workbench {
  min-height: 100%;
  padding: 28px 32px 40px;
  background: #f6f7f9;
  color: #20242c;
}

.memory-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #667085;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.memory-header h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
}

.page-desc {
  margin: 8px 0 0;
  color: #667085;
  font-size: 14px;
}

.header-actions,
.lab-actions,
.artifact-actions,
.gen-buttons,
.prompt-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

button {
  font: inherit;
}

.btn-primary,
.btn-secondary,
.btn-sm,
.btn-link {
  border: none;
  cursor: pointer;
}

.btn-primary {
  padding: 9px 16px;
  border-radius: 8px;
  background: #2458d3;
  color: #fff;
  font-weight: 600;
}

.btn-secondary {
  padding: 9px 14px;
  border-radius: 8px;
  background: #fff;
  color: #344054;
  border: 1px solid #d0d5dd;
  font-weight: 600;
}

.btn-secondary.full {
  width: 100%;
}

.btn-sm {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid #d0d5dd;
  background: #fff;
  color: #344054;
  font-size: 12px;
}

.btn-sm.primary {
  background: #2458d3;
  border-color: #2458d3;
  color: #fff;
}

.btn-primary:disabled,
.btn-secondary:disabled,
.btn-sm:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.signal-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.signal-card,
.panel,
.conv-card,
.memory-card,
.insight-card,
.artifact-card,
.action-card {
  background: #fff;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}

.signal-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.signal-card strong {
  font-size: 30px;
  line-height: 1;
}

.signal-label,
.signal-card small {
  color: #667085;
  font-size: 12px;
}

.main-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 18px;
}

.mtab {
  padding: 8px 14px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  background: #fff;
  color: #475467;
  cursor: pointer;
}

.mtab.active {
  background: #1f2937;
  border-color: #1f2937;
  color: #fff;
}

.overview-grid {
  display: grid;
  grid-template-columns: 1.35fr 0.95fr;
  gap: 14px;
}

.panel {
  padding: 18px;
}

.panel.wide {
  grid-row: span 2;
}

.panel h2,
.panel-head h2,
.memory-card h3,
.conv-card h3,
.artifact-card h3 {
  margin: 0;
}

.panel p,
.panel-head p,
.priority-item p,
.action-card p,
.memory-card p,
.conv-summary {
  margin: 6px 0 0;
  color: #667085;
  line-height: 1.55;
  font-size: 13px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.cold-head {
  padding: 18px;
  background: #fff;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
}

.source-bars {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.source-row {
  display: grid;
  grid-template-columns: 130px 1fr 44px;
  gap: 12px;
  align-items: center;
}

.source-name {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #344054;
  font-size: 13px;
}

.source-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #667085;
}

.bar-track {
  height: 8px;
  background: #eef0f3;
  border-radius: 999px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 999px;
}

.source-dot.claude-code,
.bar-fill.claude-code {
  background: #2458d3;
}

.source-dot.codex,
.bar-fill.codex {
  background: #079455;
}

.source-dot.zcode,
.bar-fill.zcode {
  background: #c2410c;
}

.priority-list,
.project-list,
.insight-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.priority-item {
  display: flex;
  gap: 10px;
}

.priority-rank {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: #fff7ed;
  color: #c2410c;
  font-weight: 700;
  flex-shrink: 0;
}

.project-chip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  background: #fff;
  padding: 9px 10px;
  cursor: pointer;
}

.project-chip.active {
  border-color: #2458d3;
  color: #2458d3;
}

.workspace-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.filter-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  background: #fff;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  padding: 12px;
}

.filter-row.compact {
  justify-content: flex-start;
}

.search-input {
  width: min(360px, 100%);
  padding: 9px 12px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  outline: none;
}

.segmented {
  display: inline-flex;
  padding: 3px;
  background: #f2f4f7;
  border-radius: 8px;
  gap: 3px;
}

.segmented button {
  border: none;
  background: transparent;
  padding: 6px 10px;
  border-radius: 6px;
  color: #475467;
  cursor: pointer;
}

.segmented button.active {
  background: #fff;
  color: #1f2937;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
}

.list-summary {
  display: flex;
  gap: 12px;
  align-items: center;
  color: #667085;
  font-size: 13px;
}

.btn-link {
  background: transparent;
  color: #2458d3;
  padding: 0;
}

.selected-count {
  color: #2458d3;
  font-weight: 600;
}

.conv-grid,
.memory-grid,
.insight-grid,
.artifact-grid,
.action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 12px;
}

.conv-card {
  padding: 14px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.conv-card:hover {
  border-color: #98a2b3;
}

.conv-card.selected {
  border-color: #2458d3;
  background: #eff4ff;
}

.conv-body {
  min-width: 0;
  flex: 1;
  cursor: pointer;
}

.conv-top-row,
.conv-bottom,
.artifact-top,
.memory-card-top,
.insight-top,
.action-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.conv-card h3 {
  margin-top: 8px;
  font-size: 15px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-bottom {
  margin-top: 10px;
  color: #667085;
  font-size: 12px;
}

.source-badge,
.summarized-badge,
.memory-type,
.memory-scope,
.insight-type-badge,
.artifact-type-badge,
.applied-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
}

.source-badge.claude-code {
  background: #eff4ff;
  color: #2458d3;
}

.source-badge.codex {
  background: #ecfdf3;
  color: #087443;
}

.source-badge.zcode {
  background: #fff7ed;
  color: #c2410c;
}

.summarized-badge,
.applied-badge {
  background: #ecfdf3;
  color: #087443;
}

.conv-time {
  margin-left: auto;
  color: #98a2b3;
  font-size: 11px;
}

.check-btn {
  width: 20px;
  height: 20px;
  border: 1px solid #d0d5dd;
  border-radius: 5px;
  background: #fff;
  cursor: pointer;
}

.check-btn.checked {
  background: #2458d3;
  color: #fff;
  border-color: #2458d3;
}

.conv-more-wrap {
  position: relative;
}

.btn-more {
  border: none;
  background: transparent;
  color: #667085;
  cursor: pointer;
}

.card-menu {
  position: absolute;
  top: 24px;
  right: 0;
  min-width: 120px;
  background: #fff;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  box-shadow: 0 12px 24px rgba(16, 24, 40, 0.12);
  overflow: hidden;
  z-index: 20;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.menu-item:hover {
  background: #f2f4f7;
}

.menu-item.danger {
  color: #b42318;
}

.memory-card {
  padding: 16px;
}

.memory-card.glossary {
  border-top: 3px solid #2458d3;
}

.memory-card.preference {
  border-top: 3px solid #079455;
}

.memory-card.workflow {
  border-top: 3px solid #7a5af8;
}

.memory-card.project {
  border-top: 3px solid #c2410c;
}

.memory-card.source {
  border-top: 3px solid #0e9384;
}

.memory-type {
  background: #f2f4f7;
  color: #344054;
}

.memory-scope {
  background: #f8fafc;
  color: #667085;
}

.memory-card h3 {
  margin-top: 10px;
  font-size: 16px;
}

.memory-card small,
.insight-card small {
  display: block;
  margin-top: 12px;
  color: #98a2b3;
  font-size: 12px;
}

.lab-layout {
  display: grid;
  grid-template-columns: minmax(320px, 0.85fr) minmax(420px, 1.15fr);
  gap: 14px;
}

.lab-textarea,
.prompt-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  padding: 12px;
  resize: vertical;
  outline: none;
  line-height: 1.55;
}

.lab-textarea {
  min-height: 180px;
  margin-top: 14px;
}

.bundle-preview,
.preview-content,
.gen-result pre {
  margin: 0;
  padding: 14px;
  background: #101828;
  color: #f2f4f7;
  border-radius: 8px;
  white-space: pre-wrap;
  line-height: 1.6;
  max-height: 520px;
  overflow: auto;
}

.insight-card,
.artifact-card,
.action-card {
  padding: 14px;
}

.insight-type-badge.preference { background: #eff4ff; color: #2458d3; }
.insight-type-badge.pattern { background: #f4f3ff; color: #6941c6; }
.insight-type-badge.correction { background: #fef3f2; color: #b42318; }
.insight-type-badge.knowledge { background: #ecfdf3; color: #087443; }
.insight-type-badge.skill-idea { background: #fff7ed; color: #c2410c; }

.artifact-type-badge.skill { background: #fff7ed; color: #c2410c; }
.artifact-type-badge.prompt { background: #f4f3ff; color: #6941c6; }
.artifact-type-badge.memory-note { background: #eff4ff; color: #2458d3; }

.action-card-top span {
  font-weight: 700;
}

.action-card-top small {
  color: #667085;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 100;
}

.detail-card {
  width: min(860px, 100%);
  max-height: 86vh;
  overflow: auto;
  background: #fff;
  border-radius: 8px;
  padding: 22px;
}

.detail-card.narrow {
  width: min(720px, 100%);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.detail-header h2 {
  margin: 8px 0 4px;
  font-size: 20px;
}

.detail-header p {
  margin: 0;
  color: #667085;
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: #f2f4f7;
  cursor: pointer;
  font-size: 20px;
}

.detail-tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid #e4e7ec;
  margin: 16px 0;
  padding-bottom: 8px;
}

.dtab {
  border: none;
  border-radius: 6px;
  padding: 7px 12px;
  background: transparent;
  cursor: pointer;
  color: #475467;
}

.dtab.active {
  background: #1f2937;
  color: #fff;
}

.message-timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.msg-bubble {
  max-width: 88%;
  padding: 10px 13px;
  border-radius: 8px;
  line-height: 1.55;
  font-size: 13px;
}

.msg-bubble.user {
  align-self: flex-end;
  background: #eff4ff;
  color: #1d2939;
}

.msg-bubble.assistant {
  align-self: flex-start;
  background: #f2f4f7;
}

.msg-bubble.system {
  align-self: center;
  background: #fff7ed;
}

.msg-role {
  margin-bottom: 4px;
  color: #667085;
  font-size: 11px;
  font-weight: 700;
}

.tool-call {
  font-family: Consolas, monospace;
  color: #6941c6;
}

.summary-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}

.summary-text {
  margin: 0;
  padding: 14px;
  border-radius: 8px;
  background: #f8fafc;
  line-height: 1.7;
}

.insight-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
}

.gen-result {
  margin-top: 12px;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  overflow: hidden;
}

.gen-result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: #f2f4f7;
  font-weight: 700;
}

.prompt-params {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 14px 0;
}

.prompt-params label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #475467;
  font-size: 13px;
}

.prompt-params input {
  padding: 9px 11px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
}

.prompt-textarea {
  height: 320px;
}

.empty-state {
  padding: 34px;
  text-align: center;
  color: #98a2b3;
  background: #fff;
  border: 1px dashed #d0d5dd;
  border-radius: 8px;
}

.empty-state.small {
  padding: 18px;
  width: 100%;
  box-sizing: border-box;
}

.float-bar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px 16px;
  background: #1f2937;
  color: #fff;
  border-radius: 8px;
  box-shadow: 0 16px 32px rgba(16, 24, 40, 0.22);
  z-index: 80;
}

.btn-float-cancel,
.btn-float-delete {
  border: none;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
}

.btn-float-cancel {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.btn-float-delete {
  background: #d92d20;
  color: #fff;
}

.float-bar-enter-active,
.float-bar-leave-active {
  transition: opacity 0.18s, transform 0.18s;
}

.float-bar-enter-from,
.float-bar-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

@media (max-width: 920px) {
  .memory-header,
  .panel-head {
    flex-direction: column;
  }

  .signal-grid,
  .overview-grid,
  .lab-layout {
    grid-template-columns: 1fr;
  }

  .source-row {
    grid-template-columns: 100px 1fr 36px;
  }
}
</style>
