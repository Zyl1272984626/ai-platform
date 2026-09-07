import api from './client'

export type DevelopmentTaskKind = 'feature' | 'bug' | 'diagnosis' | 'design' | 'migration' | 'deployment' | 'research'
export type DevelopmentTaskStatus = 'draft' | 'running' | 'needs_confirmation' | 'rework' | 'blocked' | 'awaiting_acceptance' | 'accepted' | 'archived'
export type GateResult = 'pending' | 'pass' | 'fail' | 'blocked' | 'not_applicable'
export type EvidenceType = 'file' | 'command' | 'test' | 'http' | 'browser' | 'database' | 'decision' | 'note' | 'acceptance'

export interface TaskEvidence {
  id: string
  type: EvidenceType
  label: string
  summary: string
  source?: string
  result?: string
  createdAt: string
}

export interface TaskGate {
  id: string
  claim: string
  method: string
  required: boolean
  result: GateResult
  evidenceIds: string[]
  note?: string
  onFail: string
  updatedAt?: string
}

export interface TaskDecision {
  id: string
  question: string
  resolution?: string
  status: 'open' | 'resolved'
  createdAt: string
  resolvedAt?: string
}

export interface TaskEvent {
  id: string
  type: string
  message: string
  createdAt: string
}

export interface DevelopmentTask {
  id: string
  projectId: string
  title: string
  kind: DevelopmentTaskKind
  priority: 'low' | 'medium' | 'high'
  requirement: string
  goal: string
  scope: string
  outOfScope: string
  acceptanceCriteria: string[]
  sourceRefs: string[]
  risks: string[]
  status: DevelopmentTaskStatus
  currentNode: string
  gates: TaskGate[]
  evidence: TaskEvidence[]
  decisions: TaskDecision[]
  events: TaskEvent[]
  createdAt: string
  updatedAt: string
  startedAt?: string
  submittedAt?: string
  acceptedAt?: string
  archivedAt?: string
}

export type GraphStatus = 'planned' | 'running' | 'waiting_human' | 'completed' | 'failed' | 'stopped'
export type GraphNodeStatus = 'pending' | 'runnable' | 'running' | 'waiting_human' | 'completed' | 'failed' | 'skipped'

export interface TaskGraphNode {
  id: string
  name: string
  kind: 'discovery' | 'design' | 'implementation' | 'verification' | 'review' | 'handoff'
  agentRole: string
  instructions: string
  dependsOn: string[]
  status: GraphNodeStatus
  workerId?: string
  retryCount: number
  maxRetries: number
  evidence: Array<{ id: string; taskEvidenceId: string; type: EvidenceType; label: string; summary: string; source?: string; result?: string; createdAt: string }>
  summary?: string
  error?: string
  startedAt?: string
  completedAt?: string
  updatedAt: string
}

