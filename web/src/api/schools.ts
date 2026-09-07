import api from './client'
import type { School, Project } from './types'

// Agent 冷构建包含前端、Maven、WAR 重写和大 ZIP 压缩，10 分钟可能先于后端完成而超时。
const DEPLOY_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000

export interface DeployParams {
  /** 是否启用前后端接口加密 */
  encrypted?: boolean
  deployHost?: string
  deployUser?: string
  dbRootPassword?: string
  mysqlContainer?: string
  oneapiHost?: string
  oneapiPort?: number
  oneapiKey?: string
  knowledgeBaseUrl?: string
  knowledgeAppId?: string
  knowledgeApiKey?: string
  voiceApiUrl?: string
  createAgentDatabases?: boolean
  createOneapiDatabase?: boolean
  oneapiDatabase?: string
  createDatabase?: boolean
  deployOneapi?: boolean
  updateOneapiCache?: boolean
  initSql?: boolean
  prepareAgentDirs?: boolean
  updateHyperAgent?: boolean
  installOnestopRuntime?: boolean
  linuxDistro?: 'openeuler' | 'ubuntu' | 'rocky' | 'centos' | 'other'
  updateToolScript?: boolean
  /** @deprecated use installOnestopRuntime */
  installSandboxRuntime?: boolean
  installTomcat?: boolean
  /** 在 02-app-deploy 中替换 Tomcat 项目 WAR 并启停 Tomcat */
  autoDeployTomcat?: boolean
  tomcatRoot?: string
  tomcatContext?: string
}

export function listSchools() {
  return api.get<School[]>('/schools').then(r => r.data)
}

export function getSchool(code: string) {
  return api.get<School>(`/schools/${code}`).then(r => r.data)
}

export function addSchool(data: Partial<School> & { code: string; name: string }) {
  return api.post<School>('/schools', data).then(r => r.data)
}

export function updateSchool(code: string, data: Partial<School>) {
  return api.post<School>(`/schools/${code}/update`, data).then(r => r.data)
}

export function deleteSchool(code: string) {
  return api.post(`/schools/${code}/delete`).then(r => r.data)
}

// ========== 项目级 API ==========

export function addProject(code: string, project: Project) {
  return api.post<School>(`/schools/${code}/projects`, project).then(r => r.data)
}

export function updateProject(code: string, projectCode: string, data: Partial<Project>) {
  return api.post<School>(`/schools/${code}/projects/${projectCode}/update`, data).then(r => r.data)
}

export function deleteProject(code: string, projectCode: string) {
  return api.post<School>(`/schools/${code}/projects/${projectCode}/delete`).then(r => r.data)
}

/** 项目部署：生成项目专属 WAR 更新包（WAR + 一键应用服务器脚本） */
export async function deployProject(code: string, projectCode: string, params: DeployParams = {}) {
  const resp = await fetch(`/api/schools/${code}/projects/${projectCode}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(DEPLOY_DOWNLOAD_TIMEOUT_MS),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '部署失败' }))
    throw new Error(err.error)
  }
  const blob = await resp.blob()
  triggerDownload(blob, `${projectCode}-war-deploy.zip`)
}

/** 项目部署：完整部署包 ZIP */
export async function deployProjectFull(code: string, projectCode: string, params: DeployParams) {
  const resp = await fetch(`/api/schools/${code}/projects/${projectCode}/deploy-full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(DEPLOY_DOWNLOAD_TIMEOUT_MS),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '部署包生成失败' }))
    throw new Error(err.error)
  }
  const blob = await resp.blob()
  triggerDownload(blob, `${projectCode}-deploy.zip`)
}

/** 触发浏览器下载 blob */
function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ========== 兼容旧 API（默认 agent project）==========

export async function deploySchool(code: string, params: DeployParams = {}) {
  // 旧端点保留，直接走 agent project
  const resp = await fetch(`/api/schools/${code}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(DEPLOY_DOWNLOAD_TIMEOUT_MS),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '部署失败' }))
    throw new Error(err.error)
  }
  const blob = await resp.blob()
  triggerDownload(blob, `agent-war-deploy.zip`)
}

export async function deploySchoolFull(code: string, params: DeployParams) {
  const resp = await fetch(`/api/schools/${code}/deploy-full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(DEPLOY_DOWNLOAD_TIMEOUT_MS),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '部署包生成失败' }))
    throw new Error(err.error)
  }
  const blob = await resp.blob()
  triggerDownload(blob, `agent-deploy.zip`)
}
