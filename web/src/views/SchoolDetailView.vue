<template>
  <div class="detail-page">
    <!-- Toast -->
    <Transition name="toast">
      <div v-if="message" class="toast" :class="message.type">{{ message.text }}</div>
    </Transition>

    <!-- Header -->
    <header class="page-header">
      <div class="header-left">
        <button class="btn-back" @click="router.push('/schools')">&larr; 返回</button>
        <div>
          <h1>{{ school?.name || '加载中...' }}</h1>
          <StatusBadge v-if="school" :status="school.status" />
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-save" @click="doSave" :disabled="saving">
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading">加载中...</div>

    <div v-else-if="!school" class="loading">学校不存在</div>

    <div v-else class="detail-content">
      <!-- Basic Info -->
      <section class="setting-section">
        <h2 class="section-title">基础信息</h2>
        <div class="info-grid">
          <div class="info-item"><span class="label">编码</span><span class="value mono">{{ school.code }}</span></div>
          <div class="info-item"><span class="label">名称</span><span class="value">{{ school.name }}</span></div>
        </div>
      </section>

      <!-- Database -->
      <section class="setting-section">
        <h2 class="section-title">数据库配置</h2>
        <div class="form-grid">
          <div class="form-group">
            <label>数据库类型</label>
            <select v-model="form.type" @change="onDbTypeChange">
              <option value="mysql">MySQL</option>
              <option value="dameng">达梦</option>
            </select>
          </div>
          <div class="form-group">
            <label>DB Host</label>
            <input v-model="form.dbHost" placeholder="数据库主机地址" />
          </div>
          <div class="form-group">
            <label>DB Port</label>
            <input v-model.number="form.dbPort" type="number" placeholder="端口号" />
          </div>
          <div class="form-group">
            <label>数据库名</label>
            <input v-model="form.database" placeholder="例: agent_portal" />
          </div>
          <div class="form-group">
            <label>DB User</label>
            <input v-model="form.dbUser" placeholder="数据库用户名" />
          </div>
          <div class="form-group">
            <label>DB Password</label>
            <PasswordInput v-model="form.dbPassword" placeholder="数据库密码" />
          </div>
          <div class="form-group">
            <label>MySQL Docker 容器名</label>
            <input v-model="form.deployConfig.mysqlContainer" placeholder="可选；不填则使用宿主机 mysql 命令" />
          </div>
        </div>
      </section>

      <!-- CAS -->
      <section class="setting-section">
        <h2 class="section-title">CAS 配置</h2>
        <div class="form-grid">
          <div class="form-group toggle-group">
            <label>启用 CAS</label>
            <input type="checkbox" v-model="form.cas.enableCas" />
          </div>
          <div class="form-group toggle-group">
            <label>启用移动端 CAS</label>
            <input type="checkbox" v-model="form.cas.enableMobileCas" />
          </div>
          <div class="form-group">
            <label>CAS Host</label>
            <input v-model="form.cas.casHost" placeholder="例：http://192.168.73.136:8082/agent" />
          </div>
          <div class="form-group">
            <label>用户名</label>
            <input v-model="form.passwords.username" placeholder="登录用户名" />
          </div>
          <div class="form-group">
            <label>密码</label>
            <PasswordInput v-model="form.passwords.defaultPassword" placeholder="登录密码" />
          </div>
        </div>
      </section>

      <!-- Deploy Config -->
      <section class="setting-section">
        <h2 class="section-title">部署配置</h2>
        <div class="form-grid">
          <div class="form-group">
            <label>目标服务器</label>
            <input v-model="form.deploy.host" placeholder="例: 192.168.1.100" />
          </div>
          <div class="form-group">
            <label>应用服务器系统</label>
            <select v-model="form.deployConfig.serverOs">
              <option value="linux">Linux</option>
              <option value="windows">Windows</option>
            </select>
          </div>
          <div class="form-group" v-if="form.deployConfig.serverOs === 'windows'">
            <label>Windows 盘符</label>
            <select v-model="form.deployConfig.windowsDrive">
              <option value="C:">C:</option>
              <option value="D:">D:</option>
              <option value="E:">E:</option>
            </select>
          </div>
          <div class="form-group">
            <label>SSH 用户</label>
            <input v-model="form.deploy.user" placeholder="默认 root" />
          </div>
          <div class="form-group">
            <label>数据库 Root 密码</label>
            <PasswordInput v-model="form.deployConfig.dbRootPassword" placeholder="目标服务器数据库 root 密码" />
          </div>
        </div>
      </section>

      <!-- Security & Passwords (collapsible) -->
      <section class="setting-section collapsible">
        <h2 class="section-title clickable" @click="collapsed.security = !collapsed.security">
          <span>安全 & 密码</span>
          <span class="collapse-icon">{{ collapsed.security ? '▸' : '▾' }}</span>
        </h2>
        <div v-show="!collapsed.security" class="form-grid">
          <div class="form-group">
            <label>Security Mode</label>
            <input v-model="form.security.mode" placeholder="安全模式" />
          </div>
          <div class="form-group">
            <label>超级密码</label>
            <PasswordInput v-model="form.passwords.superPassword" placeholder="超级用户密码" />
          </div>
          <div class="form-group">
            <label>密码 Salt</label>
            <input v-model="form.passwords.salt" placeholder="加密盐值" />
          </div>
        </div>
      </section>

      <!-- Common (collapsible) -->
      <section class="setting-section collapsible">
        <h2 class="section-title clickable" @click="collapsed.common = !collapsed.common">
          <span>高级配置</span>
          <span class="collapse-icon">{{ collapsed.common ? '▸' : '▾' }}</span>
        </h2>
        <div v-show="!collapsed.common" class="form-grid">
          <div class="form-group">
            <label>高德地图 Key</label>
            <input v-model="form.common.amapKey" placeholder="AMap Key" />
          </div>
          <div class="form-group">
            <label>Druid 用户名</label>
            <input v-model="form.common.druidUser" placeholder="Druid 监控用户名" />
          </div>
          <div class="form-group">
            <label>Druid 密码</label>
            <PasswordInput v-model="form.common.druidPassword" placeholder="Druid 监控密码" />
          </div>
        </div>
      </section>

      <!-- OneApi Config (collapsible) -->
      <section class="setting-section collapsible">
        <h2 class="section-title clickable" @click="collapsed.oneapi = !collapsed.oneapi">
          <span>OneApi 配置</span>
          <span class="collapse-icon">{{ collapsed.oneapi ? '▸' : '▾' }}</span>
        </h2>
        <div v-show="!collapsed.oneapi" class="form-grid">
          <div class="form-group">
            <label>OneApi 地址</label>
            <input v-model="form.deployConfig.oneapiHost" placeholder="例: 192.168.1.100" />
          </div>
          <div class="form-group">
            <label>OneApi 端口</label>
            <input v-model.number="form.deployConfig.oneapiPort" type="number" placeholder="3000" />
          </div>
          <div class="form-group">
            <label>OneApi Key</label>
            <PasswordInput v-model="form.deployConfig.oneapiKey" placeholder="sk-xxx" />
          </div>
        </div>
      </section>

      <!-- Knowledge (collapsible) -->
      <section class="setting-section collapsible">
        <h2 class="section-title clickable" @click="collapsed.knowledge = !collapsed.knowledge">
          <span>知识中心配置</span>
          <span class="collapse-icon">{{ collapsed.knowledge ? '▸' : '▾' }}</span>
        </h2>
        <div v-show="!collapsed.knowledge" class="form-grid">
          <div class="form-group full">
            <label>Base URL</label>
            <input v-model="form.deployConfig.knowledgeBaseUrl" placeholder="例: http://192.168.1.100:9999" />
          </div>
          <div class="form-group">
            <label>APP ID</label>
            <input v-model="form.deployConfig.knowledgeAppId" placeholder="知识中心应用 ID" />
          </div>
          <div class="form-group">
            <label>API Key</label>
            <PasswordInput v-model="form.deployConfig.knowledgeApiKey" placeholder="知识中心 API Key" />
          </div>
        </div>
      </section>

      <!-- Voice API (collapsible) -->
      <section class="setting-section collapsible">
        <h2 class="section-title clickable" @click="collapsed.voice = !collapsed.voice">
          <span>语音配置</span>
          <span class="collapse-icon">{{ collapsed.voice ? '▸' : '▾' }}</span>
        </h2>
        <div v-show="!collapsed.voice" class="form-grid">
          <div class="form-group full">
            <label>语音识别 API 地址</label>
            <input v-model="form.deployConfig.voiceApiUrl" placeholder="例: http://192.168.1.10/voice-api" />
          </div>
        </div>
      </section>

      <!-- Actions -->
      <div class="actions-bar">
        <button class="btn btn-save" @click="doSave" :disabled="saving">
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import StatusBadge from '../components/common/StatusBadge.vue'
import PasswordInput from '../components/common/PasswordInput.vue'
import { getSchool, updateSchool } from '../api/schools'
import type { School } from '../api/types'

