<template>
  <div class="settings-page">
    <header class="page-header">
      <div>
        <h1>系统设置</h1>
        <p class="subtitle">配置项目路径和服务端口，新同事换电脑后在此页面修改即可</p>
      </div>
    </header>

    <div v-if="loading" class="loading">加载中...</div>

    <div v-else class="settings-content">
      <!-- 项目管理 -->
      <section class="setting-section">
        <div class="section-header">
          <h2 class="section-title">项目管理</h2>
          <button class="btn btn-add" @click="openAddProject">+ 添加项目</button>
        </div>
        <p class="field-desc" style="margin-top: -8px; margin-bottom: 16px;">
          管理被测项目，支持多项目。添加后点击"发现页面"自动探测路由。
        </p>

        <div v-if="projects.length === 0" class="empty-projects">
          暂无项目，点击上方按钮添加
        </div>

        <div v-for="project in projects" :key="project.id" class="project-card" :class="{ default: project.id === config.defaultProjectId }">
          <div class="project-header">
            <div class="project-info">
              <span class="project-name">{{ project.name }}</span>
              <span v-if="project.id === config.defaultProjectId" class="badge badge-default">默认</span>
              <span class="badge" :class="project.status === 'active' ? 'badge-active' : 'badge-inactive'">
                {{ project.status === 'active' ? '活跃' : '停用' }}
              </span>
            </div>
            <div class="project-actions">
              <button class="btn btn-sm" @click="setDefault(project.id)" v-if="project.id !== config.defaultProjectId">设为默认</button>
              <button class="btn btn-sm" @click="editProject(project)">编辑</button>
              <button class="btn btn-sm btn-discover" @click="openDiscoverDialog(project)" :disabled="discoveringProject === project.id">
                {{ discoveringProject === project.id ? '发现中...' : '发现页面' }}
              </button>
              <button class="btn btn-sm btn-manage" @click="openPageManager(project)" :disabled="!project.pageSets?.length">
                管理页面
              </button>
              <button class="btn btn-sm btn-check" @click="doCheckProject(project.id)" :disabled="checkingProject === project.id">
                {{ checkingProject === project.id ? '检测中...' : '检测' }}
              </button>
              <button class="btn btn-sm btn-danger" @click="doDeleteProject(project.id)">删除</button>
            </div>
          </div>
          <div class="project-detail">
            <div class="project-url">{{ project.baseUrl }}</div>
            <div class="project-stats">
              <span>页面集: {{ project.pageSets?.length || 0 }} 个</span>
              <span>页面: {{ totalPages(project) }} 个</span>
              <span v-if="project.discoveredAt">发现于: {{ formatDate(project.discoveredAt) }}</span>
              <span v-else class="text-muted">未发现</span>
            </div>
          </div>
          <!-- 项目检测状态 -->
          <div v-if="projectChecks[project.id]" class="project-check-results">
            <span v-for="(result, key) in projectChecks[project.id]" :key="key"
              class="check-badge" :class="result.ok ? 'ok' : 'err'">
              {{ key }}: {{ result.msg }}
            </span>
          </div>
          <!-- 发现进度面板 -->
          <div v-if="discoverLogs[project.id]" class="discover-progress">
            <div class="discover-progress-header">
              <span>页面发现进度</span>
              <span class="discover-stage">{{ discoverLogs[project.id].stage }}</span>
            </div>
            <div v-for="(log, idx) in discoverLogs[project.id].logs" :key="idx" class="discover-log">
              {{ log }}
            </div>
          </div>
        </div>
      </section>

      <!-- 路径配置 -->
      <section class="setting-section">
        <h2 class="section-title">路径配置</h2>
        <div class="form-group">
          <label>AI Platform 根目录</label>
          <p class="field-desc">ai-platform 自身路径，定位数据目录和 Skills 库</p>
          <div class="input-row">
            <input v-model="form.aiPlatformRoot" placeholder="例如: C:/FengSuKeJi/ai-platform" />
            <span v-if="checks.aiPlatformRoot" class="check-badge" :class="checks.aiPlatformRoot.ok ? 'ok' : 'err'">
              {{ checks.aiPlatformRoot.msg }}
            </span>
          </div>
        </div>

        <div class="form-group">
          <label>E2E 数据目录</label>
          <p class="field-desc">E2E 测试运行数据存放路径</p>
          <div class="input-row">
            <input v-model="form.e2eDataDir" placeholder="例如: F:/e2e-test-data" />
            <span v-if="checks.e2eDataDir" class="check-badge" :class="checks.e2eDataDir.ok ? 'ok' : 'err'">
              {{ checks.e2eDataDir.msg }}
            </span>
          </div>
        </div>
      </section>

      <!-- API 测试配置 -->
      <section class="setting-section">
        <h2 class="section-title">API 测试</h2>
        <div class="form-group">
          <label>API 测试目标地址</label>
          <p class="field-desc">API 接口测试检测的后端地址</p>
          <div class="input-row">
            <input v-model="form.apiTestBaseUrl" placeholder="例如: http://localhost:3100" />
            <span v-if="checks.apiTestBaseUrl" class="check-badge" :class="checks.apiTestBaseUrl.ok ? 'ok' : 'err'">
              {{ checks.apiTestBaseUrl.msg }}
            </span>
          </div>
        </div>
      </section>

      <!-- 环境检测 -->
      <section class="setting-section">
        <h2 class="section-title">环境检测</h2>
        <p class="field-desc">检测运行环境是否就绪（点击下方"检测配置"触发）</p>
        <div class="env-check-list">
          <div class="env-check-item">
            <span class="env-label">Claude Code CLI</span>
            <span v-if="checks.claudeCode" class="check-badge" :class="checks.claudeCode.ok ? 'ok' : 'err'">
              {{ checks.claudeCode.msg }}
            </span>
            <span v-else class="check-badge pending">待检测</span>
          </div>
          <div class="env-check-item">
            <span class="env-label">ANTHROPIC_API_KEY</span>
            <span v-if="checks.anthropicApiKey" class="check-badge" :class="checks.anthropicApiKey.ok ? 'ok' : 'err'">
              {{ checks.anthropicApiKey.msg }}
            </span>
            <span v-else class="check-badge pending">待检测</span>
          </div>
          <div class="env-check-item">
            <span class="env-label">Playwright 浏览器</span>
            <span v-if="checks.playwright" class="check-badge" :class="checks.playwright.ok ? 'ok' : 'err'">
              {{ checks.playwright.msg }}
            </span>
            <span v-else class="check-badge pending">待检测</span>
          </div>
        </div>
      </section>

      <!-- 操作按钮 -->
      <div class="actions">
        <button class="btn btn-check" @click="doCheck" :disabled="checking">
          {{ checking ? '检测中...' : '检测配置' }}
        </button>
        <button class="btn btn-save" @click="doSave" :disabled="saving">
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
      </div>

      <!-- 提示消息 -->
      <div v-if="message" class="message" :class="message.type">{{ message.text }}</div>
    </div>

    <!-- 添加/编辑项目弹窗 -->
    <div v-if="showProjectModal" class="modal-overlay" @click.self="showProjectModal = false">
      <div class="modal-content">
        <h3>{{ editingProject ? '编辑项目' : '添加项目' }}</h3>
        <div class="form-group">
          <label>项目名称 <span class="required">*</span></label>
          <input v-model="projectForm.name" placeholder="例如: 主系统(Agent)" />
        </div>
        <div class="form-group">
          <label>前端地址 <span class="required">*</span></label>
          <input v-model="projectForm.baseUrl" placeholder="例如: http://localhost:5173" />
        </div>
        <div class="form-group">
          <label>后端 API 地址</label>
          <input v-model="projectForm.apiBaseUrl" placeholder="默认同前端地址" />
        </div>
        <div class="form-group">
          <label>登录页路径</label>
          <input v-model="projectForm.loginUrl" placeholder="例如: /web/index.html#/login" />
        </div>
        <div class="form-group">
          <label>用户名 <span class="required">*</span></label>
          <input v-model="projectForm.username" placeholder="登录用户名" />
        </div>
        <div class="form-group">
          <label>密码 <span class="required">*</span></label>
          <input v-model="projectForm.password" type="password" placeholder="登录密码" />
        </div>
        <div class="form-group">
          <label>源码路径（可选）</label>
          <p class="field-desc">用于源码分析增强页面发现</p>
          <input v-model="projectForm.sourcePath" placeholder="例如: C:/FengSuKeJi/agent" />
        </div>
        <div class="modal-actions">
          <button class="btn btn-cancel" @click="showProjectModal = false">取消</button>
          <button class="btn btn-save" @click="saveProject" :disabled="savingProject">
            {{ savingProject ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 发现模式选择弹窗 -->
    <div v-if="showDiscoverDialog" class="modal-overlay" @click.self="showDiscoverDialog = false">
      <div class="modal-content" style="width: 400px;">
        <h3>发现页面</h3>
        <p class="field-desc">选择发现方式（项目{{ discoverDialogProject?.sourcePath ? '已配置源码路径' : '未配置源码路径' }}）</p>
        <div class="discover-options">
          <div class="discover-option" :class="{ active: discoverMode === 'both' }" @click="discoverMode = 'both'">
            <div class="discover-option-title">源码 + 浏览器</div>
            <div class="discover-option-desc">先分析源码入口，再浏览器验证，最全面</div>
          </div>
          <div class="discover-option" :class="{ active: discoverMode === 'runtime' }" @click="discoverMode = 'runtime'">
            <div class="discover-option-title">仅浏览器探测</div>
            <div class="discover-option-desc">登录后遍历入口提取路由，适合无源码时</div>
          </div>
          <div class="discover-option" :class="{ active: discoverMode === 'source' }" @click="discoverMode = 'source'">
            <div class="discover-option-title">仅源码分析</div>
            <div class="discover-option-desc">读 vite.config.ts 和 pages 目录，速度快</div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-cancel" @click="showDiscoverDialog = false">取消</button>
          <button class="btn btn-save" @click="confirmDiscover" :disabled="discoveringProject !== null">
            {{ discoveringProject ? '发现中...' : '开始发现' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 页面管理弹窗 -->
    <div v-if="showPageManager" class="modal-overlay" @click.self="closePageManager">
      <div class="modal-content modal-wide">
        <h3>页面管理 — {{ pageManagerProjectName }}</h3>
        <p class="field-desc">
          {{ pageManagerSets.length }} 个页面集 | {{ pageManagerTotalPages }} 个页面
          <button v-if="discoveryEntries.length" class="btn btn-xs" style="margin-left: 8px;" @click="showDiscoveryLog = !showDiscoveryLog">
            {{ showDiscoveryLog ? '收起发现日志' : '查看发现日志' }}
          </button>
        </p>

        <!-- 发现日志 -->
        <div v-if="showDiscoveryLog && discoveryEntries.length" class="discovery-log-panel">
          <div v-if="discoverySourceEntries.length" class="discovery-source-info">
            源码分析发现 {{ discoverySourceEntries.length }} 个入口: {{ discoverySourceEntries.join(', ') }}
          </div>
          <div class="discovery-log-title">子应用入口探测结果（✅ 有效入口参与分组，❌ 失败入口不影响结果，多测无害）</div>
          <div v-for="entry in discoveryEntries" :key="entry.name" class="discovery-entry" :class="entry.status">
            <span class="entry-status">{{ entry.status === 'valid' ? '✅' : '❌' }}</span>
            <span class="entry-name">
              {{ entry.name }}
              <span v-if="discoverySourceEntries.includes(entry.name)" class="badge badge-source">源码</span>
            </span>
            <span class="entry-info">
              {{ entry.status === 'valid'
                ? `${entry.routeCount} 条路由`
                : '未挂载（可能从未实现、已废弃、或属于其他入口的内部路由）'
              }}
            </span>
          </div>
        </div>

        <div v-if="pageManagerLoading" class="loading" style="padding: 20px;">加载中...</div>

        <div v-else class="page-set-list">
          <div v-for="ps in pageManagerSets" :key="ps.id" class="page-set-block">
            <div class="page-set-header" @click="toggleSetExpand(ps.id)">
              <span class="expand-icon">{{ expandedSetIds.has(ps.id) ? '▼' : '▶' }}</span>
              <span class="page-set-name">
                <!-- 重命名状态 -->
                <template v-if="renamingSetId === ps.id">
                  <input v-model="renameValue" class="rename-input" @keyup.enter="doRenameSet(ps.id)" @keyup.escape="renamingSetId = null" />
                  <button class="btn btn-xs btn-save" @click.stop="doRenameSet(ps.id)">确定</button>
                  <button class="btn btn-xs btn-cancel" @click.stop="renamingSetId = null">取消</button>
                </template>
                <template v-else>
                  {{ ps.name }}
                </template>
              </span>
              <span class="page-set-count">{{ ps.pages.length }} 页</span>
              <span v-if="ps.suggestSplit" class="badge badge-warn">建议拆分</span>
              <span v-if="ps.relatedEntries?.length" class="badge badge-info">关联: {{ ps.relatedEntries.join(', ') }}</span>
              <div class="page-set-actions" @click.stop>
                <button class="btn btn-xs" @click="startRenameSet(ps)" title="重命名">重命名</button>
                <button class="btn btn-xs" @click="startAddPage(ps.id)" title="添加页面">+ 页面</button>
                <button class="btn btn-xs btn-danger" @click="doDeleteSet(ps.id)" title="删除页面集">删除</button>
              </div>
            </div>

            <!-- 展开的页面列表 -->
            <div v-if="expandedSetIds.has(ps.id)" class="page-list">
              <div v-if="addingToSetId === ps.id" class="add-page-form">
                <input v-model="newPageForm.name" placeholder="页面名称" class="inline-input" />
                <input v-model="newPageForm.path" placeholder="路由路径" class="inline-input" />
                <input v-model="newPageForm.url" placeholder="访问URL（可选）" class="inline-input" />
                <button class="btn btn-xs btn-save" @click="doAddPage(ps.id)">添加</button>
                <button class="btn btn-xs btn-cancel" @click="addingToSetId = null">取消</button>
              </div>

              <div v-for="page in ps.pages" :key="page.id" class="page-item">
                <template v-if="editingPage?.id === page.id">
                  <div class="edit-page-form">
                    <input v-model="editPageForm.name" placeholder="名称" class="inline-input" />
                    <input v-model="editPageForm.path" placeholder="路径" class="inline-input" />
                    <select v-model="editPageForm.targetSetId" class="move-select">
                      <option value="">不移动</option>
                      <option v-for="t in pageManagerSets.filter(s => s.id !== ps.id)" :key="t.id" :value="t.id">
                        移动到: {{ t.name }}
                      </option>
                    </select>
                    <button class="btn btn-xs btn-save" @click="doEditPage">保存</button>
                    <button class="btn btn-xs btn-cancel" @click="editingPage = null">取消</button>
                  </div>
                </template>
                <template v-else>
                  <span class="page-name">{{ page.name }}</span>
                  <span class="page-path" :title="page.url">{{ page.path }}</span>
                  <div class="page-actions">
                    <button class="btn btn-xs btn-open" @click="openPageUrl(page)" title="在新标签页打开">打开</button>
                    <button class="btn btn-xs" @click="showPageDetail(page)" title="查看详情">详情</button>
                    <button class="btn btn-xs" @click="startEditPage(page, ps.id)">编辑</button>
                    <button class="btn btn-xs btn-danger" @click="doDeletePage(page.id, ps.id)">删除</button>
                  </div>
                </template>
              </div>

              <div v-if="ps.pages.length === 0 && addingToSetId !== ps.id" class="empty-pages">
                暂无页面
              </div>
            </div>
          </div>
        </div>

        <!-- 新建页面集 -->
        <div class="add-set-row">
          <input v-model="newSetName" placeholder="新页面集名称" class="inline-input" />
          <button class="btn btn-sm btn-save" @click="doCreateSet" :disabled="!newSetName.trim()">新建页面集</button>
        </div>

        <!-- 页面详情 -->
        <div v-if="detailPage" class="page-detail-panel">
          <div class="page-detail-header">
            <span>页面详情</span>
            <button class="btn btn-xs" @click="detailPage = null">关闭</button>
          </div>
          <div class="page-detail-row">
            <label>名称</label>
            <span>{{ detailPage.name }}</span>
          </div>
          <div class="page-detail-row">
            <label>路由路径</label>
            <code>{{ detailPage.path }}</code>
          </div>
          <div class="page-detail-row">
            <label>访问 URL</label>
            <code>{{ detailPageBaseUrl }}{{ detailPage.url }}</code>
          </div>
          <div v-if="detailPage.description" class="page-detail-row">
            <label>描述</label>
            <span>{{ detailPage.description }}</span>
          </div>
          <div class="page-detail-row">
            <label>页面 ID</label>
            <code>{{ detailPage.id }}</code>
          </div>
          <button class="btn btn-sm btn-open" @click="openPageUrl(detailPage)" style="margin-top: 8px;">在新标签页打开此页面</button>
        </div>

        <div class="modal-actions">
          <button class="btn btn-cancel" @click="closePageManager">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { getSettings, updateSettings, checkSettings, type PlatformConfig, type CheckResult } from '../api/settings'
import {
  getProjects as fetchProjects,
  addProject as apiAddProject,
  updateProject as apiUpdateProject,
  deleteProject as apiDeleteProject,
  setDefaultProject as apiSetDefault,
  checkProject as apiCheckProject,
  discoverProject as apiDiscoverProject,
  getProjectPages,
  getDiscoveryLog,
  saveProjectPages,
  createPageSet as apiCreatePageSet,
  updatePageSet as apiUpdatePageSet,
  deletePageSet as apiDeletePageSet,
  addPageToSet as apiAddPageToSet,
  updatePage as apiUpdatePage,
  deletePage as apiDeletePage,
  type TestProject,
  type ProjectCheckResult,
  type PageSet,
  type PageConfig,
} from '../api/projects'

const loading = ref(true)
const saving = ref(false)
const checking = ref(false)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)

// 基础配置表单
const form = reactive<PlatformConfig>({
  aiPlatformRoot: '',
  e2eDataDir: '',
  apiTestBaseUrl: '',
})

// 完整配置（含 projects）
const config = reactive<{ defaultProjectId: string }>({ defaultProjectId: '' })

const checks = reactive<Record<string, CheckResult>>({})

// 项目管理
const projects = ref<TestProject[]>([])
const showProjectModal = ref(false)
const editingProject = ref<TestProject | null>(null)
const savingProject = ref(false)
const checkingProject = ref<string | null>(null)
const discoveringProject = ref<string | null>(null)
const projectChecks = reactive<Record<string, ProjectCheckResult>>({})
const discoverLogs = reactive<Record<string, { stage: string; logs: string[] }>>({})

// 页面管理弹窗
const showPageManager = ref(false)
const pageManagerProjectId = ref('')
const pageManagerProjectName = ref('')
const pageManagerSets = ref<PageSet[]>([])
const pageManagerLoading = ref(false)
const expandedSetIds = reactive<Set<string>>(new Set())
// 新建页面集
const newSetName = ref('')
// 添加页面
const addingToSetId = ref<string | null>(null)
const newPageForm = reactive({ name: '', url: '', path: '', description: '' })
// 编辑页面
const editingPage = ref<PageConfig | null>(null)
const editPageForm = reactive({ name: '', url: '', path: '', description: '', targetSetId: '' })
// 重命名页面集
const renamingSetId = ref<string | null>(null)
const renameValue = ref('')
// 发现日志
const discoveryEntries = ref<{ name: string; status: string; routeCount: number; error?: string }[]>([])
const discoverySourceEntries = ref<string[]>([])
const showDiscoveryLog = ref(false)
// 页面详情
const detailPage = ref<PageConfig | null>(null)
const detailPageBaseUrl = ref('')

const projectForm = reactive({
  name: '',
  baseUrl: '',
  apiBaseUrl: '',
  loginUrl: '/web/index.html#/login',
  username: '',
  password: '',
  sourcePath: '',
})

function resetProjectForm() {
  projectForm.name = ''
  projectForm.baseUrl = ''
  projectForm.apiBaseUrl = ''
  projectForm.loginUrl = '/web/index.html#/login'
  projectForm.username = ''
  projectForm.password = ''
  projectForm.sourcePath = ''
}

function totalPages(project: TestProject): number {
  return project.pageSets?.reduce((sum, ps) => sum + ps.pages.length, 0) || 0
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(async () => {
  try {
    // 加载基础配置
    const settingsRes = await getSettings()
    Object.assign(form, settingsRes.data)
    config.defaultProjectId = (settingsRes.data as any).defaultProjectId || ''

    // 加载项目列表
    const projectsRes = await fetchProjects()
    projects.value = projectsRes.data
  } catch (e: any) {
    message.value = { type: 'error', text: '加载配置失败: ' + e.message }
  } finally {
    loading.value = false
  }
})

// ========== 项目操作 ==========

function openAddProject() {
  editingProject.value = null
  resetProjectForm()
  showProjectModal.value = true
}

function editProject(project: TestProject) {
  editingProject.value = project
  projectForm.name = project.name
  projectForm.baseUrl = project.baseUrl
  projectForm.apiBaseUrl = project.apiBaseUrl
  projectForm.loginUrl = project.loginUrl
  projectForm.username = project.username
  projectForm.password = '' // 不回显密码
  projectForm.sourcePath = project.sourcePath || ''
  showProjectModal.value = true
}

async function saveProject() {
  if (!projectForm.name || !projectForm.baseUrl || !projectForm.username) {
    message.value = { type: 'error', text: '请填写必填字段: 名称、前端地址、用户名' }
    return
  }

  savingProject.value = true
  message.value = null
  try {
    if (editingProject.value) {
      // 编辑
      const updates: any = {
        name: projectForm.name,
        baseUrl: projectForm.baseUrl.replace(/\/+$/, ''),
        apiBaseUrl: (projectForm.apiBaseUrl || projectForm.baseUrl).replace(/\/+$/, ''),
        loginUrl: projectForm.loginUrl,
        username: projectForm.username,
        sourcePath: projectForm.sourcePath,
      }
      if (projectForm.password) updates.password = projectForm.password
      const res = await apiUpdateProject(editingProject.value.id, updates)
      // 更新本地列表
      const idx = projects.value.findIndex(p => p.id === editingProject.value!.id)
      if (idx >= 0) projects.value[idx] = res.data
    } else {
      // 新增
      if (!projectForm.password) {
        message.value = { type: 'error', text: '请填写密码' }
        savingProject.value = false
        return
      }
      const res = await apiAddProject({
        name: projectForm.name,
        baseUrl: projectForm.baseUrl.replace(/\/+$/, ''),
        apiBaseUrl: (projectForm.apiBaseUrl || projectForm.baseUrl).replace(/\/+$/, ''),
        loginUrl: projectForm.loginUrl,
        username: projectForm.username,
        password: projectForm.password,
        sourcePath: projectForm.sourcePath,
      } as any)
      projects.value.push(res.data)
    }
    showProjectModal.value = false
    message.value = { type: 'success', text: editingProject.value ? '项目已更新' : '项目已添加' }
  } catch (e: any) {
    message.value = { type: 'error', text: '保存失败: ' + e.message }
  } finally {
    savingProject.value = false
  }
}

async function doDeleteProject(id: string) {
  if (!confirm('确定要删除此项目吗？页面集数据将一并删除。')) return
  try {
    await apiDeleteProject(id)
    projects.value = projects.value.filter(p => p.id !== id)
    delete projectChecks[id]
    message.value = { type: 'success', text: '项目已删除' }
  } catch (e: any) {
    message.value = { type: 'error', text: '删除失败: ' + e.message }
  }
}

async function setDefault(id: string) {
  try {
    await apiSetDefault(id)
    config.defaultProjectId = id
    message.value = { type: 'success', text: '默认项目已切换' }
  } catch (e: any) {
    message.value = { type: 'error', text: '设置失败: ' + e.message }
  }
}

async function doCheckProject(id: string) {
  checkingProject.value = id
  try {
    const res = await apiCheckProject(id)
    projectChecks[id] = res.data
    const allOk = Object.values(res.data).every(v => v.ok)
    message.value = {
      type: allOk ? 'success' : 'error',
      text: allOk ? '项目连通性检测全部通过' : '部分检测项异常',
    }
  } catch (e: any) {
    message.value = { type: 'error', text: '检测失败: ' + e.message }
  } finally {
    checkingProject.value = null
  }
}

// 发现模式
const discoverMode = ref<'runtime' | 'source' | 'both'>('both')
const showDiscoverDialog = ref(false)
const discoverDialogProject = ref<TestProject | null>(null)

function openDiscoverDialog(project: TestProject) {
  discoverDialogProject.value = project
  // 有源码路径默认走 both，没有默认走 runtime
  discoverMode.value = project.sourcePath ? 'both' : 'runtime'
  showDiscoverDialog.value = true
}

function confirmDiscover() {
  if (!discoverDialogProject.value) return
  showDiscoverDialog.value = false
  doDiscover(discoverDialogProject.value.id)
}

async function doDiscover(id: string) {
  discoveringProject.value = id
  discoverLogs[id] = { stage: 'init', logs: [`开始页面发现（模式: ${discoverMode.value}）...`] }
  message.value = null

  try {
    await apiDiscoverProject(id, discoverMode.value, (progress) => {
      if (!discoverLogs[id]) discoverLogs[id] = { stage: '', logs: [] }
      discoverLogs[id].stage = progress.stage
      discoverLogs[id].logs.push(progress.message)
    })

    // 刷新项目列表
    const projectsRes = await fetchProjects()
    projects.value = projectsRes.data

    message.value = { type: 'success', text: '页面发现完成' }
  } catch (e: any) {
    message.value = { type: 'error', text: '发现失败: ' + e.message }
    if (discoverLogs[id]) {
      discoverLogs[id].logs.push(`❌ 错误: ${e.message}`)
    }
  } finally {
    discoveringProject.value = null
  }
}

// ========== 基础配置操作 ==========

async function doSave() {
  saving.value = true
  message.value = null
  try {
    await updateSettings({ ...form })
    message.value = { type: 'success', text: '配置已保存，立即生效（无需重启）' }
  } catch (e: any) {
    message.value = { type: 'error', text: '保存失败: ' + e.message }
  } finally {
    saving.value = false
  }
}

async function doCheck() {
  checking.value = true
  message.value = null
  try {
    const res = await checkSettings()
    Object.keys(res.data).forEach(k => { checks[k] = res.data[k] })
    const allOk = Object.values(res.data).every(v => v.ok)
    message.value = {
      type: allOk ? 'success' : 'error',
      text: allOk ? '所有配置项检测通过' : '部分配置项异常，请检查标红项',
    }
  } catch (e: any) {
    message.value = { type: 'error', text: '检测失败: ' + e.message }
  } finally {
    checking.value = false
  }
}

// ========== 页面管理 ==========

const pageManagerTotalPages = computed(() => {
  return pageManagerSets.value.reduce((s, ps) => s + ps.pages.length, 0)
})

async function openPageManager(project: TestProject) {
  pageManagerProjectId.value = project.id
  pageManagerProjectName.value = project.name
  detailPageBaseUrl.value = project.baseUrl
  showPageManager.value = true
  pageManagerLoading.value = true
  expandedSetIds.clear()
  addingToSetId.value = null
  editingPage.value = null
  renamingSetId.value = null
  newSetName.value = ''
  discoveryEntries.value = []
  discoverySourceEntries.value = []
  showDiscoveryLog.value = false

  try {
    const [pagesRes, logRes] = await Promise.all([
      getProjectPages(project.id),
      getDiscoveryLog(project.id),
    ])
    pageManagerSets.value = pagesRes.data
    discoveryEntries.value = logRes.data.entries || []
    discoverySourceEntries.value = logRes.data.sourceEntries || []
  } catch (e: any) {
    message.value = { type: 'error', text: '加载页面数据失败: ' + e.message }
  } finally {
    pageManagerLoading.value = false
  }
}

function closePageManager() {
  showPageManager.value = false
  // 刷新项目列表
  fetchProjects().then(res => { projects.value = res.data })
}

function toggleSetExpand(setId: string) {
  if (expandedSetIds.has(setId)) {
    expandedSetIds.delete(setId)
  } else {
    expandedSetIds.add(setId)
  }
}

async function doCreateSet() {
  if (!newSetName.value.trim()) return
  try {
    const res = await apiCreatePageSet(pageManagerProjectId.value, newSetName.value.trim())
    pageManagerSets.value.push(res.data)
    newSetName.value = ''
  } catch (e: any) {
    message.value = { type: 'error', text: '创建失败: ' + e.message }
  }
}

function startRenameSet(ps: PageSet) {
  renamingSetId.value = ps.id
  renameValue.value = ps.name
}

async function doRenameSet(setId: string) {
  if (!renameValue.value.trim()) return
  try {
    await apiUpdatePageSet(pageManagerProjectId.value, setId, { name: renameValue.value.trim() })
    const set = pageManagerSets.value.find(s => s.id === setId)
    if (set) set.name = renameValue.value.trim()
    renamingSetId.value = null
  } catch (e: any) {
    message.value = { type: 'error', text: '重命名失败: ' + e.message }
  }
}

async function doDeleteSet(setId: string) {
  const set = pageManagerSets.value.find(s => s.id === setId)
  if (!confirm(`确定删除页面集「${set?.name}」及其下 ${set?.pages.length || 0} 个页面？`)) return
  try {
    await apiDeletePageSet(pageManagerProjectId.value, setId)
    pageManagerSets.value = pageManagerSets.value.filter(s => s.id !== setId)
    expandedSetIds.delete(setId)
  } catch (e: any) {
    message.value = { type: 'error', text: '删除失败: ' + e.message }
  }
}

function startAddPage(setId: string) {
  addingToSetId.value = setId
  newPageForm.name = ''
  newPageForm.url = ''
  newPageForm.path = ''
  newPageForm.description = ''
  // 自动展开
  expandedSetIds.add(setId)
}

async function doAddPage(setId: string) {
  if (!newPageForm.name.trim() || !newPageForm.path.trim()) {
    message.value = { type: 'error', text: '页面名称和路径不能为空' }
    return
  }
  try {
    const res = await apiAddPageToSet(pageManagerProjectId.value, setId, {
      name: newPageForm.name.trim(),
      url: newPageForm.url.trim() || newPageForm.path.trim(),
      path: newPageForm.path.trim(),
      description: newPageForm.description.trim(),
    })
    const set = pageManagerSets.value.find(s => s.id === setId)
    if (set) set.pages.push(res.data)
    addingToSetId.value = null
  } catch (e: any) {
    message.value = { type: 'error', text: '添加失败: ' + e.message }
  }
}

function startEditPage(page: PageConfig, currentSetId: string) {
  editingPage.value = page
  editPageForm.name = page.name
  editPageForm.url = page.url
  editPageForm.path = page.path
  editPageForm.description = page.description || ''
  editPageForm.targetSetId = ''
}

async function doEditPage() {
  if (!editingPage.value) return
  try {
    await apiUpdatePage(pageManagerProjectId.value, {
      pageId: editingPage.value.id,
      name: editPageForm.name.trim(),
      url: editPageForm.url.trim(),
      path: editPageForm.path.trim(),
      description: editPageForm.description.trim(),
      targetSetId: editPageForm.targetSetId || undefined,
    })
    // 如果移动了页面，需要刷新整个列表
    if (editPageForm.targetSetId) {
      const res = await getProjectPages(pageManagerProjectId.value)
      pageManagerSets.value = res.data
    } else {
      // 就地更新
      const page = editingPage.value
      page.name = editPageForm.name.trim()
      page.url = editPageForm.url.trim()
      page.path = editPageForm.path.trim()
      page.description = editPageForm.description.trim()
    }
    editingPage.value = null
  } catch (e: any) {
    message.value = { type: 'error', text: '编辑失败: ' + e.message }
  }
}

async function doDeletePage(pageId: string, setId: string) {
  if (!confirm('确定删除此页面？')) return
  try {
    await apiDeletePage(pageManagerProjectId.value, pageId)
    const set = pageManagerSets.value.find(s => s.id === setId)
    if (set) set.pages = set.pages.filter(p => p.id !== pageId)
  } catch (e: any) {
    message.value = { type: 'error', text: '删除失败: ' + e.message }
  }
}

function openPageUrl(page: PageConfig) {
  const fullUrl = detailPageBaseUrl.value + page.url
  window.open(fullUrl, '_blank')
}

function showPageDetail(page: PageConfig) {
  detailPage.value = page
}
</script>

<style scoped>
.settings-page {
  padding: 24px 32px;
  max-width: 900px;
}
.page-header {
  margin-bottom: 28px;
}
.page-header h1 {
  font-size: 22px;
  font-weight: 600;
  color: #1a1a2e;
}
.subtitle {
  color: #888;
  font-size: 14px;
  margin-top: 4px;
}
.loading {
  text-align: center;
  padding: 60px;
  color: #888;
  font-size: 16px;
}
.setting-section {
  background: #fff;
  border-radius: 10px;
  padding: 20px 24px;
  margin-bottom: 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}
.setting-section > .section-title {
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
}
.form-group {
  margin-bottom: 16px;
}
.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}
.required {
  color: #ff4d4f;
}
.field-desc {
  font-size: 12px;
  color: #999;
  margin-bottom: 6px;
}
.input-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.input-row input,
.form-group input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
  box-sizing: border-box;
}
.input-row input {
  flex: 1;
}
.input-row input:focus,
.form-group input:focus {
  border-color: #667eea;
  outline: none;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.15);
}
.check-badge {
  font-size: 12px;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 4px;
  margin-right: 4px;
}
.check-badge.ok {
  color: #52c41a;
  background: #f6ffed;
}
.check-badge.err {
  color: #ff4d4f;
  background: #fff2f0;
}
.check-badge.pending {
  color: #999;
  background: #f5f5f5;
}
.env-check-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.env-check-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #fafafa;
  border-radius: 6px;
}
.env-label {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}
.actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}
.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
  background: #f0f0f0;
  color: #333;
}
.btn-sm:hover:not(:disabled) {
  background: #e0e0e0;
}
.btn-sm.btn-check {
  background: #e6f7ff;
  color: #1890ff;
}
.btn-sm.btn-check:hover:not(:disabled) {
  background: #bae7ff;
}
.btn-sm.btn-danger {
  background: #fff2f0;
  color: #ff4d4f;
}
.btn-sm.btn-danger:hover:not(:disabled) {
  background: #ffccc7;
}
.btn-add {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  font-size: 13px;
  padding: 6px 14px;
}
.btn-add:hover {
  opacity: 0.9;
}
.btn-check {
  background: #f0f0f0;
  color: #333;
}
.btn-check:hover:not(:disabled) {
  background: #e0e0e0;
}
.btn-save {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn-save:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-cancel {
  background: #f0f0f0;
  color: #333;
}
.message {
  margin-top: 16px;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 14px;
}
.message.success {
  background: #f6ffed;
  color: #52c41a;
  border: 1px solid #b7eb8f;
}
.message.error {
  background: #fff2f0;
  color: #ff4d4f;
  border: 1px solid #ffccc7;
}

/* 项目卡片 */
.project-card {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  transition: border-color 0.2s;
}
.project-card:hover {
  border-color: #d9d9d9;
}
.project-card.default {
  border-color: #667eea;
  border-width: 2px;
}
.project-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.project-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.project-name {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a2e;
}
.project-actions {
  display: flex;
  gap: 6px;
}
.project-detail {
  margin-bottom: 4px;
}
.project-url {
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
}
.project-stats {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #888;
}
.text-muted {
  color: #bbb;
}
.project-check-results {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f5f5f5;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.discover-progress {
  margin-top: 8px;
  padding: 8px 12px;
  background: #fafbff;
  border: 1px solid #e0e0f0;
  border-radius: 6px;
  font-size: 12px;
}
.discover-progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  font-weight: 500;
  color: #667eea;
}
.discover-stage {
  font-size: 11px;
  background: #f0f0ff;
  padding: 1px 6px;
  border-radius: 3px;
}
.discover-log {
  color: #666;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.btn-discover {
  background: #667eea !important;
  color: #fff !important;
}
.btn-discover:hover:not(:disabled) {
  background: #5a6fd6 !important;
}
.empty-projects {
  text-align: center;
  padding: 24px;
  color: #bbb;
  font-size: 14px;
}
.badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
}
.badge-default {
  background: #667eea;
  color: #fff;
}
.badge-active {
  background: #f6ffed;
  color: #52c41a;
}
.badge-inactive {
  background: #f5f5f5;
  color: #999;
}

