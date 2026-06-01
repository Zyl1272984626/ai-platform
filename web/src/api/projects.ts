import api from './client'

// ========== 类型定义 ==========

export interface PageConfig {
  id: string
  name: string
  url: string
  path: string
  description?: string
}

export interface PageSet {
  id: string
  name: string
  description?: string
  pages: PageConfig[]
}

export interface TestProject {
  id: string
  name: string
  baseUrl: string
  apiBaseUrl: string
  loginUrl: string
  username: string
  password: string
  sourcePath?: string
  skillPath?: string
  pageSets: PageSet[]
  discoveredAt?: string
  discoveryResult?: any
  status: 'active' | 'inactive'
}

export interface ProjectCheckResult {
  [key: string]: { ok: boolean; msg: string }
}

// ========== API 调用 ==========

/** 获取所有项目 */
export function getProjects() {
  return api.get<TestProject[]>('/projects')
}

/** 获取单个项目 */
export function getProject(id: string) {
  return api.get<TestProject>(`/projects/${id}`)
}

/** 添加项目 */
export function addProject(data: Partial<TestProject>) {
  return api.post<TestProject>('/projects', data)
}

/** 更新项目 */
export function updateProject(id: string, data: Partial<TestProject>) {
  return api.put<TestProject>(`/projects/${id}`, data)
}

/** 删除项目 */
export function deleteProject(id: string) {
  return api.delete(`/projects/${id}`)
}

/** 设置默认项目 */
export function setDefaultProject(id: string) {
  return api.post(`/projects/${id}/default`)
}

/** 获取项目页面集 */
export function getProjectPages(id: string) {
  return api.get<PageSet[]>(`/projects/${id}/pages`)
}

/** 手动更新项目页面集 */
export function updateProjectPages(id: string, pageSets: PageSet[]) {
  return api.put(`/projects/${id}/pages`, { pageSets })
}

/** 检测项目连通性 */
export function checkProject(id: string) {
  return api.post<ProjectCheckResult>(`/projects/${id}/check`)
}

/** 触发页面发现 — SSE 流式返回进度 */
export function discoverProject(
  id: string,
  mode: 'runtime' | 'source' | 'both' = 'runtime',
  onProgress?: (progress: { stage: string; message: string; detail?: any }) => void,
): Promise<{ stage: string; message: string }> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/projects/${id}/discover?mode=${mode}`, { withCredentials: true })

    // POST body 不能通过 EventSource 传递，改用 fetch + SSE reader
    es.close()

    fetch(`/api/projects/${id}/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).then(async (response) => {
      if (!response.ok) {
        reject(new Error(`HTTP ${response.status}`))
        return
      }
      const reader = response.body?.getReader()
      if (!reader) {
        reject(new Error('No response body'))
        return
      }
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              onProgress?.(data)
              if (data.stage === 'complete' || data.stage === 'done') {
                resolve(data)
              } else if (data.stage === 'error') {
                reject(new Error(data.message))
                return
              }
            } catch { /* skip malformed */ }
          }
        }
      }

      resolve({ stage: 'complete', message: '发现完成' })
    }).catch(reject)
  })
}
