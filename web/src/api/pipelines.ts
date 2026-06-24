import api from './client'
import type {
  PipelineArtifactRun,
  PipelineArtifactScan,
  PipelineRelayPlan,
  PipelineRun,
  PipelineStageDef,
  ModelConfigResponse,
  RelayStageContent,
  RelayStageSkillExport,
  ExecutorConfigResponse,
  RelayExecutorConfig,
  ExecutorResult,
  TraceRun,
  TraceRunDetail,
  RelayContextSyncResult,
  RelayContextReadResult,
} from './types'
import { useSSE } from '../composables/useSSE'

export function listStageDefinitions() {
  return api.get<PipelineStageDef[]>('/pipelines').then(r => r.data)
}

export function listPipelineRuns() {
  return api.get<PipelineRun[]>('/pipelines/runs').then(r => r.data)
}

export function getPipelineRun(runId: string) {
  return api.get<PipelineRun>(`/pipelines/runs/${runId}`).then(r => r.data)
}

export function runPipeline(
  requirement: string,
  projectId: string | undefined,
  onEvent: (event: any) => void
) {
  const { start, isStreaming, abort } = useSSE()
  const promise = start('/api/pipelines/run', { requirement, projectId }, onEvent)
  return { promise, isStreaming, abort }
}

export function confirmStage(runId: string) {
  return api.post(`/pipelines/runs/${runId}/confirm`).then(r => r.data)
}

export function abortPipeline(runId: string) {
  return api.post(`/pipelines/runs/${runId}/abort`).then(r => r.data)
}

export function deletePipelineRun(runId: string) {
  return api.post(`/pipelines/runs/${runId}/delete`).then(r => r.data)
}

export function resumePipeline(runId: string, onEvent: (event: any) => void) {
  const { start, isStreaming, abort } = useSSE()
  const promise = start(`/api/pipelines/runs/${runId}/resume`, {}, onEvent)
  return { promise, isStreaming, abort }
}

export function listKnowledge() {
  return api.get('/pipelines/knowledge').then(r => r.data)
}

/** 生成阶段提示词（用于复制） */
export function generatePrompt(stageId: string, requirement: string, projectId?: string, runId?: string, mode?: 'relay', baseEngine?: 'codex' | 'claudecode' | 'zcode') {
  return api.post<{ stageId: string; prompt: string; runId?: string; artifactPath?: string }>('/pipelines/generate-prompt', {
    stageId,
    requirement,
    projectId,
    runId,
    mode,
    baseEngine,
  }).then(r => r.data)
}

export function getRelayPlan(runId?: string, baseEngine?: 'codex' | 'claudecode' | 'zcode') {
  return api.get<PipelineRelayPlan>('/pipelines/relay-plan', { params: { ...(runId ? { runId } : {}), ...(baseEngine ? { baseEngine } : {}) } }).then(r => r.data)
}

export function createRelayRunId(requirement: string, projectId?: string, baseEngine?: 'codex' | 'claudecode' | 'zcode') {
  return api.post<{ runId: string }>('/pipelines/relay-run-id', { requirement, projectId, baseEngine }).then(r => r.data)
}

export function scanArtifacts(runId: string) {
  return api.get<PipelineArtifactScan>(`/pipelines/artifacts/${runId}`).then(r => r.data)
}

export function updateArtifactStageMark(runId: string, stageId: string, mark: 'working' | 'rework' | 'accepted' | 'skipped') {
  return api.post<{ runId: string; stageId: string; mark: 'working' | 'rework' | 'accepted' }>(`/pipelines/artifacts/${runId}/stage-mark`, {
    stageId,
    mark,
  }).then(r => r.data)
}

/** 删除单个阶段的产物文件（保留其余产物和 manifest） */
export function deleteRelayStage(runId: string, stageId: string) {
  return api.post<{ ok: boolean; runId: string; stageId: string }>(`/pipelines/artifacts/${runId}/stages/${stageId}/delete`).then(r => r.data)
}

/** 删除整条接力 run（全部阶段产物 + manifest） */
export function deleteRelayRun(runId: string) {
  return api.post<{ ok: boolean; runId: string; removedFiles: string[] }>(`/pipelines/artifacts/${runId}/delete`).then(r => r.data)
}

/** 读取单个阶段产物的完整内容（用于 Markdown 预览） */
export function readRelayStageContent(runId: string, stageId: string) {
  return api.get<RelayStageContent>(`/pipelines/artifacts/${runId}/stages/${stageId}/content`).then(r => r.data)
}

/** 导出单个 relay 阶段为 SKILL.md 内容字符串 */
export function exportRelayStageSkill(stageId: string, baseEngine?: 'codex' | 'claudecode' | 'zcode') {
  return api.post<RelayStageSkillExport>('/pipelines/relay-stage-skill', { stageId, baseEngine }).then(r => r.data)
}

