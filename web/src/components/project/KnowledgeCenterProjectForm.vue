<template>
  <form class="kc-project-form">
    <!-- 1. 部署目标 -->
    <section class="setting-section">
      <h2 class="section-title">部署目标</h2>
      <div class="form-grid">
        <div class="form-group full">
          <label>目标服务器 Host</label>
          <input v-model="model.deploy.host" placeholder="例：192.168.1.10" />
        </div>
        <div class="form-group">
          <label>SSH 用户</label>
          <input v-model="model.deploy.user" placeholder="root" />
        </div>
        <div class="form-group">
          <label>应用端口</label>
          <input v-model.number="model.deploy.appPort" type="number" placeholder="9999" />
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
        <div class="form-group full">
          <label>MySQL Docker 容器名（可选）</label>
          <input v-model="model.deploy.mysqlContainer" placeholder="留空则不使用容器" />
        </div>
        <div class="form-group full">
          <label>数据库 Root 密码</label>
          <PasswordInput v-model="model.deploy.dbRootPassword" placeholder="数据库 root 密码" />
        </div>
      </div>
    </section>

    <!-- 2. 数据库配置 -->
    <section class="setting-section">
      <h2 class="section-title">数据库配置</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>数据库类型</label>
          <select v-model="model.dbType">
            <option value="mysql">MySQL</option>
            <option value="dameng">达梦（Dameng）</option>
          </select>
        </div>
        <div class="form-group">
          <label>数据库名</label>
          <input v-model="model.database" placeholder="knowledge_center" />
        </div>
        <div class="form-group">
          <label>DB Host</label>
          <input v-model="model.dbHost" placeholder="例：127.0.0.1" />
        </div>
        <div class="form-group">
          <label>DB Port</label>
          <input v-model.number="model.dbPort" type="number" placeholder="3306" />
        </div>
        <div class="form-group">
          <label>DB User</label>
          <input v-model="model.dbUser" placeholder="数据库用户名" />
        </div>
        <div class="form-group">
          <label>DB Password</label>
          <PasswordInput v-model="model.dbPassword" placeholder="数据库密码" />
        </div>
      </div>
    </section>

    <!-- 3. 外挂 Profile -->
    <section class="setting-section">
      <h2 class="section-title">外挂 Profile</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>Profile</label>
          <select v-model="profile">
            <option value="dev">dev</option>
            <option value="prod">prod</option>
          </select>
        </div>
      </div>
    </section>

    <!-- 4. Milvus 向量库 -->
    <section class="setting-section">
      <h2 class="section-title">Milvus 向量库</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>地址</label>
          <input v-model="milvus.url" placeholder="例：192.168.1.10" />
        </div>
        <div class="form-group">
          <label>端口</label>
          <input v-model.number="milvus.port" type="number" placeholder="19530" />
        </div>
        <div class="form-group">
          <label>用户名</label>
          <input v-model="milvus.userName" placeholder="root" />
        </div>
        <div class="form-group">
          <label>密码</label>
          <PasswordInput v-model="milvus.userPassword" placeholder="Milvus 密码" />
        </div>
        <div class="form-group">
          <label>数据库名</label>
          <input v-model="milvus.dbName" placeholder="knowledge_center" />
        </div>
        <div class="form-group">
          <label>向量维度</label>
          <input v-model.number="milvus.embeddingDimension" type="number" placeholder="1024" />
        </div>
      </div>
    </section>

    <!-- 5. Neo4j 图库 -->
    <section class="setting-section">
      <h2 class="section-title">Neo4j 图库</h2>
      <div class="form-grid">
        <div class="form-group full">
          <label>URI</label>
          <input v-model="neo4j.uri" placeholder="例：neo4j://192.168.1.10:7687" />
        </div>
        <div class="form-group">
          <label>用户名</label>
          <input v-model="neo4j.username" placeholder="neo4j" />
        </div>
        <div class="form-group">
          <label>密码</label>
          <PasswordInput v-model="neo4j.password" placeholder="Neo4j 密码" />
        </div>
      </div>
    </section>

    <!-- 6. Redis -->
    <section class="setting-section">
      <h2 class="section-title">Redis</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>地址</label>
          <input v-model="redis.host" placeholder="例：127.0.0.1" />
        </div>
        <div class="form-group">
          <label>端口</label>
          <input v-model.number="redis.port" type="number" placeholder="6379" />
        </div>
        <div class="form-group">
          <label>密码</label>
          <PasswordInput v-model="redis.password" placeholder="Redis 密码" />
        </div>
        <div class="form-group">
          <label>数据库</label>
          <input v-model.number="redis.database" type="number" placeholder="0" />
        </div>
      </div>
    </section>

    <!-- 7. Embedding / 模型服务 -->
    <section class="setting-section">
      <h2 class="section-title">Embedding / 模型服务</h2>
      <div class="form-grid">
        <div class="form-group full">
          <label>Base URL</label>
          <input v-model="embedding.baseUrl" placeholder="例：http://192.168.1.216:3001/" />
        </div>
        <div class="form-group full">
          <label>API Key</label>
          <PasswordInput v-model="embedding.apiKey" placeholder="模型服务 API Key" />
        </div>
        <div class="form-group">
          <label>嵌入模型</label>
          <input v-model="embedding.modelName" placeholder="Qwen3-Embedding-0.6B" />
        </div>
        <div class="form-group">
          <label>聊天模型</label>
          <input v-model="embedding.chatModelName" placeholder="deepseek-v4-flash" />
        </div>
        <div class="form-group">
          <label>图谱模型</label>
          <input v-model="embedding.graphModelName" placeholder="qwen3" />
        </div>
        <div class="form-group">
          <label>视觉模型</label>
          <input v-model="embedding.visionModelName" placeholder="doubao-seed-1-6-vision-250815" />
        </div>
        <div class="form-group full">
          <label>语音模型</label>
          <input v-model="embedding.audioTranscriptionModelName" placeholder="SenseVoiceSmall" />
        </div>
      </div>
    </section>

    <!-- 8. Rerank 服务 -->
    <section class="setting-section">
      <h2 class="section-title">Rerank 服务</h2>
      <div class="form-grid">
        <div class="form-group full">
          <label>地址</label>
          <input v-model="rerank.url" placeholder="Rerank 服务地址" />
        </div>
        <div class="form-group">
          <label>模型</label>
          <input v-model="rerank.model" placeholder="bge-reranker-v2-m3" />
        </div>
        <div class="form-group">
          <label>最低分数</label>
          <input v-model.number="rerank.minScore" type="number" step="0.01" placeholder="0.03" />
        </div>
      </div>
    </section>

    <!-- 9. CAS / 密码（折叠，默认展开） -->
    <section class="setting-section">
      <h2 class="section-title collapse-toggle" @click="casExpanded = !casExpanded">
        <span class="caret" :class="{ open: casExpanded }">▶</span>
        CAS / 密码
      </h2>
      <div class="form-grid" v-show="casExpanded">
        <div class="form-group toggle-group full">
          <input type="checkbox" v-model="casEnable" />
          <label>启用 CAS</label>
        </div>
        <div class="form-group">
          <label>CAS Host</label>
          <input v-model="casHost" placeholder="CAS 服务地址" />
        </div>
        <div class="form-group">
          <label>前端 Host</label>
          <input v-model="frontHost" placeholder="前端访问地址" />
        </div>
        <div class="form-group">
          <label>默认密码</label>
          <PasswordInput v-model="defaultPassword" placeholder="默认密码" />
        </div>
        <div class="form-group">
          <label>超级密码</label>
          <PasswordInput v-model="superPassword" placeholder="超级密码" />
        </div>
        <div class="form-group full">
          <label>密码 Salt</label>
          <input v-model="salt" placeholder="密码加密 Salt" />
        </div>
      </div>
    </section>
  </form>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import PasswordInput from '../common/PasswordInput.vue'
