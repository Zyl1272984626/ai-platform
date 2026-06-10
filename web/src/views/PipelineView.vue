<template>
  <div class="pipeline-page">
    <header class="page-header">
      <div>
        <h1>开发流水线</h1>
        <p class="page-desc">多平台接力工作台：生成提示词、约定产物目录、检测阶段结果，平台本身不调用模型。</p>
      </div>
      <div class="header-actions">
        <button class="btn-ghost" @click="refreshAll" :disabled="refreshing">{{ refreshing ? '刷新中...' : '刷新' }}</button>
        <button class="btn-primary compact" :disabled="!canCopyCodexPrompt" @click="copyCodexPrompt">
          {{ codexCopied ? '已复制' : (baseEngine === 'claudecode' ? '复制 ClaudeCode 总控提示词' : '复制总控提示词') }}
        </button>
      </div>
    </header>

    <section class="ops-strip">
      <div class="ops-item">
        <span class="ops-label">接力阶段</span>
        <strong>{{ relayPlan?.stages.length || 0 }}</strong>
      </div>
      <div class="ops-item">
        <span class="ops-label">已检测产物</span>
        <strong>{{ artifactDoneCount }}</strong>
      </div>
      <div class="ops-item">
        <span class="ops-label">运行 ID</span>
        <strong class="ops-code">{{ relayRunId || '-' }}</strong>
      </div>
      <div class="ops-item">
        <span class="ops-label">兼容历史</span>
        <strong>{{ runs.length }}</strong>
      </div>
    </section>

    <nav class="tabs">
      <button class="tab" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">总览</button>
      <button class="tab" :class="{ active: tab === 'new' }" @click="tab = 'new'">新建</button>
      <button class="tab" :class="{ active: tab === 'artifacts' }" @click="tab = 'artifacts'">
        产物<span v-if="artifactRuns.length" class="pill">{{ artifactRuns.length }}</span>
      </button>
      <button v-if="runs.length" class="tab" :class="{ active: tab === 'history' }" @click="tab = 'history'">
        兼容历史<span class="pill">{{ runs.length }}</span>
      </button>
      <button class="tab" :class="{ active: tab === 'knowledge' }" @click="tab = 'knowledge'">知识图谱</button>
      <button class="tab" :class="{ active: tab === 'models' }" @click="tab = 'models'">模型</button>
    </nav>

    <section v-if="tab === 'overview'" class="overview-grid">
      <div class="panel wide">
        <div class="panel-head">
          <h2>多平台接力编排</h2>
          <span class="muted">平台只负责提示词和产物检测</span>
        </div>
        <div class="stage-roadmap">
          <div v-for="(stage, index) in relayPlan?.stages || []" :key="stage.id" class="roadmap-card">
            <span class="roadmap-index">{{ index + 1 }}</span>
            <div>
              <strong>{{ stage.name }}</strong>
              <p>{{ stage.ownerLabel }} · {{ stage.artifactFile }}</p>
            </div>
            <span class="gate-tag">{{ stage.promptKind }}</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>产物目录</h2>
          <button class="link-btn" :disabled="!relayRunId" @click="refreshArtifacts">检测产物</button>
        </div>
        <div class="artifact-path">
          <span>根目录</span>
          <code>{{ relayPlan?.artifactRoot || '-' }}</code>
        </div>
        <div class="artifact-path">
          <span>本次目录</span>
          <code>{{ relayPlan?.runDir || '-' }}</code>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>优化方向</h2>
        </div>
        <ul class="insight-list">
          <li>平台不调模型，不调 CLI，只生成各阶段提示词和统一产物路径。</li>
          <li>需求澄清后先做代码发现与影响分析，必须读取实际源码再进入设计。</li>
          <li>Codex/ChatGPT 作为总控与主设计者，基于代码发现产物出设计初稿，再根据审阅意见修订定稿。</li>
          <li>ClaudeCode/GLM 和 DeepSeek 在设计阶段负责审阅 Codex 初稿，不再平行另起最终方案。</li>
          <li>ClaudeCode/GLM 偏可实现性和重实现，DeepSeek 偏风险、边界和代码审查。</li>
          <li>外部平台把结果写入产物目录后，平台通过扫描文件判断阶段状态。</li>
        </ul>
      </div>
    </section>

    <section v-if="tab === 'new'" class="new-layout">
      <div class="panel">
        <div class="panel-head">
          <h2>接力配置</h2>
          <span class="muted">复制提示词到对应平台，产物统一写入指定目录</span>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>目标项目 <b>*</b></span>
            <select v-model="selectedProjectId" :disabled="isRunning" @change="refreshRelayPlan">
              <option value="">请选择项目</option>
              <option value="__ai-platform__">本系统 (AI Platform)</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>底座引擎</span>
            <div class="toggle-group">
              <button :class="['toggle-btn', { active: baseEngine === 'codex' }]" @click="switchBaseEngine('codex')">CodeX</button>
              <button :class="['toggle-btn', { active: baseEngine === 'claudecode' }]" @click="switchBaseEngine('claudecode')">ClaudeCode</button>
            </div>
          </label>
          <label class="field">
            <span>接力运行 ID</span>
            <div class="path-row">
              <input v-model="relayRunId" :disabled="isRunning" @blur="refreshRelayPlan" />
              <button title="根据需求生成 ID" :disabled="!requirement.trim()" @click="generateRelayId">↺</button>
            </div>
          </label>
          <label class="field span-2">
            <span>需求描述 <b>*</b></span>
            <textarea
              v-model="requirement"
              :disabled="isRunning"
              rows="5"
              @blur="ensureRelayId"
              placeholder="例如：增加用户导出功能，支持按日期范围筛选，导出为 Excel。"
            />
          </label>
        </div>
      </div>

      <div class="handoff-panel">
        <div>
          <h2>{{ baseEngine === 'claudecode' ? 'ClaudeCode 总控' : 'Codex 总控' }}</h2>
          <p v-if="baseEngine === 'claudecode'">ClaudeCode/GLM 作为总控：负责追问需求、产出初版设计、直接实现代码。DeepSeek 负责独立审阅。</p>
          <p v-else>第一段复制给 Codex/ChatGPT：它负责追问需求、建立接力目录、决定 GLM/DeepSeek/Codex 各自下一步，而不是让平台主动调用模型。</p>
        </div>
        <div class="handoff-actions">
          <button class="btn-primary" :disabled="!canCopyCodexPrompt" @click="copyCodexPrompt">
            {{ codexCopied ? '已复制总控提示词' : (baseEngine === 'claudecode' ? '复制 ClaudeCode 总控' : '复制总控提示词') }}
          </button>
          <button class="btn-ghost" :disabled="!relayRunId" @click="refreshArtifacts">检测产物</button>
        </div>
        <span v-if="launchHint" class="launch-hint">{{ launchHint }}</span>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>阶段接力提示词</h2>
          <button class="btn-ghost" :disabled="!requirement.trim() || copyingAll" @click="copyAllRelayPrompts">
            {{ copyingAll ? '复制中...' : '复制全部阶段' }}
          </button>
        </div>
        <div class="artifact-path run-dir">
          <span>本次产物目录</span>
          <code>{{ relayPlan?.runDir || '-' }}</code>
        </div>
        <div class="relay-grid">
          <div v-for="(stage, index) in relayStagesWithArtifacts" :key="stage.id" class="relay-card" :class="{ done: stage.exists }">
            <div class="relay-top">
              <span class="prompt-step">{{ index + 1 }}</span>
              <div>
                <strong>{{ stage.name }}</strong>
                <p>{{ stage.ownerLabel }}</p>
              </div>
              <span class="artifact-state" :class="{ ok: stage.exists }">{{ stage.exists ? '已检测' : '待产物' }}</span>
            </div>
            <p class="relay-purpose">{{ stage.purpose }}</p>
            <div class="artifact-file">
              <span>产物</span>
              <code>{{ stage.path || artifactPath(stage.artifactFile) }}</code>
            </div>
            <pre v-if="stage.preview" class="artifact-preview">{{ shortText(stage.preview, 420) }}</pre>
            <div class="relay-actions">
              <button class="btn-ghost compact" :disabled="!requirement.trim()" @click="copyRelayPrompt(stage.id)">
                {{ copiedStageId === stage.id ? '已复制' : '复制提示词' }}
              </button>
            </div>
          </div>
        </div>
      </div>

    </section>

    <section v-if="tab === 'artifacts'" class="artifact-layout">
      <div class="panel artifact-sidebar">
        <div class="panel-head">
          <h2>产物任务</h2>
          <button class="link-btn" @click="refreshArtifactRuns">刷新</button>
        </div>
        <div v-if="artifactRuns.length === 0" class="empty compact">暂无产物目录</div>
        <button
          v-for="run in artifactRuns"
          :key="run.runId"
          class="artifact-run"
          :class="{ active: artifactScan?.runId === run.runId }"
          @click="openArtifactRun(run.runId)"
        >
          <strong>{{ run.runId }}</strong>
          <span v-if="run.requirement">{{ shortText(run.requirement, 44) }}</span>
          <span>{{ run.completedStages }}/{{ run.totalStages }} 阶段</span>
          <time>{{ run.updatedAt ? formatTime(run.updatedAt) : '未检测到产物' }}</time>
        </button>
      </div>

      <div class="panel artifact-detail">
        <div class="panel-head">
          <h2>阶段产物</h2>
          <div class="artifact-actions">
            <button class="btn-ghost compact" :disabled="!artifactScan?.runId" @click="selectUnfinishedStages">选择未完成</button>
            <button class="btn-primary compact" :disabled="!selectedArtifactStageIds.length" @click="copyContinuationPrompt">
              {{ continuationCopied ? '已复制总控' : '复制选中阶段总控' }}
            </button>
            <button class="btn-ghost compact" :disabled="!artifactScan?.runId" @click="artifactScan?.runId && openArtifactRun(artifactScan.runId)">重新检测</button>
          </div>
        </div>
        <div v-if="!artifactScan" class="empty">请选择左侧任务查看产物</div>
        <template v-else>
          <div class="artifact-path run-dir">
            <span>产物目录</span>
            <code>{{ artifactScan.runDir }}</code>
          </div>
          <div class="relay-grid">
            <div v-for="stage in artifactScan.stages" :key="stage.id" class="relay-card" :class="{ done: stage.exists }">
              <div class="relay-top">
                <input
                  class="stage-check"
                  type="checkbox"
                  :checked="selectedArtifactStageIds.includes(stage.id)"
                  @change="toggleArtifactStage(stage.id)"
                />
                <div>
                  <strong>{{ artifactStageIndex(stage.id) }}. {{ stage.name }}</strong>
                  <p>{{ stage.ownerLabel }}</p>
                </div>
                <span class="artifact-state" :class="{ ok: stage.exists }">{{ stage.exists ? '已检测' : '待产物' }}</span>
              </div>
              <div class="artifact-file">
                <span>文件</span>
                <code>{{ stage.path }}</code>
              </div>
              <pre v-if="stage.preview" class="artifact-preview">{{ shortText(stage.preview, 600) }}</pre>
              <div class="relay-actions">
                <button class="btn-ghost compact" @click="copyArtifactStagePrompt(stage.id)">
                  {{ copiedStageId === stage.id ? '已复制' : '复制本阶段提示词' }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>

    <section v-if="tab === 'history'" class="history-list">
      <div v-if="runs.length === 0" class="empty panel">暂无流水线执行记录</div>
      <article v-for="run in runs" :key="run.id" class="run-card">
        <div class="run-header">
          <button class="run-main" @click="toggleRun(run.id)">
            <span class="run-title">
              <StatusBadge :status="run.status" size="small" />
              <strong>{{ shortText(run.requirement, 72) || run.id }}</strong>
            </span>
            <span class="run-meta">
              <span class="run-project">{{ getProjectName(run.projectId) }}</span>
              <time>{{ formatTime(run.startedAt) }}</time>
              <span class="run-expand">{{ expandedRun === run.id ? '收起' : '展开' }}</span>
            </span>
          </button>
          <button class="icon-action danger" title="删除历史" @click.stop="deleteRun(run.id)">删除</button>
        </div>
        <div v-if="expandedRun === run.id" class="run-body">
          <StepPipeline :steps="adaptStages(run.stages)" />
          <StageDetails
            :stages="run.stages"
            :stage-defs="stageDefs"
            :expanded-index="expandedHistStage"
            @toggle="expandedHistStage = expandedHistStage === $event ? -1 : $event"
          />
          <div class="run-actions">
            <button v-if="run.status === 'paused'" class="btn-ghost success" @click.stop="confirmStage(run.id)">确认继续</button>
            <button v-if="run.status === 'failed'" class="btn-ghost" @click.stop="resumeRun(run.id)">恢复执行</button>
            <button v-if="run.status === 'paused' || run.status === 'failed' || run.status === 'running'" class="btn-ghost danger" @click.stop="abortRun(run.id)">中止</button>
            <button class="btn-ghost danger subtle" @click.stop="deleteRun(run.id)">删除历史</button>
          </div>
        </div>
      </article>
    </section>

    <section v-if="tab === 'knowledge'" class="knowledge-list">
      <div v-if="knowledge.length === 0" class="empty panel">暂无知识图谱记录</div>
      <article v-for="entry in knowledge" :key="entry.runId" class="run-card">
        <div class="run-header">
          <div class="run-title">
            <StatusBadge :status="entry.success ? 'completed' : 'failed'" size="small" />
            <strong>{{ shortText(entry.requirement, 72) || entry.runId }}</strong>
          </div>
          <time>{{ entry.completedAt ? formatTime(entry.completedAt) : '' }}</time>
        </div>
      </article>
    </section>

    <section v-if="tab === 'models'" class="models-layout">
      <div class="panel">
        <div class="panel-head">
          <h2>可用模型</h2>
          <span class="muted">{{ availableModelCount }} 个已配置</span>
        </div>
        <div class="model-grid">
          <div v-for="model in availableModels" :key="model.id" class="model-card" :class="{ off: !model.available }">
            <div class="model-top">
              <span>{{ model.provider }}</span>
              <StatusBadge :status="model.available ? 'active' : 'idle'" size="small" />
            </div>
            <strong>{{ model.name }}</strong>
            <code>{{ model.id }}</code>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>DeepSeek 配置</h2>
          <span class="muted">{{ isDeepSeekReady ? '已就绪' : '未配置' }}</span>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>API Key</span>
            <input v-model="deepseekForm.apiKey" type="password" placeholder="DeepSeek API Key" />
          </label>
          <label class="field">
            <span>Base URL</span>
            <input v-model="deepseekForm.baseUrl" placeholder="https://api.deepseek.com/v1" />
          </label>
          <label class="field">
            <span>模型</span>
            <input v-model="deepseekForm.model" placeholder="deepseek-chat" />
          </label>
        </div>
        <div class="config-actions">
          <button class="btn-primary compact" @click="saveModelConfig">保存配置</button>
          <span v-if="modelSaveMsg" class="save-msg" :class="modelSaveOk ? 'ok' : 'err'">{{ modelSaveMsg }}</span>
        </div>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref } from 'vue'
