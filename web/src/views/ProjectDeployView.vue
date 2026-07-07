<template>
  <div class="deploy-page page-container">
    <PageHeader
      show-back
      :title="`生成部署包 - ${project?.name || '...'}`"
      description="选择需要包含的部署步骤，生成项目专属部署包"
      @back="router.push(`/schools/${code}/projects/${pcode}`)"
    />

    <div v-if="loading" class="loading">加载中...</div>

    <div v-else-if="!school" class="loading">学校不存在</div>

    <div v-else-if="!project" class="loading">项目不存在</div>

    <div v-else class="deploy-content">
      <!-- 配置摘要 -->
      <section class="setting-section">
        <h2 class="section-title">配置摘要</h2>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="label">目标服务器</span>
            <span class="value mono">{{ project.deploy.host || '-' }}</span>
          </div>
          <div class="summary-item">
            <span class="label">应用服务器系统</span>
            <span class="value mono">{{ appServerLabel }}</span>
          </div>
          <div class="summary-item">
            <span class="label">SSH 用户</span>
            <span class="value mono">{{ project.deploy.user || 'root' }}</span>
          </div>
          <div class="summary-item">
            <span class="label">应用端口</span>
            <span class="value mono">{{ project.deploy.appPort }}</span>
          </div>
          <div class="summary-item">
            <span class="label">数据库</span>
            <span class="value mono">{{ project.database }}</span>
          </div>
          <div class="summary-item">
            <span class="label">数据库连接</span>
            <span class="value mono">{{ project.dbHost || '-' }}:{{ project.dbPort || '-' }}</span>
          </div>
          <div class="summary-item">
            <span class="label">数据库 Root 密码</span>
            <span class="value mono secret-value">
              <span>{{ rootPasswordText }}</span>
              <button
                v-if="project.deploy.dbRootPassword"
                type="button"
                class="summary-secret-toggle"
                :title="showRootPassword ? '隐藏' : '显示'"
                :aria-label="showRootPassword ? '隐藏' : '显示'"
                @click="showRootPassword = !showRootPassword"
              >
                <component :is="showRootPassword ? EyeOffOutline : EyeOutline" />
              </button>
            </span>
          </div>
          <div class="summary-item">
            <span class="label">MySQL Docker 容器</span>
            <span class="value mono">{{ project.deploy.mysqlContainer || '未使用 Docker' }}</span>
          </div>
          <div v-if="isAgent" class="summary-item">
            <span class="label">OneApi</span>
            <span class="value mono">{{ project.deployConfig?.oneapiHost || '-' }}:{{ project.deployConfig?.oneapiPort || 3000 }}</span>
          </div>
        </div>
      </section>

      <!-- 部署步骤勾选 -->
      <section class="setting-section">
        <h2 class="section-title">选择部署步骤</h2>

        <!-- agent -->
        <template v-if="isAgent">
          <p class="step-hint">建库脚本在应用启动前执行，系统配置脚本在应用启动并自动建表后执行</p>
          <div class="check-list">
            <label class="check-item">
              <input type="checkbox" v-model="agentOptions.createAgentDatabases" />
              <div class="check-content">
                <span class="check-title">创建 Agent 数据库</span>
                <span class="check-desc">自动创建 {{ project.database }} 和 {{ project.businessDatabase || project.database + '_business' }}，使用 utf8mb4_0900_as_cs 排序规则</span>
              </div>
            </label>
            <label class="check-item">
              <input type="checkbox" v-model="agentOptions.createOneapiDatabase" />
              <div class="check-content">
                <span class="check-title">创建 OneApi 数据库</span>
                <span class="check-desc">自动创建 oneapi 数据库；如果只需要前两个 Agent 库，可以取消勾选</span>
              </div>
            </label>
            <label class="check-item">
              <input type="checkbox" v-model="agentOptions.deployOneapi" />
              <div class="check-content">
                <span class="check-title">部署 OneApi 容器</span>
                <span class="check-desc">使用 Docker 部署 OneApi 服务，端口 {{ project.deployConfig?.oneapiPort || 3000 }}</span>
              </div>
            </label>
            <label class="check-item">
              <input type="checkbox" v-model="agentOptions.initSql" />
              <div class="check-content">
                <span class="check-title">启动后系统配置</span>
                <span class="check-desc">应用启动并自动建表后，更新 fs_sys_config、ai_model_source 和 ai_file_storage</span>
              </div>
            </label>
            <label class="check-item">
              <input type="checkbox" v-model="agentOptions.installSandboxRuntime" />
              <div class="check-content">
                <span class="check-title">安装运行时环境依赖</span>
                <span class="check-desc">在 02 脚本中检查并安装 Node/npm、Python/pip、文档组件、LibreOffice、Poppler 和中文字体（仅 Linux 应用服务器生效）</span>
              </div>
            </label>
          </div>
          <div class="step-summary">
            部署包将包含：01-db-create.sh → {{ appDeployScriptName }} → 03-system-config.sh；已选择：{{ activeSteps }}
          </div>
          <div v-if="skippedSteps.length > 0" class="skip-summary">
            配置不完整，将不生成：{{ skippedSteps.join('、') }}
          </div>
        </template>

        <!-- knowledge-center -->
        <template v-else>
          <p class="step-hint">knowledge-center 通过 Docker 容器部署，JPA 自动建表，步骤较简单</p>
          <div class="check-list">
            <label class="check-item">
              <input type="checkbox" v-model="kcOptions.createDatabase" />
              <div class="check-content">
                <span class="check-title">创建 knowledge_center 数据库</span>
                <span class="check-desc">自动创建 knowledge_center 单库</span>
              </div>
            </label>
            <label class="check-item">
              <input type="checkbox" v-model="kcOptions.checkDependencies" />
              <div class="check-content">
                <span class="check-title">检查外部依赖连通性</span>
                <span class="check-desc">检查 Milvus/Neo4j/Redis 是否可达（不修改数据）</span>
              </div>
            </label>
          </div>
          <div class="info-box">
            knowledge-center 通过 Docker 容器部署，JPA 自动建表，无需启动后系统配置。
          </div>
        </template>

        <div v-if="missingFields.length > 0" class="missing-summary">
          生成部署包还缺少：{{ missingFields.join('、') }}
        </div>
      </section>

      <!-- 操作栏 -->
      <div class="deploy-modes">
        <div class="mode-card mode-primary">
          <div class="mode-info">
            <span class="mode-title">仅生成 WAR</span>
            <span class="mode-desc">增量更新：只构建并替换 WAR 包，不含部署脚本/建库/系统配置。适用于已首次部署后的版本更新。</span>
          </div>
          <button class="btn btn-war" :disabled="buildingWar || missingFields.length > 0" @click="doBuildWar">
            {{ buildingWar ? '构建中...' : '生成 WAR' }}
          </button>
        </div>
        <div class="mode-card">
          <div class="mode-info">
            <span class="mode-title">生成完整部署包</span>
            <span class="mode-desc">首次部署/重装：WAR + 分阶段部署脚本（建库、应用准备、系统配置）打包成 ZIP。</span>
          </div>
          <button class="btn btn-deploy" :disabled="deploying || missingFields.length > 0" @click="doDeploy">
            {{ deploying ? '打包中...' : '生成部署包' }}
          </button>
        </div>
      </div>
      <div class="actions-bar">
        <button class="btn btn-config" @click="router.push(`/schools/${code}/projects/${pcode}`)">修改配置</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { EyeOffOutline, EyeOutline } from '@vicons/ionicons5'
