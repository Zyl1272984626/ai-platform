import api from './client'
import type { School, Project } from './types'

export interface DeployParams {
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
  initSql?: boolean
  /** 在 02-app-deploy.sh 中检查并安装 Node/Python/文档运行时依赖（仅 Linux 生效） */
  installSandboxRuntime?: boolean
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

/** 项目部署：生成项目专属 WAR */
export async function deployProject(code: string, projectCode: string) {
  const resp = await fetch(`/api/schools/${code}/projects/${projectCode}/deploy`, {
    method: 'POST',
    signal: AbortSignal.timeout(10 * 60 * 1000),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '部署失败' }))
    throw new Error(err.error)
  }
  const blob = await resp.blob()
  triggerDownload(blob, `${code}-${projectCode}.war`)
}

/** 项目部署：完整部署包 ZIP */
export async function deployProjectFull(code: string, projectCode: string, params: DeployParams) {
  const resp = await fetch(`/api/schools/${code}/projects/${projectCode}/deploy-full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '部署包生成失败' }))
    throw new Error(err.error)
  }
  const blob = await resp.blob()
  triggerDownload(blob, `${code}-${projectCode}-deploy.zip`)
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

export async function deploySchool(code: string) {
  // 旧端点保留，直接走 agent project
  const resp = await fetch(`/api/schools/${code}/deploy`, {
    method: 'POST',
    signal: AbortSignal.timeout(10 * 60 * 1000),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '部署失败' }))
    throw new Error(err.error)
  }
  const blob = await resp.blob()
  triggerDownload(blob, `${code}.war`)
}

export async function deploySchoolFull(code: string, params: DeployParams) {
  const resp = await fetch(`/api/schools/${code}/deploy-full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '部署包生成失败' }))
    throw new Error(err.error)
  }
  const blob = await resp.blob()
  triggerDownload(blob, `${code}-deploy.zip`)
}
