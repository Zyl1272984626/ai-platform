import api from './client'

export interface TestTypeInfo {
  type: string
  name: string
  description: string
  icon: string
}

export interface TestRun {
  id: string
  name: string
  type: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error'
  cases: TestCase[]
  startedAt: string
  finishedAt?: string
  duration?: number
  config: Record<string, unknown>
}

export interface TestCase {
  id: string
  name: string
  type: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error'
  duration?: number
  error?: string
  output?: string
}

export function listTestTypes() {
  return api.get<TestTypeInfo[]>('/tests/types').then(r => r.data)
}

export function listTestRuns(type?: string) {
  return api.get<TestRun[]>('/tests/runs', { params: { type } }).then(r => r.data)
}

export function getTestRun(id: string) {
  return api.get<TestRun>(`/tests/runs/${id}`).then(r => r.data)
}

export function deleteTestRun(id: string) {
  return api.delete(`/tests/runs/${id}`).then(r => r.data)
}

export function abortTestRun(id: string) {
  return api.post(`/tests/runs/${id}/abort`).then(r => r.data)
}

/** 触发测试，返回 suiteId */
export function runTest(type: string, config: Record<string, unknown> = {}) {
  return api.post<{ suiteId: string }>('/tests/run', { type, config }).then(r => r.data)
}

/** 获取当前运行中的测试列表 */
export function listRunningTests() {
  return api.get<TestRun[]>('/tests/running').then(r => r.data)
}

/** 订阅某个测试运行的 SSE 事件流 */
export function subscribeTestStream(suiteId: string): EventSource {
  return new EventSource(`/api/tests/runs/${suiteId}/stream`)
}

/** 获取并发配置 */
export function getConcurrency() {
  return api.get<Record<string, number>>('/tests/concurrency').then(r => r.data)
}

/** 设置并发配置 */
export function setConcurrency(type: string, value: number) {
  return api.post<Record<string, number>>('/tests/concurrency', { type, value }).then(r => r.data)
}

/** 获取 E2E 测试报告 URL */
export function getReportUrl(runId: string): string {
  return `/api/tests/runs/${runId}/report`
}
