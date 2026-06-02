import api from './client'

export interface PlatformConfig {
  aiPlatformRoot: string
  e2eDataDir: string
  testDataDir: string
  apiTestBaseUrl: string
}

export interface CheckResult {
  ok: boolean
  msg: string
}

export function getSettings() {
  return api.get<PlatformConfig>('/settings')
}

export function updateSettings(data: Partial<PlatformConfig>) {
  return api.post<PlatformConfig>('/settings', data)
}

export function checkSettings() {
  return api.get<Record<string, CheckResult>>('/settings/check')
}