import type { Project } from '../../api/types'

const props = defineProps<{ model: Project }>()

// 确保 model.knowledgeCenter 及其子对象存在，避免 v-model 报错
const kc = props.model.knowledgeCenter || (props.model.knowledgeCenter = {})
const milvus = kc.milvus || (kc.milvus = {})
const neo4j = kc.neo4j || (kc.neo4j = {})
const redis = kc.redis || (kc.redis = {})
const embedding = kc.embedding || (kc.embedding = {})
const rerank = kc.rerank || (kc.rerank = {})

const cas = props.model.cas || (props.model.cas = {})
const passwords = props.model.passwords || (props.model.passwords = {})

// CAS 折叠状态（默认展开）
const casExpanded = ref(true)

// profile 用 computed 双向绑定到 kc.profile（默认 dev）
const profile = computed({
  get: () => kc.profile ?? 'dev',
  set: (v: 'dev' | 'prod') => {
    kc.profile = v
  },
})

// CAS 启用状态
const casEnable = computed({
  get: () => cas.enableCas ?? false,
  set: (v: boolean) => {
    cas.enableCas = v
  },
})

const casHost = computed({
  get: () => cas.casHost ?? '',
  set: (v: string) => {
    cas.casHost = v
  },
})

const frontHost = computed({
  get: () => cas.host ?? '',
  set: (v: string) => {
    cas.host = v
  },
})

const defaultPassword = computed({
  get: () => passwords.defaultPassword ?? '',
  set: (v: string) => {
    passwords.defaultPassword = v
  },
})

const superPassword = computed({
  get: () => passwords.superPassword ?? '',
  set: (v: string) => {
    passwords.superPassword = v
  },
})

const salt = computed({
  get: () => passwords.salt ?? '',
  set: (v: string) => {
    passwords.salt = v
  },
})
</script>

<style scoped>
.kc-project-form {
  width: 100%;
}

/* Sections */
.setting-section {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  margin-bottom: var(--space-5);
  box-shadow: var(--shadow-sm);
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-light);
}

/* Collapse */
.collapse-toggle {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.caret {
  display: inline-block;
  font-size: 12px;
  color: var(--text-3);
  transition: transform var(--duration-fast) var(--ease);
}
.caret.open {
  transform: rotate(90deg);
}

/* Form grid */
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4);
  padding-top: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-group.full {
  grid-column: 1 / -1;
}
.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
}

.form-group.toggle-group {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.form-group.toggle-group label {
  cursor: pointer;
}

/* Inputs */
.form-group input,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-family: inherit;
  box-sizing: border-box;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease);
}
.form-group input:focus,
.form-group select:focus {
  border-color: var(--brand);
  outline: none;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.15);
}

.form-group input[type="checkbox"] {
  width: 16px;
  height: 16px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--brand);
}
</style>
