import api from './client'
import type { ConversationSummary, ConversationDetail, MemoryInsight, GeneratedArtifact, MemoryItem, MemoryRecallResultWithReasons, MemoryRecallTarget, MemoryAutomationLog, MemoryConfig, MemoryInjectionLog, MemoryVectorStatus, CurateBatchResult, MemoryOverview, SmartFilterResult, FilterSuggestion, FullMemoryUpdateResult } from './types'

export function listConversations(params?: { source?: string; project?: string; from?: string; to?: string }) {
  return api.get<ConversationSummary[]>('/memory', { params }).then(r => r.data)
}

export function getConversation(id: string) {
  return api.get<ConversationDetail>(`/memory/${encodeURIComponent(id)}`).then(r => r.data)
}

export function scanConversations() {
  return api.post<{ scanned: number; newCount: number; updated: number }>('/memory/scan').then(r => r.data)
}

export function summarizeConversation(id: string) {
  return api.post<{ summary: string }>(`/memory/${encodeURIComponent(id)}/summarize`).then(r => r.data)
}

export function extractInsights(id: string) {
  return api.post<MemoryInsight[]>(`/memory/${encodeURIComponent(id)}/insights`).then(r => r.data)
}

export function generateArtifact(id: string, type: 'skill' | 'prompt' | 'memory-note') {
  return api.post<GeneratedArtifact>(`/memory/${encodeURIComponent(id)}/generate`, { type }).then(r => r.data)
}

export function listInsights() {
  return api.get<MemoryInsight[]>('/memory/insights').then(r => r.data)
}

export function listArtifacts() {
  return api.get<GeneratedArtifact[]>('/memory/artifacts').then(r => r.data)
}

export function applyArtifact(id: string) {
  return api.post(`/memory/artifacts/${encodeURIComponent(id)}/apply`).then(r => r.data)
}

export function getMemoryStats() {
  return api.get('/memory/stats').then(r => r.data)
}

export function deleteConversations(ids: string[]) {
  return api.post<{ deleted: number; freedBytes: number }>('/memory/delete', { ids }).then(r => r.data)
}

export function listMemoryItems(params?: { status?: string; type?: string; project?: string }) {
  return api.get<MemoryItem[]>('/memory/items', { params }).then(r => r.data)
}

export function generateMemoryCandidates(params?: { limit?: number; source?: string; projectPath?: string }) {
  return api.post<{ created: number; updated: number; skipped: number }>('/memory/candidates/generate', params || {}).then(r => r.data)
}

export function transitionMemoryItem(id: string, action: 'approve' | 'activate' | 'reject' | 'archive', updates?: Partial<MemoryItem>) {
  return api.post<MemoryItem>(`/memory/items/${encodeURIComponent(id)}/${action}`, updates || {}).then(r => r.data)
}

export function recallMemory(params: { query: string; projectPath?: string; platform?: ConversationSummary['source']; limit?: number; includeCandidates?: boolean; recordUsage?: boolean; target?: MemoryRecallTarget }) {
  return api.post<MemoryRecallResultWithReasons>('/memory/recall', params).then(r => r.data)
}

// ========== LLM 策展（Phase 2）==========

export function curateConversation(conversationId: string) {
  return api.post<import('./types').CurateResult>('/memory/curate', { conversationId }).then(r => r.data)
}

export function curateBatch(params?: { limit?: number; projectPath?: string; source?: string }) {
  return api.post<CurateBatchResult>('/memory/curate/batch', params || {}).then(r => r.data)
}

// ========== 向量索引（Phase 4）==========

export function getVectorStatus() {
  return api.get<MemoryVectorStatus>('/memory/vectors/status').then(r => r.data)
}

export function rebuildVectors() {
  return api.post<MemoryVectorStatus>('/memory/vectors/rebuild').then(r => r.data)
}

export function runMemoryAutomation(params?: { limit?: number; source?: string; projectPath?: string }) {
  return api.post<{
    scan: { scanned: number; newCount: number; updated: number }
    candidates: { created: number; updated: number; skipped: number }
    log: MemoryAutomationLog
  }>('/memory/automation/run', params || {}).then(r => r.data)
}

export function listMemoryAutomationLogs() {
  return api.get<MemoryAutomationLog[]>('/memory/automation/logs').then(r => r.data)
}

export function exportProjectMemory(projectPath: string, outputFile?: string) {
  return api.post<{ path: string; itemCount: number; content: string }>('/memory/export/project', { projectPath, outputFile }).then(r => r.data)
}

// ========== 受控编辑 / 详情 / 批量 ==========

export function updateMemoryItem(id: string, updates: Partial<MemoryItem>) {
  return api.post<MemoryItem>(`/memory/items/${encodeURIComponent(id)}/update`, updates).then(r => r.data)
}

export function getMemoryItem(id: string) {
  return api.get<MemoryItem>(`/memory/items/${encodeURIComponent(id)}`).then(r => r.data)
}

export function batchTransitionMemoryItems(ids: string[], action: 'approve' | 'activate' | 'reject' | 'archive') {
  return api.post<{ action: string; applied: number; requested: number; items: MemoryItem[] }>(
    '/memory/items/batch/transition',
    { ids, action },
  ).then(r => r.data)
}

// ========== 冷库配置 ==========

export function getMemoryConfig() {
  return api.get<MemoryConfig>('/memory/config').then(r => r.data)
}

export function updateMemoryConfig(partial: Partial<MemoryConfig>) {
  return api.post<MemoryConfig>('/memory/config/update', partial).then(r => r.data)
}

// ========== 注入记录 ==========

export function listInjections(params?: { limit?: number; target?: string }) {
  return api.get<MemoryInjectionLog[]>('/memory/injections', { params }).then(r => r.data)
}

export function feedbackInjection(id: string, feedback: 'useful' | 'wrong' | 'irrelevant') {
  return api.post<MemoryInjectionLog>(`/memory/injections/${encodeURIComponent(id)}/feedback`, { feedback }).then(r => r.data)
}

// ========== 冷库概览 ==========

export function getMemoryOverview(projectPath?: string) {
  return api.get<MemoryOverview>('/memory/overview', { params: projectPath ? { project: projectPath } : {} }).then(r => r.data)
}

// ========== 智能筛选 ==========

export function smartFilterCandidates(mode: 'rule' | 'llm' = 'rule') {
  return api.post<SmartFilterResult>('/memory/candidates/smart-filter', { mode }).then(r => r.data)
}

export function applyFilterSuggestions(items: Array<{ id: string; action: 'approve' | 'reject' }>) {
  return api.post<{ applied: number; results: MemoryItem[] }>('/memory/candidates/apply-suggestions', { items }).then(r => r.data)
}

// ========== 一键全自动更新 ==========
// 一键更新链路较长（含 DeepSeek 策展），单独放宽超时到 180s，不受全局 30s 限制
export function runFullUpdate(useLLM = true) {
  return api.post<FullMemoryUpdateResult>('/memory/full-update', { useLLM }, { timeout: 180000 }).then(r => r.data)
}
