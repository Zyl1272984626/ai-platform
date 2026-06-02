<template>
  <div class="deploy-page">
    <!-- Toast -->
    <Transition name="toast">
      <div v-if="message" class="toast" :class="message.type">{{ message.text }}</div>
    </Transition>

    <header class="page-header">
      <div class="header-left">
        <button class="btn-back" @click="router.push(`/schools/${code}`)">&larr; 返回配置</button>
        <div>
          <h1>生成部署包 - {{ school?.name || '...' }}</h1>
          <p class="page-desc">选择需要包含的部署步骤，生成 WAR + 分阶段部署脚本</p>
        </div>
      </div>
    </header>

    <div v-if="loading" class="loading">加载中...</div>

    <div v-else-if="!school" class="loading">学校不存在</div>

    <div v-else class="deploy-content">
      <!-- 配置摘要 -->
      <section class="setting-section">
        <h2 class="section-title">配置摘要</h2>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="label">目标服务器</span>
            <span class="value mono">{{ school.deploy?.host || '-' }}</span>
          </div>
          <div class="summary-item">
            <span class="label">应用服务器系统</span>
            <span class="value mono">{{ appServerLabel }}</span>
          </div>
          <div class="summary-item">
            <span class="label">SSH 用户</span>
            <span class="value mono">{{ school.deploy?.user || 'root' }}</span>
          </div>
          <div class="summary-item">
            <span class="label">数据库 Root 密码</span>
            <span class="value mono">{{ school.deployConfig?.dbRootPassword ? '••••••' : '未配置' }}</span>
          </div>
          <div class="summary-item">
            <span class="label">MySQL Docker 容器</span>
            <span class="value mono">{{ school.deployConfig?.mysqlContainer || '未使用 Docker' }}</span>
          </div>
          <div class="summary-item">
            <span class="label">OneApi</span>
            <span class="value mono">{{ school.deployConfig?.oneapiHost || '-' }}:{{ school.deployConfig?.oneapiPort || 3000 }}</span>
          </div>
          <div class="summary-item">
            <span class="label">数据库</span>
            <span class="value mono">{{ school.dbHost || '-' }}:{{ school.dbPort || '-' }} / {{ school.database }}</span>
          </div>
          <div class="summary-item">
            <span class="label">应用端口</span>
            <span class="value mono">{{ school.port }}</span>
          </div>
        </div>
      </section>

      <!-- 脚本步骤选择 -->
      <section class="setting-section">
        <h2 class="section-title">选择部署步骤</h2>
        <p class="step-hint">建库脚本在应用启动前执行，系统配置脚本在应用启动并自动建表后执行</p>
        <div class="check-list">
          <label class="check-item">
            <input type="checkbox" v-model="options.createAgentDatabases" />
            <div class="check-content">
              <span class="check-title">创建 Agent 数据库</span>
              <span class="check-desc">自动创建 {{ school.database }} 和 {{ school.database }}_business，使用 utf8mb4_0900_as_cs 排序规则</span>
            </div>
          </label>
          <label class="check-item">
            <input type="checkbox" v-model="options.createOneapiDatabase" />
            <div class="check-content">
              <span class="check-title">创建 OneApi 数据库</span>
              <span class="check-desc">自动创建 oneapi 数据库；如果只需要前两个 Agent 库，可以取消勾选</span>
            </div>
          </label>
          <label class="check-item">
            <input type="checkbox" v-model="options.deployOneapi" />
            <div class="check-content">
              <span class="check-title">部署 OneApi 容器</span>
              <span class="check-desc">使用 Docker 部署 OneApi 服务，端口 {{ school.deployConfig?.oneapiPort || 3000 }}</span>
            </div>
          </label>
          <label class="check-item">
            <input type="checkbox" v-model="options.initSql" />
            <div class="check-content">
              <span class="check-title">启动后系统配置</span>
              <span class="check-desc">应用启动并自动建表后，更新 fs_sys_config 并初始化 ai_model_source</span>
            </div>
          </label>
        </div>
        <div class="step-summary">
          部署包将包含：01-db-create.sh → {{ appDeployScriptName }} → 03-system-config.sh；已选择：{{ activeSteps }}
        </div>
        <div v-if="skippedSteps.length > 0" class="skip-summary">
          配置不完整，将不生成：{{ skippedSteps.join('、') }}
        </div>
        <div v-if="warMissingFields.length > 0" class="missing-summary">
          生成 WAR 还缺少：{{ warMissingFields.join('、') }}
        </div>
      </section>

      <!-- Actions -->
      <div class="actions-bar">
        <button class="btn btn-deploy" @click="doDeploy" :disabled="deploying || warMissingFields.length > 0">
          {{ deploying ? '打包中...' : '生成部署包' }}
        </button>
        <button class="btn btn-config" @click="router.push(`/schools/${code}`)">修改配置</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { getSchool, deploySchoolFull } from '../api/schools'
