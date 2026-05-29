import api from './client'
import type { WorkflowTemplate, WorkflowRun } from './types'
import { useSSE } from '../composables/useSSE'

export function listTemplates() {
  return api.get<WorkflowTemplate[]>('/workflows').then(r => r.data)
}

export function listRuns() {
  return api.get<WorkflowRun[]>('/workflows/runs').then(r => r.data)
}

export function getRun(runId: string) {
  return api.get<WorkflowRun>(`/workflows/runs/${runId}`).then(r => r.data)
}

export function runWorkflow(
  name: string,
  params: Record<string, unknown>,
  onEvent: (event: any) => void
) {
  const { start, isStreaming, abort } = useSSE()
  const promise = start(`/api/workflows/${encodeURIComponent(name)}/run`, params, onEvent)
  return { promise, isStreaming, abort }
}

export function resumeRun(
  runId: string,
  onEvent: (event: any) => void
) {
  const { start, isStreaming, abort } = useSSE()
  const promise = start(`/api/workflows/runs/${runId}/resume`, {}, onEvent)
  return { promise, isStreaming, abort }
}

export function confirmStep(runId: string) {
  return api.post(`/workflows/runs/${runId}/confirm`).then(r => r.data)
}

export function abortRun(runId: string) {
  return api.post(`/workflows/runs/${runId}/abort`).then(r => r.data)
}
