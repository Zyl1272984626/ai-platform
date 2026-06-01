import api from './client'
import type { School } from './types'

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

export function previewConfigs(code: string) {
  return api.get<Record<string, string>>(`/schools/${code}/preview-configs`).then(r => r.data)
}

export function generateConfigsApi(code: string) {
  return api.post<{ ok: boolean; files: string[] }>(`/schools/${code}/generate-configs`).then(r => r.data)
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
