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
      <!-- 路径配置 -->
      <section class="setting-section">
        <h2 class="section-title">路径配置</h2>
        <div class="form-group">
          <label>项目根目录 (PROJECT_ROOT)</label>
          <p class="field-desc">主系统代码路径，用于 Agent/E2E 测试定位 Skill 文件</p>
          <div class="input-row">
            <input v-model="form.projectRoot" placeholder="例如: C:/FengSuKeJi/agent" />
            <span v-if="checks.projectRoot" class="check-badge" :class="checks.projectRoot.ok ? 'ok' : 'err'">
              {{ checks.projectRoot.msg }}
            </span>
          </div>
        </div>

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

        <div class="form-group">
          <label>E2E Skill 状态</label>
          <span v-if="checks.e2eSkill" class="check-badge" :class="checks.e2eSkill.ok ? 'ok' : 'err'">
            {{ checks.e2eSkill.msg }}
          </span>
          <span v-else class="check-badge pending">点击下方"检测配置"查看</span>
        </div>
      </section>

      <!-- 端口配置 -->
      <section class="setting-section">
        <h2 class="section-title">端口配置</h2>
        <div class="form-group">
          <label>主系统前端端口</label>
          <p class="field-desc">E2E 预检时检查主系统前端是否启动</p>
          <div class="input-row">
            <input v-model.number="form.mainFrontendPort" type="number" :min="1" :max="65535" />
            <span v-if="checks.mainFrontendPort" class="check-badge" :class="checks.mainFrontendPort.ok ? 'ok' : 'err'">
              {{ checks.mainFrontendPort.msg }}
            </span>
          </div>
        </div>

        <div class="form-group">
          <label>主系统后端端口</label>
          <p class="field-desc">E2E 预检时检查主系统后端是否启动</p>
          <div class="input-row">
            <input v-model.number="form.mainBackendPort" type="number" :min="1" :max="65535" />
            <span v-if="checks.mainBackendPort" class="check-badge" :class="checks.mainBackendPort.ok ? 'ok' : 'err'">
              {{ checks.mainBackendPort.msg }}
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { getSettings, updateSettings, checkSettings, type PlatformConfig, type CheckResult } from '../api/settings'

const loading = ref(true)
const saving = ref(false)
const checking = ref(false)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)

const form = reactive<PlatformConfig>({
  projectRoot: '',
  aiPlatformRoot: '',
  e2eDataDir: '',
  mainFrontendPort: 5173,
  mainBackendPort: 9998,
  apiTestBaseUrl: '',
})

const checks = reactive<Record<string, CheckResult>>({})

onMounted(async () => {
  try {
    const res = await getSettings()
    Object.assign(form, res.data)
  } catch (e: any) {
    message.value = { type: 'error', text: '加载配置失败: ' + e.message }
  } finally {
    loading.value = false
  }
})

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
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a2e;
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
.input-row input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}
.input-row input:focus {
  border-color: #667eea;
  outline: none;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.15);
}
.check-badge {
  font-size: 12px;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 4px;
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
</style>
