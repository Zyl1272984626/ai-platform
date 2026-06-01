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
              <button class="btn btn-sm btn-discover" @click="doDiscover(project.id)" :disabled="discoveringProject === project.id">
                {{ discoveringProject === project.id ? '发现中...' : '发现页面' }}
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { getSettings, updateSettings, checkSettings, type PlatformConfig, type CheckResult } from '../api/settings'
import {
  getProjects as fetchProjects,
  addProject as apiAddProject,
  updateProject as apiUpdateProject,
  deleteProject as apiDeleteProject,
  setDefaultProject as apiSetDefault,
  checkProject as apiCheckProject,
  discoverProject as apiDiscoverProject,
  type TestProject,
  type ProjectCheckResult,
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

async function doDiscover(id: string) {
  discoveringProject.value = id
  discoverLogs[id] = { stage: 'init', logs: ['开始页面发现...'] }
  message.value = null

  try {
    await apiDiscoverProject(id, 'runtime', (progress) => {
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
</style>
