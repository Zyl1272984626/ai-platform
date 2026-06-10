import api from './client'
import type { PipelineArtifactRun, PipelineArtifactScan, PipelineRelayPlan, PipelineRun, PipelineStageDef, ModelConfigResponse } from './types'
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
export function generatePrompt(stageId: string, requirement: string, projectId?: string, runId?: string, mode?: 'relay', baseEngine?: 'codex' | 'claudecode') {
  return api.post<{ stageId: string; prompt: string; runId?: string; artifactPath?: string }>('/pipelines/generate-prompt', {
    stageId,
    requirement,
    projectId,
    runId,
    mode,
    baseEngine,
  }).then(r => r.data)
}

export function getRelayPlan(runId?: string, baseEngine?: 'codex' | 'claudecode') {
  return api.get<PipelineRelayPlan>('/pipelines/relay-plan', { params: { ...(runId ? { runId } : {}), ...(baseEngine ? { baseEngine } : {}) } }).then(r => r.data)
}

export function createRelayRunId(requirement: string, projectId?: string, baseEngine?: 'codex' | 'claudecode') {
  return api.post<{ runId: string }>('/pipelines/relay-run-id', { requirement, projectId, baseEngine }).then(r => r.data)
}

export function scanArtifacts(runId: string) {
  return api.get<PipelineArtifactScan>(`/pipelines/artifacts/${runId}`).then(r => r.data)
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
