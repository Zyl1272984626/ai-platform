import api from './client'

export interface PlatformConfig {
  projectRoot: string
  aiPlatformRoot: string
  e2eDataDir: string
  mainFrontendPort: number
  mainBackendPort: number
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