import StatusBadge from '../components/common/StatusBadge.vue'
import StepPipeline from '../components/workflow/StepPipeline.vue'
import {
  abortPipeline as apiAbort,
  confirmStage as apiConfirm,
  createRelayRunId,
  deletePipelineRun as apiDeleteRun,
  generateContinuationPrompt,
  generatePrompt,
  generateCodexPrompt,
  generateClaudeCodePrompt,
  getRelayPlan,
  getModels,
  getPipelineRun,
  listArtifactRuns,
  listKnowledge,
  listPipelineRuns,
  listStageDefinitions,
  resumePipeline as apiResume,
  runPipeline,
  scanArtifacts,
  updateModelConfig,
} from '../api/pipelines'
import { getProjects } from '../api/projects'
import type { TestProject } from '../api/projects'
import type { ModelInfo, PipelineArtifactRun, PipelineArtifactScan, PipelineRelayPlan, PipelineRun, PipelineSSEEvent, PipelineStageDef, PipelineStageRun, StepRun } from '../api/types'

const StageDetails = defineComponent({
  name: 'StageDetails',
  props: {
    stages: { type: Array as () => PipelineStageRun[], required: true },
    stageDefs: { type: Array as () => PipelineStageDef[], required: true },
    expandedIndex: { type: Number, required: true },
  },
  emits: ['toggle'],
  setup(props, { emit }) {
    function formatOutput(output: unknown) {
      if (!output) return ''
      if (typeof output === 'string') return output
      try { return JSON.stringify(output, null, 2) } catch { return String(output) }
    }

    return () => h('div', { class: 'stage-detail-list' }, props.stages.map((stage, index) => {
      const expanded = props.expandedIndex === index
      const def = props.stageDefs[index]
      return h('div', { class: ['stage-detail-item', { expanded }], key: stage.stageId }, [
        h('button', { class: 'stage-detail-header', onClick: () => emit('toggle', index) }, [
          h('span', { class: 'stage-num' }, String(index + 1)),
          h('span', { class: 'stage-name' }, def?.name || stage.stageId),
          h(StatusBadge, { status: stage.status, size: 'small' }),
          h('span', { class: 'stage-arrow' }, expanded ? '收起' : '展开'),
        ]),
        expanded ? h('div', { class: 'stage-detail-body' }, [
          stage.output && Object.keys(stage.output).length
            ? h('div', { class: 'detail-block' }, [
              h('span', { class: 'detail-label' }, '输出'),
              h('pre', formatOutput(stage.output)),
            ])
            : null,
          stage.error
            ? h('div', { class: 'detail-block error' }, [
              h('span', { class: 'detail-label' }, '错误'),
              h('pre', stage.error),
            ])
            : null,
          h('div', { class: 'detail-meta' }, [
            stage.startedAt ? h('span', `开始 ${new Date(stage.startedAt).toLocaleString('zh-CN')}`) : null,
            stage.finishedAt ? h('span', `结束 ${new Date(stage.finishedAt).toLocaleString('zh-CN')}`) : null,
          ]),
        ]) : null,
      ])
    }))
  },
})