import type { School } from '../api/types'

const router = useRouter()
const route = useRoute()
const code = route.params.code as string

const loading = ref(true)
const deploying = ref(false)
const school = ref<School | null>(null)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)
let messageTimer: ReturnType<typeof setTimeout> | null = null

function showMessage(type: 'success' | 'error', text: string) {
  if (messageTimer) clearTimeout(messageTimer)
  message.value = { type, text }
  messageTimer = setTimeout(() => { message.value = null }, 3000)
}

const options = reactive({
  createAgentDatabases: true,
  createOneapiDatabase: false,
  deployOneapi: true,
  initSql: true,
})

const appDeployScriptName = computed(() => {
  const serverOs = school.value?.deployConfig?.serverOs || school.value?.common?.serverOs
  return serverOs === 'windows' ? '02-app-deploy.ps1' : '02-app-deploy.sh'
})

const appServerLabel = computed(() => {
  const serverOs = school.value?.deployConfig?.serverOs || school.value?.common?.serverOs
  if (serverOs === 'windows') {
    return `Windows ${school.value?.deployConfig?.windowsDrive || school.value?.common?.windowsDrive || 'D:'}`
  }
  return 'Linux'
})

const warMissingFields = computed(() => {
  if (!school.value) return []
  const s = school.value
  const missing: string[] = []
  if (!s.dbHost) missing.push('DB Host')
  if (!s.dbPort) missing.push('DB Port')
  if (!s.database) missing.push('数据库名')
  if (!s.dbUser) missing.push('DB User')
  if (!s.dbPassword) missing.push('DB Password')
  if (!s.cas?.casHost) missing.push('CAS Host')
  return missing
})

const effectiveOptions = computed(() => {
  const s = school.value
  const dc = s?.deployConfig
  const hasOneapiForInit = !!dc?.oneapiHost && !!dc?.oneapiKey

  return {
    createAgentDatabases: options.createAgentDatabases && !!dc?.dbRootPassword,
    createOneapiDatabase: options.createOneapiDatabase && !!dc?.dbRootPassword,
    deployOneapi: options.deployOneapi && !!dc?.dbRootPassword,
    initSql: options.initSql && hasOneapiForInit,
  }
})

const activeSteps = computed(() => {
  const steps: string[] = []
  const effective = effectiveOptions.value
  if (effective.createAgentDatabases) steps.push('创建 Agent 数据库')
  if (effective.createOneapiDatabase) steps.push('创建 OneApi 数据库')
  if (effective.deployOneapi) steps.push('部署 OneApi')
  if (effective.initSql) steps.push('启动后系统配置')
  return steps.length ? steps.join(' → ') : '（无额外步骤）'
})

