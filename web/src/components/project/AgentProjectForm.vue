<template>
  <!-- 数据库 -->
  <section class="setting-section">
    <h2 class="section-title">数据库配置</h2>
    <div class="form-grid">
      <div class="form-group">
        <label>数据库类型</label>
        <select v-model="model.dbType" @change="onDbTypeChange">
          <option value="mysql">MySQL</option>
          <option value="dameng">达梦</option>
        </select>
      </div>
      <div class="form-group">
        <label>DB Host</label>
        <input v-model="model.dbHost" placeholder="数据库主机地址" />
      </div>
      <div class="form-group">
        <label>DB Port</label>
        <input v-model.number="model.dbPort" type="number" placeholder="端口号" />
      </div>
      <div class="form-group">
        <label>数据库名(主库)</label>
        <input v-model="model.database" placeholder="例: agent_portal" @change="syncBusinessDb" />
      </div>
      <div class="form-group">
        <label>业务库名</label>
        <input v-model="model.businessDatabase" placeholder="自动派生为 主库_business" />
      </div>
      <div class="form-group">
        <label>DB User</label>
        <input v-model="model.dbUser" placeholder="数据库用户名" />
      </div>
      <div class="form-group">
        <label>DB Password</label>
        <PasswordInput v-model="model.dbPassword" placeholder="数据库密码" />
      </div>
      <div class="form-group">
        <label>MySQL Docker 容器名</label>
        <input v-model="model.deploy.mysqlContainer" placeholder="可选；不填则使用宿主机 mysql 命令" />
      </div>
    </div>
  </section>

  <!-- CAS -->
  <section class="setting-section">
    <h2 class="section-title">CAS 配置</h2>
    <div class="form-grid">
      <div class="form-group toggle-group">
        <label>启用 CAS</label>
        <input type="checkbox" v-model="cas.enableCas" />
      </div>
      <div class="form-group toggle-group">
        <label>启用移动端 CAS</label>
        <input type="checkbox" v-model="cas.enableMobileCas" />
      </div>
      <div class="form-group">
        <label>Host</label>
        <input v-model="cas.host" placeholder="派生 host/loginUrl/loginSuccess" />
      </div>
      <div class="form-group">
        <label>CAS Host</label>
        <input v-model="cas.casHost" placeholder="对应 topspeeder.auth.casHost" />
      </div>
    </div>
  </section>

  <!-- 部署 -->
  <section class="setting-section">
    <h2 class="section-title">部署配置</h2>
    <div class="form-grid">
      <div class="form-group">
        <label>目标服务器</label>
        <input v-model="model.deploy.host" placeholder="例: 192.168.1.100" />
      </div>
      <div class="form-group">
        <label>应用服务器系统</label>
        <select v-model="model.deploy.serverOs">
          <option value="linux">Linux</option>
          <option value="windows">Windows</option>
        </select>
      </div>
      <div class="form-group" v-if="model.deploy.serverOs === 'windows'">
        <label>Windows 盘符</label>
        <select v-model="model.deploy.windowsDrive">
          <option value="C:">C:</option>
          <option value="D:">D:</option>
          <option value="E:">E:</option>
        </select>
      </div>
      <div class="form-group">
        <label>应用端口</label>
        <input v-model.number="model.deploy.appPort" type="number" placeholder="默认 9998" />
      </div>
      <div class="form-group">
        <label>SSH 用户</label>
        <input v-model="model.deploy.user" placeholder="默认 root" />
      </div>
      <div class="form-group">
        <label>数据库 Root 密码</label>
        <PasswordInput v-model="model.deploy.dbRootPassword" placeholder="目标服务器数据库 root 密码" />
      </div>
    </div>
  </section>

  <!-- OneApi / 知识中心 / 语音 -->
  <section class="setting-section">
    <h2 class="section-title">OneApi / 知识中心 / 语音</h2>
    <div class="form-grid">
      <div class="form-group">
        <label>OneApi 地址</label>
        <input v-model="deployConfig.oneapiHost" placeholder="例: 192.168.1.100" />
      </div>
      <div class="form-group">
        <label>OneApi 端口</label>
        <input v-model.number="deployConfig.oneapiPort" type="number" placeholder="3000" />
      </div>
      <div class="form-group">
        <label>OneApi Key</label>
        <PasswordInput v-model="deployConfig.oneapiKey" placeholder="sk-xxx" />
      </div>
      <div class="form-group full">
        <label>知识中心 Base URL</label>
        <input v-model="deployConfig.knowledgeBaseUrl" placeholder="例: http://192.168.1.100:9999" />
      </div>
      <div class="form-group">
        <label>知识中心 APP ID</label>
        <input v-model="deployConfig.knowledgeAppId" placeholder="知识中心应用 ID" />
      </div>
      <div class="form-group">
        <label>知识中心 API Key</label>
        <PasswordInput v-model="deployConfig.knowledgeApiKey" placeholder="知识中心 API Key" />
      </div>
      <div class="form-group full">
        <label>语音识别 API 地址</label>
        <input v-model="deployConfig.voiceApiUrl" placeholder="例: http://192.168.1.10/voice-api" />
      </div>
    </div>
  </section>

  <!-- 安全 & 密码 (折叠) -->
  <section class="setting-section collapsible">
    <h2 class="section-title clickable" @click="collapsed.security = !collapsed.security">
      <span>安全 &amp; 密码</span>
      <span class="collapse-icon">{{ collapsed.security ? '▸' : '▾' }}</span>
    </h2>
    <div v-show="!collapsed.security" class="form-grid">
      <div class="form-group">
        <label>Security Mode</label>
        <input v-model="security.mode" placeholder="安全模式" />
      </div>
      <div class="form-group">
        <label>登录用户名</label>
        <input v-model="passwords.username" placeholder="登录用户名" />
      </div>
      <div class="form-group">
        <label>默认密码</label>
        <PasswordInput v-model="passwords.defaultPassword" placeholder="默认登录密码" />
      </div>
      <div class="form-group">
        <label>超级密码</label>
        <PasswordInput v-model="passwords.superPassword" placeholder="超级用户密码" />
      </div>
      <div class="form-group">
        <label>密码 Salt</label>
        <input v-model="passwords.salt" placeholder="加密盐值" />
      </div>
    </div>
  </section>

  <!-- 高级配置 (折叠) -->
  <section class="setting-section collapsible">
    <h2 class="section-title clickable" @click="collapsed.common = !collapsed.common">
      <span>高级配置</span>
      <span class="collapse-icon">{{ collapsed.common ? '▸' : '▾' }}</span>
    </h2>
    <div v-show="!collapsed.common" class="form-grid">
      <div class="form-group">
        <label>高德地图 Key</label>
        <input v-model="common.amapKey" placeholder="AMap Key" />
      </div>
      <div class="form-group">
        <label>Druid 用户名</label>
        <input v-model="common.druidUser" placeholder="Druid 监控用户名" />
      </div>
      <div class="form-group">
        <label>Druid 密码</label>
        <PasswordInput v-model="common.druidPassword" placeholder="Druid 监控密码" />
      </div>
    </div>
  </section>

  <!-- 沙箱 (折叠) -->
  <section class="setting-section collapsible">
    <h2 class="section-title clickable" @click="collapsed.sandbox = !collapsed.sandbox">
      <span>沙箱配置</span>
      <span class="collapse-icon">{{ collapsed.sandbox ? '▸' : '▾' }}</span>
    </h2>
    <div v-show="!collapsed.sandbox" class="form-grid">
      <div class="form-group toggle-group">
        <label>启用沙箱隔离</label>
        <input type="checkbox" v-model="sandbox.enabled" />
      </div>
      <div class="form-group">
        <label>隔离策略</label>
        <select v-model="sandbox.strategy">
          <option value="local">local（不隔离，开发用）</option>
          <option value="bubblewrap">bubblewrap（Linux）</option>
          <option value="wsl">wsl（Windows WSL）</option>
          <option value="auto">auto（自动检测）</option>
        </select>
      </div>
      <div class="form-group">
        <label>Bubblewrap 二进制路径</label>
        <input v-model="sandbox.bubblewrapBinary" placeholder="默认 bwrap" />
      </div>
      <div class="form-group">
        <label>沙箱并发池大小</label>
        <input v-model.number="sandbox.poolSize" type="number" min="1" placeholder="默认 5" />
      </div>
      <div class="form-group full">
        <label>运行时路径（每行一个，只读挂载到沙箱）</label>
        <textarea v-model="runtimePathsText" rows="4" placeholder="例:&#10;/usr/bin/python3&#10;/usr/bin/node"></textarea>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import PasswordInput from '../common/PasswordInput.vue'
