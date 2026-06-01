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
        <button class="btn btn-generate" @click="doGenerate" :disabled="generating">
          {{ generating ? '生成中...' : '生成配置文件' }}
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
            <label>DB Host</label>
            <input v-model="form.dbHost" placeholder="数据库主机地址" />
          </div>
          <div class="form-group">
            <label>DB Port</label>
            <input v-model.number="form.dbPort" type="number" placeholder="端口号" />
          </div>
          <div class="form-group">
            <label>DB User</label>
            <input v-model="form.dbUser" placeholder="数据库用户名" />
          </div>
          <div class="form-group">
            <label>DB Password</label>
            <input v-model="form.dbPassword" type="password" placeholder="数据库密码" />
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
            <input v-model="form.cas.casHost" placeholder="CAS 服务器地址" />
          </div>
          <div class="form-group">
            <label>Login URL</label>
            <input v-model="form.cas.loginUrl" placeholder="登录地址" />
          </div>
          <div class="form-group">
            <label>Login Success URL</label>
            <input v-model="form.cas.loginSuccess" placeholder="登录成功跳转地址" />
          </div>
          <div class="form-group">
            <label>用户名</label>
            <input v-model="form.passwords.username" placeholder="登录用户名" />
          </div>
          <div class="form-group">
            <label>密码</label>
            <input v-model="form.passwords.defaultPassword" type="password" placeholder="登录密码" />
          </div>
        </div>
      </section>

      <!-- Sandbox (collapsible) -->
      <section class="setting-section collapsible">
        <h2 class="section-title clickable" @click="collapsed.sandbox = !collapsed.sandbox">
          <span>沙箱配置</span>
          <span class="collapse-icon">{{ collapsed.sandbox ? '▸' : '▾' }}</span>
        </h2>
        <div v-show="!collapsed.sandbox" class="form-grid">
          <div class="form-group">
            <label>Base Path</label>
            <input v-model="form.sandbox.basePath" placeholder="沙箱基础路径" />
          </div>
          <div class="form-group">
            <label>Strategy</label>
            <input v-model="form.sandbox.strategy" placeholder="策略" />
          </div>
          <div class="form-group">
            <label>Sandboxie Home</label>
            <input v-model="form.sandbox.sandboxieHome" placeholder="Sandboxie 主目录" />
          </div>
          <div class="form-group">
            <label>Sandboxie Ini Path</label>
            <input v-model="form.sandbox.sandboxieIniPath" placeholder="Sandboxie.ini 路径" />
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
            <input v-model="form.passwords.superPassword" type="password" placeholder="超级用户密码" />
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
          <span>通用配置</span>
          <span class="collapse-icon">{{ collapsed.common ? '▸' : '▾' }}</span>
        </h2>
        <div v-show="!collapsed.common" class="form-grid">
          <div class="form-group">
            <label>高德地图 Key</label>
            <input v-model="form.common.amapKey" placeholder="AMap Key" />
          </div>
          <div class="form-group">
            <label>上传目录</label>
            <input v-model="form.common.uploadDir" placeholder="文件上传路径" />
          </div>
          <div class="form-group">
            <label>Druid 用户名</label>
            <input v-model="form.common.druidUser" placeholder="Druid 监控用户名" />
          </div>
          <div class="form-group">
            <label>Druid 密码</label>
            <input v-model="form.common.druidPassword" type="password" placeholder="Druid 监控密码" />
          </div>
          <div class="form-group">
            <label>Helper Dialect</label>
            <input v-model="form.common.helperDialect" placeholder="数据库方言 (mysql/dm)" />
          </div>
        </div>
      </section>

      <!-- Actions -->
      <div class="actions-bar">
        <button class="btn btn-save" @click="doSave" :disabled="saving">
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
        <button class="btn btn-generate" @click="doGenerate" :disabled="generating">
          {{ generating ? '生成中...' : '生成配置文件' }}
        </button>
      </div>

      <!-- Preview Panel -->
      <section v-if="previewData" class="setting-section preview-section">
        <h2 class="section-title">配置预览</h2>
        <div class="preview-tabs">
          <button
            v-for="(_, tabName) in previewData"
            :key="tabName"
            class="tab-btn"
            :class="{ active: activeTab === tabName }"
            @click="activeTab = tabName"
          >
            {{ tabName }}
          </button>
        </div>
        <div class="preview-content">
          <pre v-if="previewData[activeTab]">{{ previewData[activeTab] }}</pre>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import StatusBadge from '../components/common/StatusBadge.vue'
import { getSchool, updateSchool, previewConfigs, generateConfigsApi } from '../api/schools'
import type { School } from '../api/types'