/* 弹窗 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}
.modal-content {
  background: #fff;
  border-radius: 12px;
  padding: 24px 28px;
  width: 480px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
.modal-content h3 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 20px;
  color: #1a1a2e;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
.modal-wide {
  width: 860px;
  max-height: 90vh;
}

/* 页面管理 */
.btn-manage {
  background: #f9f0ff !important;
  color: #722ed1 !important;
}
.btn-manage:hover:not(:disabled) {
  background: #efdbff !important;
}
.page-set-list {
  margin-top: 12px;
  max-height: 55vh;
  overflow-y: auto;
}
.page-set-block {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  margin-bottom: 8px;
  overflow: hidden;
}
.page-set-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #fafafa;
  cursor: pointer;
  user-select: none;
}
.page-set-header:hover {
  background: #f5f5f5;
}
.expand-icon {
  font-size: 10px;
  color: #999;
  width: 14px;
}
.page-set-name {
  font-weight: 500;
  font-size: 13px;
  color: #333;
  flex: 1;
}
.page-set-count {
  font-size: 11px;
  color: #999;
  background: #f0f0f0;
  padding: 1px 6px;
  border-radius: 3px;
}
.page-set-actions {
  display: flex;
  gap: 4px;
}
.page-list {
  padding: 8px 12px;
}
.page-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 13px;
}
.page-item:hover {
  background: #f9f9fb;
}
.page-name {
  font-weight: 500;
  color: #333;
  min-width: 120px;
}
.page-path {
  color: #999;
  font-family: monospace;
  font-size: 12px;
  flex: 1;
}
.page-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.page-item:hover .page-actions {
  opacity: 1;
}
.empty-pages {
  text-align: center;
  color: #ccc;
  font-size: 12px;
  padding: 12px;
}
.add-set-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}
.inline-input {
  padding: 4px 8px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  font-size: 12px;
  flex: 1;
  min-width: 0;
}
.rename-input {
  padding: 2px 6px;
  border: 1px solid #667eea;
  border-radius: 4px;
  font-size: 13px;
  width: 200px;
}
.add-page-form, .edit-page-form {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
  background: #fafbff;
  border-radius: 4px;
  margin-bottom: 4px;
}
.move-select {
  padding: 4px 6px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  font-size: 12px;
}
.btn-xs {
  padding: 2px 8px;
  font-size: 11px;
  background: #f0f0f0;
  color: #333;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}
.btn-xs:hover {
  background: #e0e0e0;
}
.btn-xs.btn-danger {
  background: #fff2f0;
  color: #ff4d4f;
}
.btn-xs.btn-danger:hover {
  background: #ffccc7;
}
.btn-xs.btn-save {
  background: #667eea;
  color: #fff;
}
.btn-xs.btn-cancel {
  background: #f0f0f0;
  color: #666;
}
.badge-warn {
  background: #fffbe6;
  color: #faad14;
  border: 1px solid #ffe58f;
}
.badge-info {
  background: #e6f7ff;
  color: #1890ff;
}

/* 发现日志 */
.discovery-log-panel {
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
}
.discovery-log-title {
  font-size: 13px;
  font-weight: 500;
  color: #666;
  margin-bottom: 8px;
}
.discovery-source-info {
  font-size: 12px;
  color: #667eea;
  background: #fafaff;
  padding: 6px 10px;
  border-radius: 4px;
  margin-bottom: 8px;
}
.badge-source {
  background: #f9f0ff;
  color: #722ed1;
  font-size: 10px;
  padding: 0 4px;
  border-radius: 2px;
  margin-left: 4px;
}
.discovery-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 3px;
  margin-bottom: 2px;
}
.discovery-entry.valid {
  background: #f6ffed;
}
.discovery-entry.error {
  background: #fff2f0;
}
.entry-status {
  width: 16px;
  text-align: center;
}
.entry-name {
  font-weight: 500;
  color: #333;
  min-width: 120px;
}
.entry-info {
  color: #999;
  font-size: 11px;
}

/* 打开按钮 */
.btn-open {
  background: #e6f7ff !important;
  color: #1890ff !important;
}
.btn-open:hover {
  background: #bae7ff !important;
}

/* 页面详情 */
.page-detail-panel {
  margin-top: 12px;
  background: #fafbff;
  border: 1px solid #e0e0f0;
  border-radius: 6px;
  padding: 12px 16px;
}
.page-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 500;
  font-size: 13px;
  color: #667eea;
  margin-bottom: 8px;
}
.page-detail-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 4px 0;
  font-size: 13px;
}
.page-detail-row label {
  min-width: 70px;
  color: #999;
  font-size: 12px;
}
.page-detail-row code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
  color: #333;
  word-break: break-all;
}

/* 发现模式选择 */
.discover-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}
.discover-option {
  border: 2px solid #f0f0f0;
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.15s;
}
.discover-option:hover {
  border-color: #d9d9d9;
}
.discover-option.active {
  border-color: #667eea;
  background: #fafaff;
}
.discover-option-title {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 2px;
}
.discover-option.active .discover-option-title {
  color: #667eea;
}
.discover-option-desc {
  font-size: 12px;
  color: #999;
}
</style>