import type { Project } from '../../api/types'

const props = defineProps<{ model: Project }>()

// 子对象兜底：确保 cas/security/passwords/common/deployConfig/sandbox 存在
const cas = props.model.cas || (props.model.cas = {})
const security = props.model.security || (props.model.security = { mode: 'dev' })
const passwords = props.model.passwords || (props.model.passwords = { username: '', defaultPassword: '111111', superPassword: 'fskj_dst_2023', salt: 'system_salt' })
const common = props.model.common || (props.model.common = {})
const deployConfig = props.model.deployConfig || (props.model.deployConfig = {})
const sandbox = props.model.sandbox || (props.model.sandbox = { enabled: true, strategy: 'bubblewrap', bubblewrapBinary: 'bwrap', poolSize: 5, runtimePaths: ['/usr/bin/python3', '/usr/bin/node'] })

const collapsed = reactive({
  security: true,
  common: true,
  sandbox: true,
})

// runtime-paths 数组与 textarea 文本互转
const runtimePathsText = computed({
  get: () => (sandbox.runtimePaths || []).join('\n'),
  set: (val: string) => {
    sandbox.runtimePaths = val.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  },
})

function onDbTypeChange() {
  if (model.dbType === 'mysql' && (!model.dbPort || model.dbPort === 5237)) model.dbPort = 3306
  if (model.dbType === 'dameng' && (!model.dbPort || model.dbPort === 3306)) model.dbPort = 5237
}
function syncBusinessDb() {
  if (model.database) model.businessDatabase = `${model.database}_business`
}

