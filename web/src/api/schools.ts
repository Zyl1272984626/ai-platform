import api from './client'
import type { School } from './types'

export interface DeployParams {
  deployHost: string
  deployUser: string
  dbRootPassword: string
  mysqlContainer?: string
  oneapiHost: string
  oneapiPort: number
  oneapiKey: string
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
}

export function listSchools() {
  return api.get<School[]>('/schools').then(r => r.data)
}

export function getSchool(code: string) {
  return api.get<School>(`/schools/${code}`).then(r => r.data)
}

export function addSchool(data: Omit<School, 'status' | 'lastDeploy'>) {
  return api.post<School>('/schools', data).then(r => r.data)
}

export function updateSchool(code: string, data: Partial<School>) {
  return api.put<School>(`/schools/${code}`, data).then(r => r.data)
}

export function deleteSchool(code: string) {
  return api.delete(`/schools/${code}`).then(r => r.data)
}

export async function deploySchool(code: string) {
  const resp = await fetch(`/api/schools/${code}/deploy`, {
    method: 'POST',
    signal: AbortSignal.timeout(10 * 60 * 1000), // 10 分钟超时（Maven 构建耗时）
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '部署失败' }))
    throw new Error(err.error)
  }
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${code}.war`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
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
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${code}-deploy.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
