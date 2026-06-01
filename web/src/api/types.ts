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
  amapKey?: string
  uploadDir?: string
  druidUser?: string
  druidPassword?: string
  helperDialect?: string
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
  type: 'scene' | 'capability'
  tags?: string[]
  dependencies?: string[]
  content?: string
  allowedTools?: string[]
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
