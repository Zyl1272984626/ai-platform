import api from './client'
import type { Skill } from './types'

export function listSkills() {
  return api.get<Skill[]>('/skills').then(r => r.data)
}

export function getSkill(name: string) {
  return api.get<Skill>(`/skills/${name}`).then(r => r.data)
}
