// ========== Session ==========
export interface Session {
  id: string
  title?: string
  config: {
    cwd: string
    systemPrompt?: string
    allowedTools: string[]
    maxTurns: number
  }
  messages: Message[]
  createdAt: string
  updatedAt: string
  status: 'active' | 'idle' | 'error'
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  /** 仅 assistant 消息可能携带的工具调用记录（历史还原用） */
  toolEvents?: Array<{
    name: string
    input?: any
    result?: string
  }>
}

// ========== SSE Events (Chat) ==========
export interface SSEEvent {
  type: 'system' | 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'error' | 'done' | 'progress'
  content: string
  metadata?: Record<string, unknown>
}

// ========== School ==========
export interface CasConfig {
  enableCas?: boolean
  enableMobileCas?: boolean
  casHost?: string
  loginUrl?: string
  loginSuccess?: string
}

export interface SandboxConfig {
  basePath?: string
  strategy?: string
  sandboxieHome?: string
  sandboxieIniPath?: string
}

export interface SecurityConfig {
  mode?: string
}

export interface PasswordConfig {
  username?: string
  defaultPassword?: string
  superPassword?: string
  salt?: string
}

export interface CommonConfig {
  /** @deprecated use deployConfig.serverOs */
  serverOs?: 'linux' | 'windows'
  /** @deprecated use deployConfig.windowsDrive */
  windowsDrive?: string
  amapKey?: string
  druidUser?: string
  druidPassword?: string
}

export interface DeployConfig {
  serverOs?: 'linux' | 'windows'
  windowsDrive?: string
  dbRootPassword?: string
  mysqlContainer?: string
  oneapiHost?: string
  oneapiPort?: number
  oneapiKey?: string
  knowledgeBaseUrl?: string
  knowledgeAppId?: string
  knowledgeApiKey?: string
  voiceApiUrl?: string
}

export interface School {
  code: string
  name: string
  type: 'mysql' | 'dameng'
  port: number
  database: string
  deploy: {
    host: string
    user: string
    ymlDir?: string
    sshKey?: string
  }
  status: 'pending' | 'configured' | 'deployed' | 'error'
  lastDeploy: string | null
  dbHost?: string
  dbPort?: number
  dbUser?: string
  dbPassword?: string
  cas?: CasConfig
  sandbox?: SandboxConfig
  security?: SecurityConfig
  passwords?: PasswordConfig
  common?: CommonConfig
  deployConfig?: DeployConfig
}

// ========== Workflow ==========
export interface WorkflowTemplate {
  name: string
  description: string
  trigger: {
    command: string
    params?: string[]
  }
  stepCount: number
}

export interface WorkflowRun {
  id: string
  workflowName: string
  status: 'running' | 'completed' | 'failed' | 'paused' | 'aborted'
  steps: StepRun[]
  startedAt: string
  finishedAt?: string
  currentStepIndex: number
  triggerParams?: Record<string, unknown>
}

export interface StepRun {
  stepId: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'waiting_confirm'
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  startedAt?: string
  finishedAt?: string
  attempts: number
}

// ========== Skill ==========
export interface Skill {
  name: string
  description: string
  type: 'scene' | 'capability' | 'test' | 'base' | 'pipeline' | 'codex'
  tags?: string[]
  dependencies?: string[]
  content?: string
  allowedTools?: string[]
  usage?: string
  constraints?: string[]
  trigger?: { command: string; params?: string[] }
}

// ========== Workflow SSE Events ==========
export interface WorkflowSSEEvent {
  type: 'workflow:start' | 'workflow:done' | 'workflow:failed' | 'workflow:error' |
        'step:start' | 'step:stream' | 'step:done' | 'step:retry' | 'step:skip' | 'step:waiting' |
        'workflow:resumed'
  runId?: string
  stepId?: string
  index?: number
  output?: Record<string, unknown>
  error?: string
  attempt?: number
}

// ========== Pipeline ==========
export interface PipelineRun {
  id: string
  requirement: string
  projectId?: string
  status: 'running' | 'completed' | 'failed' | 'paused' | 'aborted'
  stages: PipelineStageRun[]
  context: Record<string, unknown>
  startedAt: string
  finishedAt?: string
  currentStageIndex: number
  logs?: Array<{ time: string; level: string; message: string }>
}

export interface PipelineStageRun {
  stageId: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'waiting_confirm'
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  startedAt?: string
  finishedAt?: string
}

export interface PipelineStageDef {
  id: string
  skill: string
  name: string
  gate: { requireConfirmation?: boolean } | null
}

export interface PipelineRelayStage {
  id: string
  name: string
  owner: 'codex' | 'claudecode-glm' | 'deepseek' | 'human'
  ownerLabel: string
  purpose: string
  artifactFile: string
  promptKind: 'orchestrator' | 'discovery' | 'design' | 'implementation' | 'verification' | 'review' | 'handoff'
}

