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