const tab = ref<'overview' | 'new' | 'artifacts' | 'history' | 'knowledge' | 'models'>('overview')
const refreshing = ref(false)
const stageDefs = ref<PipelineStageDef[]>([])
const runs = ref<PipelineRun[]>([])
const knowledge = ref<any[]>([])
const projects = ref<TestProject[]>([])
const artifactRuns = ref<PipelineArtifactRun[]>([])
const expandedRun = ref<string | null>(null)
const expandedStage = ref(-1)
const expandedHistStage = ref(-1)

const selectedProjectId = ref('__ai-platform__')
const requirement = ref('')
const baseEngine = ref<'codex' | 'claudecode'>('codex')
const relayRunId = ref('')
const relayPlan = ref<PipelineRelayPlan | null>(null)
const artifactScan = ref<PipelineArtifactScan | null>(null)

const isRunning = ref(false)
const currentRun = ref<PipelineRun | null>(null)
const liveLogs = ref<Array<{ type: string; text: string; time: string }>>([])
const copiedIndex = ref<number | null>(null)
const copiedStageId = ref<string | null>(null)
const copyingAll = ref(false)
const codexCopied = ref(false)
const continuationCopied = ref(false)
const selectedArtifactStageIds = ref<string[]>([])
const availableModels = ref<ModelInfo[]>([])
const isDeepSeekReady = ref(false)
const deepseekForm = reactive({ apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' })
const modelSaveMsg = ref('')
const modelSaveOk = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null

const canLaunch = computed(() => !!selectedProjectId.value && !!requirement.value.trim() && !isRunning.value)
const canCopyCodexPrompt = computed(() => !!selectedProjectId.value && !!requirement.value.trim())
const artifactDoneCount = computed(() => artifactScan.value?.stages.filter(stage => stage.exists).length || 0)
const availableModelCount = computed(() => availableModels.value.filter(model => model.available).length)
const relayStagesWithArtifacts = computed(() => {
  const scanned = new Map((artifactScan.value?.stages || []).map(stage => [stage.id, stage]))
  return (relayPlan.value?.stages || []).map(stage => scanned.get(stage.id) || {
    ...stage,
    path: artifactPath(stage.artifactFile),
    exists: false,
    size: 0,
  })
})
const launchHint = computed(() => {
  if (!selectedProjectId.value) return '请选择目标项目'
  if (!requirement.value.trim()) return '请输入需求描述'
  return ''
})

onMounted(async () => {
  await refreshAll()
  await refreshRelayPlan()
})

async function refreshAll() {
  refreshing.value = true
  try {
    const [stages, runList, knowledgeList, models, projectList, artifactRunList] = await Promise.all([
      listStageDefinitions(),
      listPipelineRuns(),
      listKnowledge(),
      getModels(),
      getProjects(),
      listArtifactRuns(),
    ])
    stageDefs.value = stages
    runs.value = runList
    knowledge.value = knowledgeList
    availableModels.value = models.models
    isDeepSeekReady.value = models.models.find((model: ModelInfo) => model.id === 'deepseek-chat')?.available || false
    if (models.config?.deepseek) {
      deepseekForm.baseUrl = models.config.deepseek.baseUrl
      deepseekForm.model = models.config.deepseek.model
    }
    projects.value = (projectList as any)?.data || projectList
    artifactRuns.value = artifactRunList
  } finally {
    refreshing.value = false
  }
}

async function refreshArtifactRuns() {
  artifactRuns.value = await listArtifactRuns()
}

async function openArtifactRun(runId: string) {
  relayRunId.value = runId
  relayPlan.value = await getRelayPlan(runId)
  artifactScan.value = await scanArtifacts(runId)
  selectUnfinishedStages()
  await refreshArtifactRuns()
}

async function refreshRelayPlan() {
  relayPlan.value = await getRelayPlan(relayRunId.value || undefined, baseEngine.value)
  if (!relayRunId.value) relayRunId.value = relayPlan.value.runId
  if (relayRunId.value) await refreshArtifacts()
}

async function refreshArtifacts() {
  if (!relayRunId.value) return
  artifactScan.value = await scanArtifacts(relayRunId.value)
  if (relayPlan.value) {
    relayPlan.value = {
      ...relayPlan.value,
      artifactRoot: artifactScan.value.artifactRoot,
      runDir: artifactScan.value.runDir,
      runId: artifactScan.value.runId,
    }
  }
  await refreshArtifactRuns()
}

async function ensureRelayId() {
  if (!relayRunId.value && requirement.value.trim()) {
    await generateRelayId()
  }
}

async function generateRelayId() {
  if (!requirement.value.trim()) return
  const result = await createRelayRunId(requirement.value, selectedProjectId.value === '__ai-platform__' ? undefined : selectedProjectId.value, baseEngine.value)
  relayRunId.value = result.runId
  await refreshRelayPlan()
  await refreshArtifactRuns()
}

function artifactPath(file: string) {
  const base = relayPlan.value?.runDir || ''
  return base ? `${base}/${file}` : file
}

function artifactStageIndex(stageId: string) {
  const index = relayPlan.value?.stages.findIndex(stage => stage.id === stageId) ?? -1
  return index >= 0 ? index + 1 : ''
}

function selectUnfinishedStages() {
  selectedArtifactStageIds.value = artifactScan.value?.stages.filter(stage => !stage.exists).map(stage => stage.id) || []
}

function toggleArtifactStage(stageId: string) {
  selectedArtifactStageIds.value = selectedArtifactStageIds.value.includes(stageId)
    ? selectedArtifactStageIds.value.filter(id => id !== stageId)
    : [...selectedArtifactStageIds.value, stageId]
}

function currentArtifactRun() {
  return artifactRuns.value.find(run => run.runId === artifactScan.value?.runId)
}

function adaptStages(stages: PipelineStageRun[]): StepRun[] {
  return stages.map(stage => ({
    stepId: stageDefs.value.find(def => def.id === stage.stageId)?.name || stage.stageId,
    status: stage.status,
    output: stage.output,
    error: stage.error,
    attempts: 0,
  }))
}

function formatTime(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function shortText(text = '', length = 60) {
  return text.length > length ? `${text.slice(0, length)}...` : text
}

function getProjectName(id?: string) {
  if (!id || id === '__ai-platform__') return '本系统'
  return projects.value.find(project => project.id === id)?.name || id
}

function openHistoryRun(id: string) {
  expandedRun.value = id
  expandedHistStage.value = -1
  tab.value = 'history'
}

function toggleRun(id: string) {
  expandedRun.value = expandedRun.value === id ? null : id
  expandedHistStage.value = -1
}

function pushLog(type: string, text: string) {
  liveLogs.value.push({
    type,
    text,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  })
}

async function copyStagePrompt(index: number) {
  const stage = stageDefs.value[index]
  if (!stage || !requirement.value.trim()) return
  try {
    const result = await generatePrompt(stage.id, requirement.value, selectedProjectId.value || undefined)
    await navigator.clipboard.writeText(result.prompt)
    copiedIndex.value = index
    setTimeout(() => { copiedIndex.value = null }, 1600)
  } catch (e: any) {
    window.alert('生成提示词失败: ' + e.message)
  }
}

async function copyRelayPrompt(stageId: string) {
  if (!requirement.value.trim()) return
  await ensureRelayId()
  try {
    const result = await generatePrompt(
      stageId,
      requirement.value,
      selectedProjectId.value === '__ai-platform__' ? undefined : selectedProjectId.value,
      relayRunId.value,
      'relay',
      baseEngine.value,
    )
    if (result.runId && result.runId !== relayRunId.value) relayRunId.value = result.runId
    await navigator.clipboard.writeText(result.prompt)
    copiedStageId.value = stageId
    setTimeout(() => { copiedStageId.value = null }, 1600)
    await refreshRelayPlan()
  } catch (e: any) {
    window.alert('生成接力提示词失败: ' + e.message)
  }
}

async function copyArtifactStagePrompt(stageId: string) {
  if (!artifactScan.value?.runId) return
  const run = currentArtifactRun()
  const req = run?.requirement || requirement.value || '请先读取已有产物，恢复本次需求上下文。'
  try {
    const result = await generatePrompt(
      stageId,
      req,
      run?.projectId,
      artifactScan.value.runId,
      'relay',
    )
    await navigator.clipboard.writeText(result.prompt)
    copiedStageId.value = stageId
    setTimeout(() => { copiedStageId.value = null }, 1600)
  } catch (e: any) {
    window.alert('生成阶段提示词失败: ' + e.message)
  }
}

async function copyContinuationPrompt() {
  if (!artifactScan.value?.runId || !selectedArtifactStageIds.value.length) return
  const run = currentArtifactRun()
  try {
    const result = await generateContinuationPrompt(
      artifactScan.value.runId,
      selectedArtifactStageIds.value,
      run?.requirement || requirement.value || undefined,
      run?.projectId,
    )
    await navigator.clipboard.writeText(result.prompt)
    continuationCopied.value = true
    setTimeout(() => { continuationCopied.value = false }, 1800)
  } catch (e: any) {
    window.alert('生成继续执行总控提示词失败: ' + e.message)
  }
}

async function copyAllPrompts() {
  if (!requirement.value.trim()) return
  copyingAll.value = true
  try {
    const parts: string[] = []
    for (let index = 0; index < stageDefs.value.length; index++) {
      const stage = stageDefs.value[index]
      const result = await generatePrompt(stage.id, requirement.value, selectedProjectId.value || undefined)
      parts.push(`======== 第 ${index + 1} 阶段: ${stage.name} (${stage.id}) ========\n\n${result.prompt}`)
    }
    const fullText = `# 自动开发流水线提示词\n\n## 需求\n${requirement.value}\n\n${parts.join('\n\n')}`
    await navigator.clipboard.writeText(fullText)
  } catch (e: any) {
    window.alert('生成提示词失败: ' + e.message)
  } finally {
    copyingAll.value = false
  }
}

async function copyAllRelayPrompts() {
  if (!requirement.value.trim()) return
  await ensureRelayId()
  copyingAll.value = true
  try {
    const parts: string[] = []
    for (const stage of relayPlan.value?.stages || []) {
      const result = await generatePrompt(
        stage.id,
        requirement.value,
        selectedProjectId.value === '__ai-platform__' ? undefined : selectedProjectId.value,
        relayRunId.value,
        'relay',
        baseEngine.value,
      )
      parts.push(`======== ${stage.name} / ${stage.ownerLabel} ========\n\n${result.prompt}`)
    }
    await navigator.clipboard.writeText(parts.join('\n\n'))
  } catch (e: any) {
    window.alert('生成接力提示词失败: ' + e.message)
  } finally {
    copyingAll.value = false
  }
}

async function copyCodexPrompt() {
  if (!canCopyCodexPrompt.value) return
  await ensureRelayId()
  try {
    const projectId = selectedProjectId.value === '__ai-platform__' ? undefined : selectedProjectId.value
    const result = baseEngine.value === 'claudecode'
      ? await generateClaudeCodePrompt(requirement.value, projectId, relayRunId.value)
      : await generateCodexPrompt(requirement.value, projectId, relayRunId.value)
    await navigator.clipboard.writeText(result.prompt)
    codexCopied.value = true
    setTimeout(() => { codexCopied.value = false }, 1800)
  } catch (e: any) {
    window.alert('生成总控提示词失败: ' + e.message)
  }
}

function startNewPipeline() {
  if (!canLaunch.value) return
  isRunning.value = true
  liveLogs.value = []
  currentRun.value = null
  expandedStage.value = -1
  tab.value = 'new'

  const projectId = selectedProjectId.value === '__ai-platform__' ? undefined : selectedProjectId.value
  const { promise } = runPipeline(requirement.value, projectId, handlePipelineEvent)
  promise.catch((e: any) => {
    pushLog('error', '启动失败: ' + e.message)
    isRunning.value = false
    stopPolling()
  })
}

function handlePipelineEvent(event: PipelineSSEEvent) {
  if (event.type === 'pipeline:start') {
    currentRun.value = {
      id: event.runId || '',
      requirement: requirement.value,
      projectId: selectedProjectId.value,
      status: 'running',
      stages: stageDefs.value.map(stage => ({
        stageId: stage.id,
        status: 'pending',
        input: {},
        output: {},
      })),
      context: {},
      startedAt: new Date().toISOString(),
      currentStageIndex: 0,
    }
    pushLog('info', '流水线已启动')
    if (event.runId) startPolling(event.runId)
  }

  if (event.type === 'stage:start') {
    const index = event.index ?? 0
    if (currentRun.value?.stages[index]) {
      currentRun.value.stages[index].status = 'running'
      currentRun.value.currentStageIndex = index
    }
    pushLog('info', `阶段 ${index + 1}: ${event.name || event.stageId} 开始`)
  }

  if (event.type === 'stage:done') {
    const index = event.index ?? 0
    const status = event.status === 'success' ? 'success' : 'failed'
    if (currentRun.value?.stages[index]) {
      currentRun.value.stages[index].status = status
      if (event.output) currentRun.value.stages[index].output = event.output
      if (event.error) currentRun.value.stages[index].error = event.error
    }
    pushLog(status === 'success' ? 'success' : 'error', `阶段 ${event.stageId} ${status === 'success' ? '完成' : '失败'}`)
  }

  if (event.type === 'stage:gate') {
    const index = event.index ?? 0
    if (currentRun.value?.stages[index]) currentRun.value.stages[index].status = 'waiting_confirm'
    pushLog('warn', `阶段 ${event.stageId} 等待人工确认`)
  }

  if (event.type === 'pipeline:done') {
    if (currentRun.value) currentRun.value.status = 'completed'
    pushLog('success', '流水线已完成')
    stopPolling()
    finishPipeline()
  }

  if (event.type === 'pipeline:failed') {
    if (currentRun.value) currentRun.value.status = 'failed'
    pushLog('error', `流水线失败: ${event.error || ''}`)
    stopPolling()
    finishPipeline()
  }
}

function startPolling(runId: string) {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const run = await getPipelineRun(runId)
      if (!run || !currentRun.value) return
      currentRun.value.status = run.status
      currentRun.value.currentStageIndex = run.currentStageIndex
      run.stages.forEach((src, index) => {
        const dst = currentRun.value?.stages[index]
        if (!dst) return
        if (dst.status !== src.status) {
          pushLog(statusLogType(src.status), `阶段 ${stageDefs.value[index]?.name || src.stageId}: ${statusText(src.status)}`)
        }
        dst.status = src.status
        if (src.output && Object.keys(src.output).length) dst.output = src.output
        if (src.error) dst.error = src.error
      })
      if (['completed', 'failed', 'aborted'].includes(run.status)) {
        stopPolling()
        finishPipeline()
      }
    } catch {
      // Polling is a fallback channel; transient failures can be ignored.
    }
  }, 5000)
}