const router = useRouter()
const route = useRoute()
const code = route.params.code as string

const loading = ref(true)
const saving = ref(false)
const school = ref<School | null>(null)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)
let messageTimer: ReturnType<typeof setTimeout> | null = null

function showMessage(type: 'success' | 'error', text: string) {
  if (messageTimer) clearTimeout(messageTimer)
  message.value = { type, text }
  messageTimer = setTimeout(() => { message.value = null }, 3000)
}
// 三个区块默认折叠
const collapsed = reactive({
  security: true,
  common: true,
  oneapi: false,
  knowledge: true,
  voice: true,
})

// 默认值来自主系统当前配置文件
const DEFAULTS = {
  security: {
    mode: 'dev',
  },
  passwords: {
    username: '',
    defaultPassword: '111111',
    superPassword: 'fskj_dst_2023',
    salt: 'system_salt',
  },
  common: {
    amapKey: '3ef0e07e35a573719aba2f0d1f117e4f',
    druidUser: 'druid',
    druidPassword: '123456',
  },
}

const form = reactive({
  type: 'mysql' as 'mysql' | 'dameng',
  dbHost: '',
  dbPort: 5237,
  database: '',
  dbUser: '',
  dbPassword: '',
  deploy: {
    host: '',
    user: 'root',
  },
  cas: {
    enableCas: false,
    enableMobileCas: false,
    casHost: '',
    loginUrl: '',
    loginSuccess: '',
  },
  security: { ...DEFAULTS.security },
  passwords: { ...DEFAULTS.passwords },
  common: { ...DEFAULTS.common },
  deployConfig: {
    serverOs: 'linux' as 'linux' | 'windows',
    windowsDrive: 'D:',
    dbRootPassword: '',
    mysqlContainer: '',
    oneapiHost: '',
    oneapiPort: 3000,
    oneapiKey: '',
    knowledgeBaseUrl: '',
    knowledgeAppId: '',
    knowledgeApiKey: '',
    voiceApiUrl: '',
  },
})

