import api from './client'

// ========== 类型定义 ==========

export interface PageConfig {
  id: string
  name: string
  url: string
  path: string
  description?: string
  hasDynamicParams?: boolean
  params?: Record<string, string[]>
}

export interface PageSet {
  id: string
  name: string
  description?: string
  entry?: string
  relatedEntries?: string[]
  suggestSplit?: boolean
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
  status: 'active' | 'inactive'
}

export interface ProjectCheckResult {
  [key: string]: { ok: boolean; msg: string }
}

// ========== 项目 CRUD ==========

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

/** 更新项目（POST 代替 PUT） */
export function updateProject(id: string, data: Partial<TestProject>) {
  return api.post<TestProject>(`/projects/${id}/update`, data)
}

/** 删除项目（POST 代替 DELETE） */
export function deleteProject(id: string) {
  return api.post(`/projects/${id}/delete`)
}

/** 设置默认项目 */
export function setDefaultProject(id: string) {
  return api.post(`/projects/${id}/default`)
}

/** 检测项目连通性 */
export function checkProject(id: string) {
  return api.post<ProjectCheckResult>(`/projects/${id}/check`)
}

// ========== 页面管理 ==========

/** 获取项目页面集 */
export function getProjectPages(id: string) {
  return api.get<PageSet[]>(`/projects/${id}/pages`)
}

/** 获取项目发现日志 */
export function getDiscoveryLog(id: string) {
  return api.get<{
    entries: { name: string; status: string; routeCount: number; error?: string }[]
    validEntries: string[]
    sourceEntries: string[]
    probedEntries: string[]
    discoveredAt?: string
  }>(`/projects/${id}/discovery-log`)
}

/** 批量保存项目页面集 */
export function saveProjectPages(id: string, pageSets: PageSet[]) {
  return api.post(`/projects/${id}/pages/save`, { pageSets })
}

/** 新建页面集 */
export function createPageSet(projectId: string, name: string) {
  return api.post<PageSet>(`/projects/${projectId}/page-sets/create`, { name })
}

/** 更新页面集（重命名等） */
export function updatePageSet(projectId: string, setId: string, data: { name?: string; description?: string }) {
  return api.post<PageSet>(`/projects/${projectId}/page-sets/update`, { setId, ...data })
}

/** 删除页面集 */
export function deletePageSet(projectId: string, setId: string) {
  return api.post(`/projects/${projectId}/page-sets/delete`, { setId })
}

/** 添加页面到页面集 */
export function addPageToSet(projectId: string, setId: string, page: { name: string; url: string; path: string; description?: string }) {
  return api.post<PageConfig>(`/projects/${projectId}/page-sets/${setId}/pages/add`, page)
}

/** 更新页面（含移动到其他页面集） */
export function updatePage(projectId: string, data: {
  pageId: string
  name?: string
  url?: string
  path?: string
  description?: string
  params?: Record<string, string[]>
  targetSetId?: string
}) {
  return api.post(`/projects/${projectId}/pages/update`, data)
}

/** 批量设置动态参数值 */
export function batchSetParam(projectId: string, paramName: string, values: string[], scope?: string) {
  return api.post(`/projects/${projectId}/pages/batch-set-param`, { paramName, values, scope })
}

/** 获取项目公共动态参数 */
export function getGlobalParams(projectId: string) {
  return api.get<Record<string, string[]>>(`/projects/${projectId}/global-params`)
}

/** 保存项目公共动态参数 */
export function saveGlobalParams(projectId: string, params: Record<string, string[]>) {
  return api.post(`/projects/${projectId}/global-params`, { params })
}

/** 删除页面 */
export function deletePage(projectId: string, pageId: string) {
  return api.post(`/projects/${projectId}/pages/delete`, { pageId })
}

// ========== 页面发现 ==========

/** 触发页面发现 — SSE 流式返回进度 */
export function discoverProject(
  id: string,
  mode: 'runtime' | 'source' | 'both' = 'runtime',
  onProgress?: (progress: { stage: string; message: string; detail?: any }) => void,
): Promise<{ stage: string; message: string }> {
  return new Promise((resolve, reject) => {
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