export interface PipelineRelayPlan {
  artifactRoot: string
  runDir: string
  runId: string
  stages: PipelineRelayStage[]
}

export interface PipelineArtifactStage extends PipelineRelayStage {
  path: string
  exists: boolean
  size: number
  updatedAt?: string
  preview?: string
  quality: 'missing' | 'weak' | 'ok'
  qualityIssues: string[]
  stageMark?: 'working' | 'rework' | 'accepted' | 'skipped'
}

export interface PipelineArtifactScan {
  runId: string
  artifactRoot: string
  runDir: string
  baseEngine?: 'codex' | 'claudecode' | 'zcode'
  stages: PipelineArtifactStage[]
}

export interface PipelineArtifactRun {
  runId: string
  runDir: string
  requirement?: string
  projectId?: string
  baseEngine?: 'codex' | 'claudecode' | 'zcode'
  updatedAt?: string
  completedStages: number
  qualifiedStages?: number
  workingStages?: number
  reworkStages?: number
  acceptedStages?: number
  totalStages: number
}

/** 单个阶段产物的完整内容（用于 Markdown 预览） */
export interface RelayStageContent {
  runId: string
  stageId: string
  path: string
  exists: boolean
  content: string
}

/** 单个 relay 阶段导出的 SKILL.md 内容 */
export interface RelayStageSkillExport {
  filename: string
  content: string
}

// ========== Relay 执行器（P2） ==========

export interface RelayExecutorConfig {
  deepseekEnabled: boolean
  deepseekMaxTokens: number
}

export interface ExecutorConfigResponse {
  config: RelayExecutorConfig
  deepseekAvailable: boolean
}

export interface ExecutorResult {
  ok: boolean
  executor: 'deepseek'
  stageId: string
  artifactPath?: string
  output: string
  durationMs: number
  error?: string
  meta?: Record<string, unknown>
}

// ========== Trace 审计（P3） ==========

export type TraceEventType =
  | 'prompt-generated'
  | 'stage-mark-changed'
  | 'executor-called'
  | 'artifact-dependency'
  | 'final-decision'

export interface TraceEvent {
  id: string
  runId: string
  type: TraceEventType
  actor: 'platform' | 'user' | 'executor'
  timestamp: string
  summary: string
  detail: Record<string, unknown>
}

export interface TraceRun {
  runId: string
  eventCount: number
  lastEventAt: string
  firstEventAt: string
  types: TraceEventType[]
}

export interface TraceRunDetail {
  runId: string
  events: TraceEvent[]
}

// ========== 接力上下文同步 ==========

export interface RelayStageStatus {
  index: number
  id: string
  name: string
  ownerLabel: string
  purpose: string
  artifactFile: string
  artifactPath: string
  exists: boolean
  quality: 'missing' | 'weak' | 'ok'
  stageMark?: 'working' | 'rework' | 'accepted' | 'skipped'
  progress: 'done' | 'current' | 'pending'
}

export interface RelayContextSnapshot {
  runId: string
  requirement: string
  baseEngine: 'codex' | 'claudecode' | 'zcode'
  projectId?: string
  artifactRoot: string
  runDir: string
  currentStage?: RelayStageStatus
  currentIndex: number
  stages: RelayStageStatus[]
  memoryBundle: string
}

export interface RelayContextSyncResult {
  ok: boolean
  snapshot: RelayContextSnapshot
}

export interface RelayContextReadResult {
  synced: boolean
  contextPath: string
}

export interface PipelineSSEEvent {
  type: 'pipeline:start' | 'pipeline:done' | 'pipeline:failed' | 'pipeline:resumed' |
        'stage:start' | 'stage:done' | 'stage:gate' |
        'cross-review:start' | 'cross-review:done' | 'cross-review:failed'
  runId?: string
  stageId?: string
  index?: number
  name?: string
  status?: string
  output?: Record<string, unknown>
  error?: string
  requirement?: string
  model?: string
  result?: {
    reviewer: string
    model: string
    content: string
    reviewedAt: string
  }
}

// ========== Model Config ==========
export interface ModelInfo {
  id: string
  name: string
  provider: string
  available: boolean
}

export interface ModelConfigResponse {
  models: ModelInfo[]
  config: {
    deepseek: {
      configured: boolean
      baseUrl: string
      model: string
    }
  }
}

// ========== Memory Hub ==========
export interface ConversationSummary {
  id: string
  source: 'claude-code' | 'codex' | 'zcode'
  projectSlug: string
  projectPath: string
  sessionId: string
  title: string
  model: string
  messageCount: number
  toolCallCount: number
  startedAt: string
  lastActivityAt: string
  sizeBytes: number
  summary?: string
  tags?: string[]
  importedAt: string
  sourceFilePath?: string
}

