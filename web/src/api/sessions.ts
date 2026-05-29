import api from './client'
import type { Session } from './types'
import { useSSE } from '../composables/useSSE'

export function listSessions() {
  return api.get<Session[]>('/sessions').then(r => r.data)
}

export function createSession(opts?: { systemPrompt?: string; allowedTools?: string[] }) {
  return api.post<Session>('/sessions', opts || {}).then(r => r.data)
}

export function getSession(id: string) {
  return api.get<Session>(`/sessions/${id}`).then(r => r.data)
}

export function deleteSession(id: string) {
  return api.delete(`/sessions/${id}`).then(r => r.data)
}

export function sendMessage(
  sessionId: string,
  message: string,
  onEvent: (event: any) => void
) {
  const { start, isStreaming, abort } = useSSE()
  const promise = start(`/api/sessions/${sessionId}/messages`, { message }, onEvent)
  return { promise, isStreaming, abort }
}