const skippedSteps = computed(() => {
  const skipped: string[] = []
  const effective = effectiveOptions.value
  if (options.createAgentDatabases && !effective.createAgentDatabases) skipped.push('创建 Agent 数据库（缺数据库 Root 密码）')
  if (options.createOneapiDatabase && !effective.createOneapiDatabase) skipped.push('创建 OneApi 数据库（缺数据库 Root 密码）')
  if (options.deployOneapi && !effective.deployOneapi) skipped.push('部署 OneApi（缺数据库 Root 密码）')
  if (options.initSql && !effective.initSql) skipped.push('启动后系统配置（缺 OneApi 地址或 OneApi Key）')
  return skipped
})

onMounted(async () => {
  try {
    school.value = await getSchool(code)
  } catch (e: any) {
    showMessage('error', '加载失败: ' + e.message)
  } finally {
    loading.value = false
  }
})

async function doDeploy() {
  if (!school.value) return
  const s = school.value
  const dc = s.deployConfig

  deploying.value = true
  try {
    const effective = effectiveOptions.value
    await deploySchoolFull(code, {
      deployHost: s.deploy?.host || '',
      deployUser: s.deploy?.user || 'root',
      dbRootPassword: dc?.dbRootPassword || '',
      mysqlContainer: dc?.mysqlContainer || '',
      oneapiHost: dc?.oneapiHost || '',
      oneapiPort: dc?.oneapiPort || 3000,
      oneapiKey: dc?.oneapiKey || '',
      knowledgeBaseUrl: dc?.knowledgeBaseUrl,
      knowledgeAppId: dc?.knowledgeAppId,
      knowledgeApiKey: dc?.knowledgeApiKey,
      voiceApiUrl: dc?.voiceApiUrl,
      createAgentDatabases: effective.createAgentDatabases,
      createOneapiDatabase: effective.createOneapiDatabase,
      oneapiDatabase: 'oneapi',
      deployOneapi: effective.deployOneapi,
      initSql: effective.initSql,
    })
    showMessage('success', '部署包已生成并下载')
  } catch (e: any) {
    showMessage('error', '部署失败: ' + e.message)
  } finally {
    deploying.value = false
  }
}
</script>

<style scoped>
.deploy-page {
  padding: 24px 32px;
  max-width: 800px;
  margin: 0 auto;
}
.page-header {
  margin-bottom: 24px;
}
.header-left {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.header-left h1 {
  font-size: 22px;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0 0 4px 0;
}
.page-desc {
  font-size: 13px;
  color: #999;
  margin: 0;
}
.btn-back {
  padding: 6px 14px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #666;
  margin-top: 2px;
}
.btn-back:hover { border-color: #667eea; color: #667eea; }
.loading { text-align: center; padding: 60px; color: #888; font-size: 16px; }

/* Sections */
.setting-section {
  background: #fff;
  border-radius: 10px;
  padding: 20px 24px;
  margin-bottom: 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
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
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.check-item:hover {
  border-color: #667eea;
  background: #f8f8ff;
}
.check-item input[type="checkbox"] {
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
.step-summary {
  margin-top: 14px;
  padding: 10px 14px;
  background: #f6f8ff;
  border-radius: 6px;
  font-size: 13px;
  color: #555;
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
.skip-summary {
  margin-top: 10px;
  padding: 10px 14px;
  background: #f6f8ff;
  border: 1px solid #d6e4ff;
  border-radius: 6px;
  font-size: 13px;
  color: #315399;
}

/* Actions */
.actions-bar {
  display: flex;
  gap: 12px;
  margin: 24px 0;
}
.btn {
  padding: 10px 32px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
}
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-deploy {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn-deploy:hover:not(:disabled) { opacity: 0.9; }
.btn-config {
  background: #f0f0f0;
  color: #333;
}
.btn-config:hover { background: #e0e0e0; }

/* Toast */
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 9999;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  max-width: 400px;
}
.toast.success { background: #f6ffed; color: #52c41a; border: 1px solid #b7eb8f; }
.toast.error { background: #fff2f0; color: #ff4d4f; border: 1px solid #ffccc7; }
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-12px); }
</style>
