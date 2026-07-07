<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="project-add-title">
      <!-- 顶部标题 -->
      <div class="dialog-header">
        <h3 id="project-add-title" class="dialog-title">添加项目</h3>
        <button class="close-btn" type="button" aria-label="关闭" @click="emit('cancel')">×</button>
      </div>

      <!-- 内容区 -->
      <div class="dialog-body">
        <!-- 项目类型选择 -->
        <div class="field-group">
          <label class="field-label">项目类型</label>
          <div class="type-cards">
            <div
              v-for="opt in typeOptions"
              :key="opt.value"
              class="type-card"
              :class="{ active: projectType === opt.value }"
              @click="selectType(opt.value)"
            >
              <span class="radio" :class="{ on: projectType === opt.value }">
                <span class="radio-dot"></span>
              </span>
              <div class="type-card-body">
                <div class="type-card-title">{{ opt.label }}</div>
                <div class="type-card-desc">{{ opt.desc }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 表单字段 -->
        <div class="form-grid">
          <div class="form-row">
            <label class="field-label">项目名称 <span class="req">*</span></label>
            <input v-model="project.name" placeholder="请输入项目名称" />
          </div>
          <div class="form-row">
            <label class="field-label">项目编码 <span class="req">*</span></label>
            <input v-model="project.code" placeholder="如 agent / knowledge-center" />
          </div>
          <div class="form-row">
            <label class="field-label">目标服务器 <span class="req">*</span></label>
            <input v-model="project.deploy.host" placeholder="如 192.168.1.10" />
          </div>
          <div class="form-row">
            <label class="field-label">应用端口 <span class="req">*</span></label>
            <input v-model.number="project.deploy.appPort" type="number" placeholder="应用端口" />
          </div>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="dialog-footer">
        <button class="btn btn-ghost" type="button" :disabled="submitting" @click="emit('cancel')">取消</button>
        <button class="btn btn-primary" type="button" :disabled="submitting" @click="handleSubmit">
          {{ submitting ? '提交中…' : '确定' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { addProject } from '../../api/schools'
import { useToast } from '../../composables/useToast'
import type { Project, ProjectType } from '../../api/types'

const props = defineProps<{
  schoolCode: string
}>()

const emit = defineEmits<{
  added: []
  cancel: []
}>()

const { toast } = useToast()

/** agent 默认项目 */
function buildAgentProject(): Project {
  return {
    code: 'agent',
    name: 'Agent 智能体平台',
    type: 'agent',
    status: 'pending',
    lastDeploy: null,
    deploy: { host: '', user: 'root', serverOs: 'linux', windowsDrive: 'D:', appPort: 9998 },
    dbType: 'mysql',
    dbHost: '', dbPort: 3306, dbUser: '', dbPassword: '',
    database: 'agent_portal',
    businessDatabase: 'agent_portal_business',
    passwords: { username: '', defaultPassword: '111111', superPassword: 'fskj_dst_2023', salt: 'system_salt' },
    security: { mode: 'dev' },
    sandbox: { enabled: true, strategy: 'bubblewrap', bubblewrapBinary: 'bwrap', poolSize: 5, runtimePaths: ['/usr/bin/python3', '/usr/bin/node'] },
  }
}

/** knowledge-center 默认项目 */
function buildKcProject(): Project {
  return {
    code: 'knowledge-center',
    name: '知识中心',
    type: 'knowledge-center',
    status: 'pending',
    lastDeploy: null,
    deploy: { host: '', user: 'root', serverOs: 'linux', windowsDrive: 'D:', appPort: 9999 },
    dbType: 'mysql',
    dbHost: '', dbPort: 3306, dbUser: '', dbPassword: '',
    database: 'knowledge_center',
    knowledgeCenter: {
      profile: 'dev',
      milvus: { url: '', port: 19530, userName: 'root', userPassword: 'Milvus', dbName: 'knowledge_center', embeddingDimension: 1024 },
      neo4j: { uri: '', username: 'neo4j', password: '' },
      redis: { host: '', port: 6379, password: '', database: 0 },
      embedding: { baseUrl: '', apiKey: '', modelName: 'Qwen3-Embedding-0.6B', chatModelName: 'deepseek-v4-flash', graphModelName: 'qwen3', visionModelName: 'doubao-seed-1-6-vision-250815', audioTranscriptionModelName: 'SenseVoiceSmall' },
      rerank: { url: '', model: 'bge-reranker-v2-m3', minScore: 0.03 },
    },
  }
}

const typeOptions: Array<{ value: ProjectType; label: string; desc: string }> = [
  { value: 'agent', label: 'Agent 智能体平台', desc: '独立可部署的智能体应用，默认端口 9998' },
  { value: 'knowledge-center', label: '知识中心', desc: '向量 / 图检索知识库，默认端口 9999' },
]

const projectType = ref<ProjectType>('agent')
const project = ref<Project>(buildAgentProject())
const submitting = ref(false)

/** 切换项目类型：整体替换默认对象，避免字段残留 */
function selectType(type: ProjectType) {
  if (type === projectType.value) return
  projectType.value = type
  project.value = type === 'agent' ? buildAgentProject() : buildKcProject()
}

async function handleSubmit() {
  if (!project.value.name.trim()) {
    toast.error('请填写项目名称')
    return
  }
  if (!project.value.code.trim()) {
    toast.error('请填写项目编码')
    return
  }
  if (!project.value.deploy.host.trim()) {
    toast.error('请填写目标服务器')
    return
  }
  if (!project.value.deploy.appPort) {
    toast.error('请填写应用端口')
    return
  }

  submitting.value = true
  try {
    await addProject(props.schoolCode, project.value)
    toast.success('项目已添加')
    emit('added')
  } catch (e: any) {
    toast.error('添加失败：' + (e?.message || '未知错误'))
  } finally {
    submitting.value = false
  }
}

// ESC 关闭
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !submitting.value) emit('cancel')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
/* 遮罩 */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: var(--z-modal);
}

/* 对话框 */
.dialog {
  width: 560px;
  max-width: 90vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

/* 顶部 */
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border);
}
.dialog-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-1);
}
.close-btn {
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  color: var(--text-3);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease);
}
.close-btn:hover {
  color: var(--text-1);
  background: var(--bg-surface-2);
}