onMounted(async () => {
  try {
    const data = await getSchool(code)
    school.value = data
    form.type = data.type || 'mysql'
    form.dbHost = data.dbHost || ''
    form.dbPort = data.dbPort ?? (data.type === 'mysql' ? 3306 : 5237)
    form.database = data.database || ''
    form.dbUser = data.dbUser || ''
    form.dbPassword = data.dbPassword || ''
    form.deploy.host = data.deploy?.host || ''
    form.deploy.user = data.deploy?.user || 'root'
    if (data.cas) Object.assign(form.cas, data.cas)
    // 已保存的覆盖默认值，未保存的保持默认
    if (data.security && hasContent(data.security as Record<string, unknown>)) Object.assign(form.security, data.security)
    if (data.passwords && hasContent(data.passwords as Record<string, unknown>)) Object.assign(form.passwords, data.passwords)
    if (data.common && hasContent(data.common as Record<string, unknown>)) Object.assign(form.common, data.common)
    if (data.deployConfig && hasContent(data.deployConfig as Record<string, unknown>)) Object.assign(form.deployConfig, data.deployConfig)
    if (!data.deployConfig?.serverOs && data.common?.serverOs) form.deployConfig.serverOs = data.common.serverOs
    if (!data.deployConfig?.windowsDrive && data.common?.windowsDrive) form.deployConfig.windowsDrive = data.common.windowsDrive
  } catch (e: any) {
    showMessage('error', '加载失败: ' + e.message)
  } finally {
    loading.value = false
  }
})