// model 别名（模板里用 model，脚本里简写）
const model = props.model
</script>

<style scoped>
.setting-section {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  margin-bottom: var(--space-5);
  box-shadow: var(--shadow-sm);
}
.section-title {
  font-size: 16px; font-weight: 600; color: var(--text-1);
  margin-bottom: var(--space-4); padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-light);
  display: flex; justify-content: space-between; align-items: center;
}
.section-title.clickable {
  cursor: pointer; user-select: none; margin-bottom: 0; border-bottom: none;
  transition: background var(--duration-fast) var(--ease);
  border-radius: var(--radius-sm); padding: 8px 12px; margin: -8px -12px 0;
}
.section-title.clickable:hover { background: var(--brand-soft); }
.collapse-icon { font-size: 14px; color: var(--text-3); }

.form-grid {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4); padding-top: 12px;
}
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-group label { font-size: 13px; font-weight: 500; color: var(--text-2); }
.form-group input, .form-group select, .form-group textarea {
  width: 100%; padding: 8px 12px;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  font-size: 14px; font-family: inherit; box-sizing: border-box;
  transition: border-color var(--duration) var(--ease);
}
.form-group input:focus, .form-group select:focus, .form-group textarea:focus {
  border-color: var(--brand); outline: none;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.15);
}
.form-group textarea { font-family: 'Consolas', 'Monaco', monospace; resize: vertical; }
.toggle-group { flex-direction: row; align-items: center; gap: 8px; }
.toggle-group label { margin: 0; }
.toggle-group input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
</style>