// ========== 执行器（P2） ==========

/** 读取执行器开关 + 可用构建命令 */
export function getExecutorConfig() {
  return api.get<ExecutorConfigResponse>('/pipelines/executor-config').then(r => r.data)
}

/** 更新执行器开关（持久化） */
export function updateExecutorConfig(updates: Partial<RelayExecutorConfig>) {
  return api.post<{ ok: boolean; config: RelayExecutorConfig }>('/pipelines/executor-config', updates).then(r => r.data)
}

/** 用 DeepSeek 执行一个 relay 阶段（仅 design/review 类） */
export function executeDeepSeek(runId: string, stageId: string, requirement: string, baseEngine?: 'codex' | 'claudecode' | 'zcode') {
  return api.post<ExecutorResult>('/pipelines/execute-deepseek', { runId, stageId, requirement, baseEngine }).then(r => r.data)
}

// ========== Trace 审计（P3） ==========

/** 列出有 trace 记录的 run */
export function listTraceRuns() {
  return api.get<TraceRun[]>('/pipelines/trace-runs').then(r => r.data)
}

/** 读取单条 run 的全部 trace 事件 */
export function getTraceEvents(runId: string) {
  return api.get<TraceRunDetail>(`/pipelines/traces/${runId}`).then(r => r.data)
}

/** 记录一条最终决策 */
export function recordFinalDecision(runId: string, summary: string, detail: Record<string, unknown> = {}) {
  return api.post(`/pipelines/traces/${runId}/final-decision`, { summary, detail }).then(r => r.data)
}

/** 生成交付报告（汇总阶段/文件/风险/验收） */
export function generateDeliveryReport(runId: string) {
  return api.post<{ reportPath: string; content: string }>('/pipelines/delivery-report/' + runId).then(r => r.data)
}

// ========== 接力上下文同步 ==========

/** 把当前接力任务写进项目根 AGENTS.md */
export function syncRelayContext(runId: string) {
  return api.post<RelayContextSyncResult>('/pipelines/relay-context/sync', { runId }).then(r => r.data)
}

/** 读取 AGENTS.md 是否已同步该 runId 的上下文 */
export function readRelayContext(runId: string) {
  return api.get<RelayContextReadResult>(`/pipelines/relay-context/${runId}`).then(r => r.data)
}

/** 清除 AGENTS.md 里的接力区块 */
export function clearRelayContext(projectId?: string) {
  return api.post<{ cleared: boolean; agentsFile: string }>('/pipelines/relay-context/clear', { projectId }).then(r => r.data)
}

/** 检查 relay-dev Skill 是否已安装到 ZCode */
export function getZcodeSkillStatus() {
  return api.get<{ installed: boolean; path: string }>('/pipelines/zcode-skill/status').then(r => r.data)
}

/** 安装 relay-dev Skill 到 ~/.zcode/skills/ */
export function installZcodeSkill() {
  return api.post<{ ok: boolean; installed: boolean; path: string }>('/pipelines/zcode-skill/install').then(r => r.data)
}

export function listArtifactRuns() {
  return api.get<PipelineArtifactRun[]>('/pipelines/artifact-runs').then(r => r.data)
}

export function generateContinuationPrompt(runId: string, stageIds: string[], requirement?: string, projectId?: string) {
  return api.post<{ runId: string; stageIds: string[]; prompt: string }>('/pipelines/generate-continuation-prompt', {
    runId,
    stageIds,
    requirement,
    projectId,
  }).then(r => r.data)
}

/** 生成可直接交给 Codex 执行的主流程提示词 */
export function generateCodexPrompt(requirement: string, projectId?: string, runId?: string) {
  return api.post<{ prompt: string; runId?: string }>('/pipelines/generate-codex-prompt', {
    requirement,
    projectId,
    runId,
  }).then(r => r.data)
}

/** 生成可直接交给 ClaudeCode/GLM 执行的主流程提示词 */
export function generateClaudeCodePrompt(requirement: string, projectId?: string, runId?: string) {
  return api.post<{ prompt: string; runId?: string }>('/pipelines/generate-claudecode-prompt', {
    requirement,
    projectId,
    runId,
  }).then(r => r.data)
}

/** 获取可用模型列表 */
export function getModels() {
  return api.get<ModelConfigResponse>('/pipelines/models').then(r => r.data)
}

/** 更新模型配置 */
export function updateModelConfig(data: { apiKey?: string; baseUrl?: string; model?: string }) {
  return api.post('/pipelines/model-config', data).then(r => r.data)
}