const router = useRouter()
const route = useRoute()
const code = route.params.code as string

const loading = ref(true)
const saving = ref(false)
const generating = ref(false)
const school = ref<School | null>(null)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)
let messageTimer: ReturnType<typeof setTimeout> | null = null

function showMessage(type: 'success' | 'error', text: string) {
  if (messageTimer) clearTimeout(messageTimer)
  message.value = { type, text }
  messageTimer = setTimeout(() => { message.value = null }, 3000)
}
const previewData = ref<Record<string, string> | null>(null)
const activeTab = ref('')

// 三个区块默认折叠
const collapsed = reactive({
  sandbox: true,
  security: true,
  common: true,
})

// 默认值来自主系统当前配置文件
const DEFAULTS = {
  sandbox: {
    basePath: 'D:/tmp/sandbox',
    strategy: 'sandboxie',
    sandboxieHome: 'D:/software/Sandboxie-Plus',
    sandboxieIniPath: 'D:/software/Sandboxie-Plus/Sandboxie.ini',
  },
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
    uploadDir: '',
    druidUser: 'druid',
    druidPassword: '123456',
    helperDialect: '',
  },
}

const form = reactive({
  dbHost: '',
  dbPort: 5237,
  dbUser: '',
  dbPassword: '',
  cas: {
    enableCas: false,
    enableMobileCas: false,
    casHost: '',
    loginUrl: '',
    loginSuccess: '',
  },
  sandbox: { ...DEFAULTS.sandbox },
  security: { ...DEFAULTS.security },
  passwords: { ...DEFAULTS.passwords },
  common: { ...DEFAULTS.common },
})

onMounted(async () => {
  try {
    const data = await getSchool(code)
    school.value = data
    form.dbHost = data.dbHost || ''
    form.dbPort = data.dbPort ?? (data.type === 'mysql' ? 3306 : 5237)
    form.dbUser = data.dbUser || ''
    form.dbPassword = data.dbPassword || ''
    if (data.cas) Object.assign(form.cas, data.cas)
    // 已保存的覆盖默认值，未保存的保持默认
    if (data.sandbox && hasContent(data.sandbox)) Object.assign(form.sandbox, data.sandbox)
    if (data.security && hasContent(data.security)) Object.assign(form.security, data.security)
    if (data.passwords && hasContent(data.passwords)) Object.assign(form.passwords, data.passwords)
    if (data.common && hasContent(data.common)) Object.assign(form.common, data.common)
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

async function doSave() {
  saving.value = true
  try {
    const updated = await updateSchool(code, {
      status: 'configured',
      dbHost: form.dbHost,
      dbPort: form.dbPort,
      dbUser: form.dbUser,
      dbPassword: form.dbPassword,
      cas: { ...form.cas },
      sandbox: { ...form.sandbox },
      security: { ...form.security },
      passwords: { ...form.passwords },
      common: { ...form.common },
    })
    school.value = updated
    showMessage('success', '配置已保存')
  } catch (e: any) {
    showMessage('error', '保存失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

async function doGenerate() {
  generating.value = true
  try {
    await updateSchool(code, {
      status: 'configured',
      dbHost: form.dbHost,
      dbPort: form.dbPort,
      dbUser: form.dbUser,
      dbPassword: form.dbPassword,
      cas: { ...form.cas },
      sandbox: { ...form.sandbox },
      security: { ...form.security },
      passwords: { ...form.passwords },
      common: { ...form.common },
    })
    const result = await generateConfigsApi(code)
    showMessage('success', `配置文件已生成: ${result.files.join(', ')}`)
    const configs = await previewConfigs(code)
    previewData.value = configs
    activeTab.value = Object.keys(configs)[0] || ''
  } catch (e: any) {
    showMessage('error', '生成失败: ' + e.message)
  } finally {
    generating.value = false
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
.btn-generate {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn-generate:hover:not(:disabled) {
  opacity: 0.9;
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
.form-group input[type="number"] {
  padding: 8px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}
.form-group input:focus {
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

/* Preview */
.preview-section {
  margin-top: 8px;
}
.preview-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.tab-btn {
  padding: 6px 14px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  transition: all 0.15s;
}
.tab-btn.active {
  background: #667eea;
  color: #fff;
  border-color: #667eea;
}
.tab-btn:hover:not(.active) {
  border-color: #667eea;
  color: #667eea;
}
.preview-content {
  background: #1e1e2e;
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
}
.preview-content pre {
  margin: 0;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #cdd6f4;
  white-space: pre;
}
</style>
