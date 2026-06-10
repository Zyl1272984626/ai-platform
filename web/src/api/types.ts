// ========== Session ==========
export interface Session {
  id: string
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
  promptKind: 'orchestrator' | 'design' | 'implementation' | 'verification' | 'review' | 'handoff'
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
}

export interface PipelineArtifactScan {
  runId: string
  artifactRoot: string
  runDir: string
  baseEngine?: 'codex' | 'claudecode'
  stages: PipelineArtifactStage[]
}

export interface PipelineArtifactRun {
  runId: string
  runDir: string
  requirement?: string
  projectId?: string
  updatedAt?: string
  completedStages: number
  totalStages: number
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