import PageHeader from '../components/layout/PageHeader.vue'
import { useToast } from '../composables/useToast'
import { getSchool, deployProjectFull, deployProject } from '../api/schools'
import type { School, Project } from '../api/types'

const router = useRouter()
const route = useRoute()
const code = route.params.code as string
const pcode = route.params.pcode as string
const { toast } = useToast()

const loading = ref(true)
const deploying = ref(false)
const buildingWar = ref(false)
const showRootPassword = ref(false)
const school = ref<School | null>(null)

const project = computed<Project | undefined>(() =>
  school.value?.projects.find(p => p.code === pcode),
)

const isAgent = computed(() => project.value?.type === 'agent')

// agent 步骤勾选
const agentOptions = reactive({
  createAgentDatabases: true,
  createOneapiDatabase: false,
  deployOneapi: true,
  initSql: true,
  installSandboxRuntime: true,
})

// knowledge-center 步骤勾选（建库 / 依赖检查由后端脚本固定生成，前端仅作确认）
const kcOptions = reactive({
  createDatabase: true,
  checkDependencies: true,
})

const appDeployScriptName = computed(() =>
  project.value?.deploy.serverOs === 'windows' ? '02-app-deploy.ps1' : '02-app-deploy.sh',
)

const appServerLabel = computed(() => {
  const os = project.value?.deploy.serverOs
  if (os === 'windows') {
    return `Windows ${project.value?.deploy.windowsDrive || 'D:'}`
  }
  return 'Linux'
})