/* 内容区 */
.dialog-body {
  padding: 20px 24px;
  overflow-y: auto;
}
.field-group {
  margin-bottom: 18px;
}
.field-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: 8px;
}
.req {
  color: var(--error);
}

/* 类型卡片 */
.type-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.type-card {
  display: flex;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  cursor: pointer;
  background: var(--bg-surface);
  transition: border-color var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease), box-shadow var(--duration-fast) var(--ease);
}
.type-card:hover {
  border-color: var(--border-strong);
  background: var(--bg-surface-2);
}
.type-card.active {
  border-color: var(--brand);
  background: var(--brand-soft);
  box-shadow: var(--shadow-brand);
}
.type-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 4px;
}
.type-card-desc {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.5;
}

/* 自定义 radio */
.radio {
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border: 1.5px solid var(--border-strong);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--duration-fast) var(--ease);
}
.radio.on {
  border-color: var(--brand);
}
.radio-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: transparent;
  transition: background var(--duration-fast) var(--ease);
}
.radio.on .radio-dot {
  background: var(--brand);
}

/* 表单字段 */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 16px;
}
.form-row {
  display: flex;
  flex-direction: column;
}
.form-row input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--text-1);
  background: var(--bg-surface);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease), box-shadow var(--duration-fast) var(--ease);
  font-family: inherit;
}
.form-row input::placeholder {
  color: var(--text-3);
}
.form-row input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

/* 底部 */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid var(--border);
}
.btn {
  padding: 8px 18px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background var(--duration-fast) var(--ease), border-color var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease), opacity var(--duration-fast) var(--ease);
  font-family: inherit;
}
.btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.btn-ghost {
  background: transparent;
  border-color: var(--border-strong);
  color: var(--text-2);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--bg-surface-2);
  color: var(--text-1);
}
.btn-primary {
  background: var(--brand);
  color: #fff;
}
.btn-primary:hover:not(:disabled) {
  background: var(--brand-hover);
}
</style>