function statusLogType(status: string) {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'waiting_confirm') return 'warn'
  return 'info'
}

function statusText(status: string) {
  const map: Record<string, string> = {
    pending: '待执行',
    running: '执行中',
    success: '完成',
    failed: '失败',
    waiting_confirm: '等待确认',
    skipped: '已跳过',
  }
  return map[status] || status
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function finishPipeline() {
  isRunning.value = false
  await refreshAll()
}

async function confirmStage(runId: string) {
  try {
    await apiConfirm(runId)
    runs.value = await listPipelineRuns()
  } catch (e: any) {
    window.alert('操作失败: ' + e.message)
  }
}

async function abortRun(runId: string) {
  if (!window.confirm('确定中止此流水线？')) return
  try {
    await apiAbort(runId)
    runs.value = await listPipelineRuns()
  } catch (e: any) {
    window.alert('操作失败: ' + e.message)
  }
}

async function deleteRun(runId: string) {
  if (!window.confirm('确定删除这条流水线历史记录？')) return
  try {
    await apiDeleteRun(runId)
    runs.value = runs.value.filter(run => run.id !== runId)
    if (expandedRun.value === runId) expandedRun.value = null
    if (currentRun.value?.id === runId) {
      currentRun.value = null
      isRunning.value = false
      stopPolling()
    }
  } catch (e: any) {
    window.alert('删除失败: ' + e.message)
  }
}

async function resumeRun(runId: string) {
  try {
    const { promise } = apiResume(runId, (event: PipelineSSEEvent) => {
      pushLog('info', `[恢复] ${event.type}`)
    })
    await promise
    runs.value = await listPipelineRuns()
  } catch (e: any) {
    window.alert('恢复失败: ' + e.message)
  }
}

async function switchBaseEngine(engine: 'codex' | 'claudecode') {
  baseEngine.value = engine
  relayRunId.value = ''
  await refreshRelayPlan()
}

async function saveModelConfig() {
  try {
    await updateModelConfig({
      apiKey: deepseekForm.apiKey,
      baseUrl: deepseekForm.baseUrl,
      model: deepseekForm.model,
    })
    modelSaveMsg.value = '配置已保存'
    modelSaveOk.value = true
    const models = await getModels()
    availableModels.value = models.models
    isDeepSeekReady.value = models.models.find((model: ModelInfo) => model.id === 'deepseek-chat')?.available || false
    setTimeout(() => { modelSaveMsg.value = '' }, 3000)
  } catch (e: any) {
    modelSaveMsg.value = '保存失败: ' + e.message
    modelSaveOk.value = false
  }
}

</script>

<style scoped>
.pipeline-page {
  padding: 24px 32px;
  max-width: 1240px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}
.page-header h1 {
  margin: 0;
  font-size: 24px;
  color: #182033;
}
.page-desc {
  margin: 6px 0 0;
  color: #667085;
  font-size: 13px;
}
.header-actions,
.config-actions,
.run-actions,
.launch-panel {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ops-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.ops-item {
  background: #fff;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  padding: 14px 16px;
}
.ops-label {
  display: block;
  color: #7a8494;
  font-size: 12px;
  margin-bottom: 6px;
}
.ops-item strong {
  font-size: 24px;
  color: #182033;
}
.ops-item .ops-code {
  display: block;
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #e8edf3;
  margin-bottom: 18px;
}
.tab {
  border: none;
  background: transparent;
  padding: 11px 18px;
  color: #667085;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 14px;
}
.tab.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
  font-weight: 600;
}
.pill {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 9px;
  background: #eef4ff;
  color: #2563eb;
  font-size: 11px;
}
.overview-grid,
.models-layout {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
}
.new-layout,
.history-list,
.knowledge-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.artifact-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(0, 2fr);
  gap: 16px;
  align-items: start;
}
.artifact-sidebar {
  position: sticky;
  top: 16px;
}
.artifact-run {
  display: grid;
  width: 100%;
  gap: 5px;
  border: 1px solid #eef1f5;
  border-radius: 8px;
  background: #fbfcfe;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}
.artifact-run + .artifact-run {
  margin-top: 8px;
}
.artifact-run.active {
  border-color: #9ec5ff;
  background: #eef4ff;
}
.artifact-run strong {
  color: #182033;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artifact-run span,
.artifact-run time {
  color: #667085;
  font-size: 12px;
}
.artifact-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.stage-check {
  width: 18px;
  height: 18px;
  margin: 0;
}
.empty.compact {
  padding: 18px;
}
.panel,
.run-card {
  background: #fff;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  padding: 18px;
}
.handoff-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  background: #f6fbf8;
  border: 1px solid #bfe8d1;
  border-radius: 8px;
  padding: 18px;
}
.handoff-panel h2 {
  margin: 0 0 6px;
  color: #063f2a;
  font-size: 16px;
}
.handoff-panel p {
  margin: 0;
  color: #32604b;
  font-size: 13px;
  line-height: 1.6;
}
.handoff-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.panel.wide {
  grid-row: span 2;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.panel-head h2 {
  margin: 0;
  font-size: 15px;
  color: #182033;
}
.muted {
  color: #98a2b3;
  font-size: 12px;
}
.stage-roadmap,
.prompt-grid,
.model-grid,
.relay-grid {
  display: grid;
  gap: 10px;
}
.stage-roadmap {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.roadmap-card,
.prompt-card,
.mini-run,
.model-card {
  border: 1px solid #eef1f5;
  border-radius: 8px;
  background: #fbfcfe;
}
.roadmap-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
}
.roadmap-index,
.prompt-step,
.stage-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #e8f5f0;
  color: #087443;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.roadmap-card p,
.prompt-card p {
  margin: 3px 0 0;
  color: #98a2b3;
  font-size: 12px;
}
.gate-tag {
  margin-left: auto;
  color: #b45309;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 11px;
}
.mini-run {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 10px;
  cursor: pointer;
}
.mini-run span {
  min-width: 0;
  color: #344054;
  font-size: 13px;
}
.mini-run time,
.run-meta,
.detail-meta {
  color: #98a2b3;
  font-size: 12px;
}
.insight-list {
  margin: 0;
  padding-left: 18px;
  color: #475467;
  font-size: 13px;
  line-height: 1.7;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.toggle-group {
  display: flex;
  gap: 0;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  overflow: hidden;
}
.toggle-btn {
  flex: 1;
  padding: 8px 16px;
  border: none;
  background: #fff;
  color: #344054;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.toggle-btn + .toggle-btn {
  border-left: 1px solid #d0d5dd;
}
.toggle-btn.active {
  background: #182033;
  color: #fff;
}
.toggle-btn:not(.active):hover {
  background: #f9fafb;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #344054;
  font-size: 13px;
  font-weight: 600;
}
.field b {
  color: #d92d20;
}
.span-2 {
  grid-column: span 2;
}
select,
input,
textarea {
  width: 100%;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  padding: 9px 11px;
  font: inherit;
  color: #182033;
  background: #fff;
}
textarea {
  resize: vertical;
  min-height: 110px;
}
select:focus,
input:focus,
textarea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}
.path-row {
  display: flex;
  gap: 8px;
}
.path-row button {
  width: 38px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #344054;
  font-size: 13px;
}
.check-row input {
  width: auto;
}
.check-row em {
  color: #d92d20;
  font-style: normal;
  font-size: 12px;
}
.prompt-grid,
.model-grid {
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
}
.relay-grid {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.relay-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  background: #fbfcfe;
  padding: 14px;
}
.relay-card.done {
  border-color: #9edcc2;
  background: #f7fcf9;
}
.relay-top {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
}
.relay-top strong {
  color: #182033;
  font-size: 14px;
}
.relay-top p,
.relay-purpose {
  margin: 0;
  color: #667085;
  font-size: 12px;
  line-height: 1.5;
}
.relay-purpose {
  min-height: 36px;
}
.artifact-state {
  padding: 2px 7px;
  border-radius: 999px;
  background: #f2f4f7;
  color: #667085;
  font-size: 11px;
  white-space: nowrap;
}
.artifact-state.ok {
  background: #dcfae6;
  color: #087443;
}
.artifact-path,
.artifact-file {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.artifact-path {
  margin-bottom: 10px;
}
.artifact-path.run-dir {
  margin-bottom: 14px;
}
.artifact-path span,
.artifact-file span {
  color: #98a2b3;
  font-size: 12px;
}
.artifact-path code,
.artifact-file code {
  overflow: hidden;
  border: 1px solid #e8edf3;
  border-radius: 7px;
  background: #fff;
  color: #344054;
  padding: 7px 9px;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artifact-preview {
  max-height: 130px;
}
.relay-actions {
  display: flex;
  justify-content: flex-end;
}
.prompt-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
}
.prompt-card > div {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 9px;
}
.prompt-card p {
  grid-column: 2;
}
.btn-primary,
.btn-ghost,
.link-btn {
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
}
.btn-primary {
  border: none;
  background: #2563eb;
  color: #fff;
  padding: 11px 24px;
  font-weight: 600;
}
.btn-primary.compact {
  padding: 8px 16px;
  font-size: 13px;
}
.btn-ghost {
  border: 1px solid #d0d5dd;
  background: #fff;
  color: #344054;
  padding: 8px 14px;
}
.btn-ghost.compact {
  padding: 6px 10px;
  font-size: 12px;
}
.btn-ghost.success {
  color: #087443;
  border-color: #9edcc2;
}
.btn-ghost.danger {
  color: #d92d20;
  border-color: #f3b8b0;
}
.link-btn {
  border: none;
  background: transparent;
  color: #2563eb;
  padding: 4px 0;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.launch-panel {
  justify-content: flex-start;
}
.launch-hint {
  color: #b45309;
  font-size: 13px;
}
.run-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  color: #344054;
}
.stage-detail-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.stage-detail-item {
  border: 1px solid #eef1f5;
  border-radius: 8px;
  overflow: hidden;
}
.stage-detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: #fbfcfe;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
}
.stage-name {
  flex: 1;
  color: #344054;
  font-weight: 600;
}
.stage-arrow {
  color: #98a2b3;
  font-size: 12px;
}
.stage-detail-body {
  padding: 12px;
  border-top: 1px solid #eef1f5;
}
.detail-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
}
.detail-label {
  color: #667085;
  font-size: 12px;
}
pre {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: #f7f9fc;
  border-radius: 8px;
  padding: 10px;
  color: #344054;
  font-size: 12px;
}
.detail-block.error pre {
  background: #fff1f0;
  color: #b42318;
}
.detail-meta {
  display: flex;
  gap: 14px;
}
.log-box {
  max-height: 320px;
  overflow: auto;
  background: #111827;
  border-radius: 8px;
  padding: 12px;
}
.log-line {
  display: flex;
  gap: 10px;
  padding: 3px 0;
  color: #cbd5e1;
  font-family: Consolas, monospace;
  font-size: 12px;
}
.log-line time {
  color: #64748b;
  flex-shrink: 0;
}
.log-line.success { color: #86efac; }
.log-line.error { color: #fca5a5; }
.log-line.warn { color: #fcd34d; }
.log-line.info { color: #93c5fd; }
.run-card {
  padding: 0;
  overflow: hidden;
}
.run-header {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 0;
}
.run-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 14px 18px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.run-main:hover {
  background: #fbfcfe;
}
.run-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.run-title strong {
  min-width: 0;
  overflow: hidden;
  color: #344054;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  color: #98a2b3;
  font-size: 12px;
}
.run-project {
  padding: 2px 7px;
  border-radius: 5px;
  background: #eef4ff;
  color: #2563eb;
}
.run-expand {
  color: #667085;
}
.icon-action {
  align-self: center;
  margin-right: 12px;
  padding: 6px 10px;
  border: 1px solid #e8edf3;
  border-radius: 7px;
  background: #fff;
  color: #667085;
  cursor: pointer;
  font-size: 12px;
}
.icon-action:hover {
  border-color: #cfd7e3;
  background: #f8fafc;
}
.icon-action.danger {
  border-color: #f3b8b0;
  color: #d92d20;
}
.icon-action.danger:hover {
  background: #fff1f0;
}
.btn-ghost.subtle {
  background: #fff;
}
.run-body {
  padding: 0 18px 16px;
  border-top: 1px solid #eef1f5;
}
.model-card {
  padding: 14px;
}
.model-card.off {
  opacity: 0.56;
}
.model-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.model-top span {
  color: #667085;
  font-size: 11px;
  text-transform: uppercase;
}
.model-card strong {
  display: block;
  color: #182033;
  margin-bottom: 5px;
}
.model-card code {
  color: #667085;
  font-size: 12px;
}
.save-msg {
  font-size: 13px;
}
.save-msg.ok {
  color: #087443;
}
.save-msg.err {
  color: #d92d20;
}
.empty {
  color: #98a2b3;
  text-align: center;
  padding: 36px;
  font-size: 14px;
}
@media (max-width: 900px) {
  .page-header,
  .run-header,
  .run-summary,
  .handoff-panel {
    flex-direction: column;
    align-items: stretch;
  }
  .handoff-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .run-main {
    flex-direction: column;
    align-items: stretch;
  }
  .run-meta {
    flex-wrap: wrap;
  }
  .ops-strip,
  .overview-grid,
  .models-layout,
  .artifact-layout,
  .stage-roadmap,
  .relay-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: span 1;
  }
}
</style>