const rootPasswordText = computed(() => {
  const pw = project.value?.deploy.dbRootPassword
  if (!pw) return '未配置'
  return showRootPassword.value ? pw : '••••••'
})

/** 必填字段缺失时禁用生成按钮并提示 */
const missingFields = computed(() => {
  if (!project.value) return []
  const p = project.value
  const missing: string[] = []
  if (!p.deploy.host) missing.push('目标服务器')
  if (!p.database) missing.push('数据库名')
  if (!p.dbHost) missing.push('DB Host')
  if (!p.dbUser) missing.push('DB User')
  if (!p.dbPassword) missing.push('DB Password')
  return missing
})

/** agent：根据配置完整性计算实际生效的步骤 */
const effectiveOptions = computed(() => {
  const p = project.value
  if (!p) {
    return {
      createAgentDatabases: false,
      createOneapiDatabase: false,
      deployOneapi: false,
      initSql: false,
      installSandboxRuntime: false,
    }
  }
  const dc = p.deployConfig
  const hasRoot = !!p.deploy.dbRootPassword
  const hasOneapiForInit = !!dc?.oneapiHost && !!dc?.oneapiKey
  const serverOs = p.deploy.serverOs
  return {
    createAgentDatabases: agentOptions.createAgentDatabases && hasRoot,
    createOneapiDatabase: agentOptions.createOneapiDatabase && hasRoot,
    deployOneapi: agentOptions.deployOneapi && hasRoot,
    initSql: agentOptions.initSql && hasOneapiForInit,
    // 运行时环境安装脚本只生成 Linux 版，Windows 应用服务器跳过
    installSandboxRuntime: agentOptions.installSandboxRuntime && serverOs !== 'windows',
  }
})

const activeSteps = computed(() => {
  const eff = effectiveOptions.value
  const steps: string[] = []
  if (eff.createAgentDatabases) steps.push('创建 Agent 数据库')
  if (eff.createOneapiDatabase) steps.push('创建 OneApi 数据库')
  if (eff.deployOneapi) steps.push('部署 OneApi')
  if (eff.installSandboxRuntime) steps.push('安装运行时环境')
  if (eff.initSql) steps.push('启动后系统配置')
  return steps.length ? steps.join(' → ') : '（无额外步骤）'
})

const skippedSteps = computed(() => {
  const eff = effectiveOptions.value
  const skipped: string[] = []
  if (agentOptions.createAgentDatabases && !eff.createAgentDatabases) skipped.push('创建 Agent 数据库（缺数据库 Root 密码）')
  if (agentOptions.createOneapiDatabase && !eff.createOneapiDatabase) skipped.push('创建 OneApi 数据库（缺数据库 Root 密码）')
  if (agentOptions.deployOneapi && !eff.deployOneapi) skipped.push('部署 OneApi（缺数据库 Root 密码）')
  if (agentOptions.initSql && !eff.initSql) skipped.push('启动后系统配置（缺 OneApi 地址或 OneApi Key）')
  if (agentOptions.installSandboxRuntime && !eff.installSandboxRuntime) skipped.push('安装运行时环境（仅 Linux 应用服务器支持）')
  return skipped
})

onMounted(async () => {
  try {
    school.value = await getSchool(code)
  } catch (e: any) {
    toast.error('加载失败: ' + e.message)
  } finally {
    loading.value = false
  }
})