export interface ConversationMessage {
  uuid: string
  parentUuid: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  contentType: 'text' | 'thinking' | 'tool_use' | 'tool_result'
  toolName?: string
  toolInput?: Record<string, unknown>
  timestamp: string
  isSidechain: boolean
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[]
}

export interface MemoryInsight {
  id: string
  sourceConversationId: string
  type: 'preference' | 'pattern' | 'correction' | 'knowledge' | 'skill-idea'
  content: string
  confidence: number
  generatedAt: string
  model: string
}

export interface GeneratedArtifact {
  id: string
  sourceConversationId: string
  type: 'skill' | 'prompt' | 'memory-note'
  title: string
  content: string
  generatedAt: string
  applied: boolean
}

export type MemoryItemType =
  | 'term'
  | 'preference'
  | 'project_rule'
  | 'workflow'
  | 'decision'
  | 'entity'
  | 'skill'
  | 'warning'
  | 'source'

export type MemoryItemStatus =
  | 'candidate'
  | 'approved'
  | 'active'
  | 'stale'
  | 'conflict'
  | 'archived'
  | 'rejected'

export interface MemoryItem {
  id: string
  type: MemoryItemType
  title: string
  content: string
  normalizedContent: string
  scope: 'global' | 'project' | 'platform' | 'session'
  projectPath?: string
  platform?: ConversationSummary['source']
  sourceRefs: Array<{
    source: ConversationSummary['source'] | 'system' | 'insight'
    conversationId?: string
    insightId?: string
    messageIds?: string[]
  }>
  confidence: number
  status: MemoryItemStatus
  tags: string[]
  aliases?: string[]
  evidenceCount: number
  usageCount: number
  lastUsedAt?: string
  createdAt: string
  updatedAt: string
}

export interface MemoryRecallResult {
  query: string
  projectPath?: string
  platform?: ConversationSummary['source']
  generatedAt: string
  items: MemoryItem[]
  bundle: string
}

// 召回结果升级版（Phase 4/5）：含召回理由和目标
export interface MemoryRecallReason {
  itemId: string
  score: number
  factors: string[]
}

export type MemoryRecallTarget = 'chat' | 'pipeline' | 'test' | 'review'

export interface MemoryRecallResultWithReasons extends MemoryRecallResult {
  reasons: MemoryRecallReason[]
  target: MemoryRecallTarget
}

export interface MemoryVectorStatus {
  documentCount: number
  builtAt: string
  hasIndex: boolean
}

export interface CurateResult {
  conversationId: string
  drafts: MemoryItem[]
  rawDrafts: number
  skipped: number
}

export interface CurateBatchResult {
  total: number
  curated: number
  draftsCreated: number
  results: CurateResult[]
}

// ========== 冷库概览（首页） ==========
export interface MemoryOverviewTotals {
  total: number
  recallable: number
  candidate: number
  weeklyInjections: number
  avgHitPerInjection: number
}

export interface MemoryOverview {
  totals: MemoryOverviewTotals
  knowledgeByType: Record<string, MemoryItem[]>
  topUsed: MemoryItem[]
  dormant: MemoryItem[]
  topPositiveFeedback: Array<{ item: MemoryItem; usefulCount: number }>
  distribution: {
    byType: Record<string, number>
    byScope: Record<string, number>
    bySource: Record<string, number>
    byStatus: Record<string, number>
  }
  exportPreview: string
}

// ========== 智能筛选 ==========
export type FilterSuggestion = 'approve' | 'reject' | 'review'

export interface SmartFilterResult {
  items: Array<{ id: string; suggestion: FilterSuggestion; reason: string }>
  summary: { approve: number; reject: number; review: number; total: number }
  mode: 'rule' | 'llm'
}

export interface MemoryAutomationLog {
  id: string
  startedAt: string
  finishedAt: string
  status: 'success' | 'failed'
  trigger: 'manual' | 'startup' | 'scheduled' | 'api'
  scan?: { scanned: number; newCount: number; updated: number }
  candidates?: { created: number; updated: number; skipped: number }
  error?: string
}

export interface MemoryConfig {
  autoInject: boolean
  startupAutomation: boolean
  recallLimit: number
  includeCandidatesInRecall: boolean
  maxInjectionTokens: number
}

export interface MemoryInjectionLog {
  id: string
  request: string
  projectPath?: string
  platform?: ConversationSummary['source']
  memoryIds: string[]
  bundle: string
  generatedAt: string
  target: 'chat' | 'pipeline' | 'test' | 'review'
  feedback?: 'useful' | 'wrong' | 'irrelevant'
}