export interface TaskGraph {
  id: string
  taskId: string
  projectId: string
  status: GraphStatus
  plannerVersion: string
  nodes: TaskGraphNode[]
  worker: { status: 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'stopped'; threadId?: string; turnId?: string; pid?: number; message?: string; startedAt?: string; endedAt?: string }
  events: Array<{ id: string; type: string; message: string; createdAt: string }>
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

export interface TaskOverview {
  total: number
  active: number
  awaitingAcceptance: number
  accepted: number
  blocked: number
  counts: Record<string, number>
}

export interface CreateTaskInput {
  projectId: string
  title: string
  kind: DevelopmentTaskKind
  priority: DevelopmentTask['priority']
  requirement: string
  goal: string
  scope: string
  outOfScope: string
  acceptanceCriteria: string[]
  sourceRefs: string[]
  risks: string[]
}

export function listTasks(projectId?: string, includeArchived = false) {
  return api.get<DevelopmentTask[]>('/tasks', { params: { projectId: projectId || undefined, includeArchived } }).then(r => r.data)
}

export function getTask(projectId: string, taskId: string) {
  return api.get<DevelopmentTask>(`/tasks/${taskId}`, { params: { projectId } }).then(r => r.data)
}

export function getTaskOverview(projectId?: string) {
  return api.get<TaskOverview>('/tasks/overview', { params: { projectId: projectId || undefined } }).then(r => r.data)
}

export function listTaskEvidence(projectId?: string) {
  return api.get<Array<TaskEvidence & { taskId: string; taskTitle: string; projectId: string; taskStatus: DevelopmentTaskStatus }>>('/tasks/evidence', { params: { projectId: projectId || undefined } }).then(r => r.data)
}

export function createTask(data: CreateTaskInput) {
  return api.post<DevelopmentTask>('/tasks', data).then(r => r.data)
}

export function updateTask(projectId: string, taskId: string, data: Partial<CreateTaskInput> & { currentNode?: string }) {
  return api.post<DevelopmentTask>(`/tasks/${taskId}/update`, { projectId, ...data }).then(r => r.data)
}

export function startTask(projectId: string, taskId: string) {
  return api.post<DevelopmentTask>(`/tasks/${taskId}/start`, { projectId }).then(r => r.data)
}

export function addTaskEvidence(projectId: string, taskId: string, data: Omit<TaskEvidence, 'id' | 'createdAt'>) {
  return api.post<DevelopmentTask>(`/tasks/${taskId}/evidence`, { projectId, ...data }).then(r => r.data)
}

export function evaluateTaskGate(projectId: string, taskId: string, gateId: string, result: GateResult, evidenceIds: string[], note?: string) {
  return api.post<DevelopmentTask>(`/tasks/${taskId}/gates/${gateId}/evaluate`, { projectId, result, evidenceIds, note }).then(r => r.data)
}

export function openTaskDecision(projectId: string, taskId: string, question: string) {
  return api.post<DevelopmentTask>(`/tasks/${taskId}/decisions`, { projectId, question }).then(r => r.data)
}

export function resolveTaskDecision(projectId: string, taskId: string, decisionId: string, resolution: string) {
  return api.post<DevelopmentTask>(`/tasks/${taskId}/decisions/${decisionId}/resolve`, { projectId, resolution }).then(r => r.data)
}

export function submitTask(projectId: string, taskId: string) {
  return api.post<DevelopmentTask>(`/tasks/${taskId}/submit`, { projectId }).then(r => r.data)
}

export function acceptTask(projectId: string, taskId: string, summary: string) {
  return api.post<DevelopmentTask>(`/tasks/${taskId}/accept`, { projectId, summary }).then(r => r.data)
}

export function archiveTask(projectId: string, taskId: string) {
  return api.post<DevelopmentTask>(`/tasks/${taskId}/archive`, { projectId }).then(r => r.data)
}

export function getTaskExecutionPrompt(projectId: string, taskId: string) {
  return api.post<{ prompt: string; cwd: string; taskId: string; projectId: string }>(`/tasks/${taskId}/execution-prompt`, { projectId }).then(r => r.data)
}

export function getTaskGraph(projectId: string, taskId: string) {
  return api.get<TaskGraph>(`/tasks/${taskId}/graph`, { params: { projectId } }).then(r => r.data)
}

export function planTaskGraph(projectId: string, taskId: string, replace = false) {
  return api.post<TaskGraph>(`/tasks/${taskId}/graph/plan`, { projectId, replace }).then(r => r.data)
}

export function startTaskAutomation(projectId: string, taskId: string, launchWorker = true) {
  return api.post<TaskGraph>(`/tasks/${taskId}/automation/start`, { projectId, launchWorker }, { timeout: 70000 }).then(r => r.data)
}

export function stopTaskAutomation(projectId: string, taskId: string) {
  return api.post<TaskGraph>(`/tasks/${taskId}/automation/stop`, { projectId }).then(r => r.data)
}