async function doDeploy() {
  const p = project.value
  if (!p) return

  deploying.value = true
  try {
    if (isAgent.value) {
      const eff = effectiveOptions.value
      const dc = p.deployConfig
      await deployProjectFull(code, pcode, {
        createAgentDatabases: eff.createAgentDatabases,
        createOneapiDatabase: eff.createOneapiDatabase,
        deployOneapi: eff.deployOneapi,
        initSql: eff.initSql,
        installSandboxRuntime: eff.installSandboxRuntime,
        dbRootPassword: p.deploy.dbRootPassword || '',
        oneapiHost: dc?.oneapiHost || '',
        oneapiPort: dc?.oneapiPort || 3000,
        oneapiKey: dc?.oneapiKey || '',
        mysqlContainer: p.deploy.mysqlContainer || '',
      })
    } else {
      // kc：建库与依赖检查由后端脚本固定生成，前端不传特殊开关
      await deployProjectFull(code, pcode, {
        createAgentDatabases: false,
        deployOneapi: false,
        initSql: false,
        dbRootPassword: p.deploy.dbRootPassword || '',
        mysqlContainer: p.deploy.mysqlContainer || '',
      })
    }
    toast.success('部署包已生成并下载')
  } catch (e: any) {
    toast.error('部署失败: ' + e.message)
  } finally {
    deploying.value = false
  }
}

/** 仅生成 WAR（增量更新，不含脚本/配置初始化） */
async function doBuildWar() {
  if (!project.value) return
  if (!confirm(`仅为「${project.value.name}」生成 WAR 包？\n将执行 Maven 构建并替换配置，不含部署脚本。`)) return
  buildingWar.value = true
  try {
    await deployProject(code, pcode)
    toast.success('WAR 已生成并下载')
  } catch (e: any) {
    toast.error('构建失败: ' + e.message)
  } finally {
    buildingWar.value = false
  }
}
</script>

<style scoped>
.loading {
  text-align: center;
  padding: 60px;
  color: #888;
  font-size: 16px;
}

/* Sections */
.setting-section {
  background: #fff;
  border-radius: 10px;
  padding: 20px 24px;
  margin-bottom: 20px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-light);
}

/* Summary */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 24px;
}
.summary-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.summary-item .label {
  font-size: 12px;
  color: #999;
}
.summary-item .value {
  font-size: 14px;
  color: #333;
}
.summary-item .value.mono {
  font-family: monospace;
  font-size: 13px;
}
.secret-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
}
.summary-secret-toggle {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.summary-secret-toggle:hover {
  background: var(--bg-surface-2);
  color: #667eea;
}
.summary-secret-toggle svg {
  width: 16px;
  height: 16px;
  display: block;
}

/* Check list */
.step-hint {
  font-size: 13px;
  color: #888;
  margin: 0 0 14px 0;
}
.check-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.check-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.check-item:hover {
  border-color: #667eea;
  background: #f8f8ff;
}
.check-item input[type='checkbox'] {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  cursor: pointer;
  accent-color: #667eea;
}
.check-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.check-title {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}
.check-desc {
  font-size: 12px;
  color: #999;
}

/* Summary lines */
.step-summary {
  margin-top: 14px;
  padding: 10px 14px;
  background: #f6f8ff;
  border-radius: 6px;
  font-size: 13px;
  color: #555;
}
.skip-summary {
  margin-top: 10px;
  padding: 10px 14px;
  background: #f6f8ff;
  border: 1px solid #d6e4ff;
  border-radius: 6px;
  font-size: 13px;
  color: #315399;
}
.missing-summary {
  margin-top: 10px;
  padding: 10px 14px;
  background: #fff7e6;
  border: 1px solid #ffd591;
  border-radius: 6px;
  font-size: 13px;
  color: #ad6800;
}

/* knowledge-center 提示框 */
.info-box {
  margin-top: 14px;
  padding: 12px 14px;
  background: #f6f8ff;
  border: 1px solid #d6e4ff;
  border-radius: 6px;
  font-size: 13px;
  color: #315399;
  line-height: 1.6;
}

/* Actions */
.actions-bar {
  display: flex;
  gap: 12px;
  margin: 24px 0;
}

/* 两种打包模式 */
.deploy-modes {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin: 24px 0 0;
}
.mode-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
}
.mode-card.mode-primary {
  border-color: #667eea;
  background: #f8f8ff;
}
.mode-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mode-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.mode-desc {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}
.mode-card .btn {
  align-self: flex-start;
  padding: 9px 28px;
}
.btn-war {
  background: linear-gradient(135deg, #667eea, var(--brand-active));
  color: #fff;
}
.btn-war:hover:not(:disabled) {
  opacity: 0.9;
}
.btn {
  padding: 10px 32px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-deploy {
  background: var(--brand-active);
  color: #fff;
}
.btn-deploy:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-config {
  background: var(--border-light);
  color: #333;
}
.btn-config:hover {
  background: var(--border);
}
</style>
