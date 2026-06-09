import api from './client'

export interface ClaudeConfig {
  authToken: string
  baseUrl: string
  model: string
}

export interface MavenConfig {
  repositoryUrl: string
  localRepository: string
  settingsPath: string
  extraArgs: string
}

export interface PlatformConfig {
  aiPlatformRoot: string
  e2eDataDir: string
  testDataDir: string
  apiTestBaseUrl: string
  claudeConfig: ClaudeConfig
  mavenConfig: MavenConfig
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

export function testClaude(claudeConfig: ClaudeConfig) {
  return api.post<CheckResult>('/settings/test-claude', { claudeConfig })
}

/** 生成发现提示词（供复制到 Claude Code 手动执行） */
export function generateDiscoveryPrompt(projectId: string, type: string) {
  return api.post<{ prompt: string; cwd: string }>(`/projects/${projectId}/generate-discovery-prompt`, { type }).then(r => r.data)
}
