import api from './client'
import type { ConversationSummary, ConversationDetail, MemoryInsight, GeneratedArtifact } from './types'

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