/** 判断对象是否有非空值（用于区分从未配置过 vs 明确配置过） */
function hasContent(obj: Record<string, unknown>): boolean {
  return Object.values(obj).some(v => v !== undefined && v !== null && v !== '')
}

function collectFormData() {
  return {
    status: 'configured' as const,
    type: form.type,
    dbHost: form.dbHost,
    dbPort: form.dbPort,
    database: form.database,
    dbUser: form.dbUser,
    dbPassword: form.dbPassword,
    deploy: {
      ...(school.value?.deploy || {}),
      host: form.deploy.host,
      user: form.deploy.user || 'root',
    },
    cas: { ...form.cas },
    security: { ...form.security },
    passwords: { ...form.passwords },
    common: { ...form.common },
    deployConfig: { ...form.deployConfig },
  }
}

function onDbTypeChange() {
  if (form.type === 'mysql' && (!form.dbPort || form.dbPort === 5237)) {
    form.dbPort = 3306
  }
  if (form.type === 'dameng' && (!form.dbPort || form.dbPort === 3306)) {
    form.dbPort = 5237
  }
}

async function doSave() {
  saving.value = true
  try {
    const updated = await updateSchool(code, collectFormData())
    school.value = updated
    showMessage('success', '配置已保存')
  } catch (e: any) {
    showMessage('error', '保存失败: ' + e.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.detail-page {
  padding: 24px 32px;
  max-width: 1000px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
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
.btn-back:hover {
  border-color: #667eea;
  color: #667eea;
}
.header-actions {
  display: flex;
  gap: 10px;
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
.btn-save {
  background: #f0f0f0;
  color: #333;
}
.btn-save:hover:not(:disabled) {
  background: #e0e0e0;
}
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
  color: #1a1a2e;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.section-title.clickable {
  cursor: pointer;
  user-select: none;
  margin-bottom: 0;
  border-bottom: none;
  transition: background 0.15s;
  border-radius: 6px;
  padding: 8px 12px;
  margin: -8px -12px 0;
}
.section-title.clickable:hover {
  background: #f8f8ff;
}
.collapse-icon {
  font-size: 14px;
  color: #999;
}

/* Info grid (read-only) */
.info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px 24px;
}
.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.info-item .label {
  font-size: 12px;
  color: #999;
}
.info-item .value {
  font-size: 14px;
  color: #333;
}
.info-item .value.mono {
  font-family: monospace;
  font-size: 13px;
}

/* Form grid */
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  padding-top: 12px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: #555;
}
.form-group input[type="text"],
.form-group input[type="password"],
.form-group input[type="number"],
.form-group select {
  padding: 8px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}
.form-group input:focus,
.form-group select:focus {
  border-color: #667eea;
  outline: none;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.15);
}
.toggle-group {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.toggle-group label {
  margin: 0;
}
.toggle-group input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

/* Actions bar */
.actions-bar {
  display: flex;
  gap: 12px;
  margin: 24px 0;
}

/* Toast */
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 9999;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  max-width: 400px;
}
.toast.success {
  background: #f6ffed;
  color: #52c41a;
  border: 1px solid #b7eb8f;
}
.toast.error {
  background: #fff2f0;
  color: #ff4d4f;
  border: 1px solid #ffccc7;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}

</style>
