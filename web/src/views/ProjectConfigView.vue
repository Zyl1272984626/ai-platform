<template>
  <div class="config-page page-container">
    <PageHeader show-back :title="project?.name || '加载中...'" @back="router.push(`/schools/${code}`)">
      <template #badge>
        <StatusBadge v-if="project" :status="project.status" />
      </template>
      <BaseButton variant="primary" :loading="saving" @click="doSave">保存配置</BaseButton>
    </PageHeader>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="!school" class="loading">学校不存在</div>
    <div v-else-if="!project" class="loading">项目不存在</div>

    <div v-else class="config-content">
      <!-- 基础信息 -->
      <section class="setting-section">
        <h2 class="section-title">项目信息</h2>
        <div class="info-grid">
          <div class="info-item"><span class="label">项目编码</span><span class="value mono">{{ project.code }}</span></div>
          <div class="info-item"><span class="label">项目类型</span><span class="value">{{ typeLabel(project.type) }}</span></div>
          <div class="info-item"><span class="label">状态</span><span class="value">{{ project.status }}</span></div>
          <div class="info-item"><span class="label">最近部署</span><span class="value mono">{{ project.lastDeploy || '-' }}</span></div>
        </div>
      </section>

      <!-- 按类型加载表单 -->
      <component :is="formComponent" :model="project" />

      <!-- 操作 -->
      <div class="actions-bar">
        <button class="btn btn-save" @click="doSave" :disabled="saving">
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
        <button class="btn btn-deploy-link" @click="goDeploy">去部署</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import PageHeader from '../components/layout/PageHeader.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import StatusBadge from '../components/common/StatusBadge.vue'
import AgentProjectForm from '../components/project/AgentProjectForm.vue'
import KnowledgeCenterProjectForm from '../components/project/KnowledgeCenterProjectForm.vue'
import { useToast } from '../composables/useToast'
import { getSchool, updateProject } from '../api/schools'
import type { School, Project, ProjectType } from '../api/types'

const router = useRouter()
const route = useRoute()
const code = route.params.code as string
const pcode = route.params.pcode as string
const { toast } = useToast()

const loading = ref(true)
const saving = ref(false)
const school = ref<School | null>(null)
const project = ref<Project | null>(null)

const TYPE_LABELS: Record<ProjectType, string> = {
  'agent': 'Agent 智能体平台',
  'knowledge-center': '知识中心',
}
function typeLabel(t: ProjectType) { return TYPE_LABELS[t] || t }

const formComponent = computed(() => {
  if (!project.value) return null
  return project.value.type === 'knowledge-center' ? KnowledgeCenterProjectForm : AgentProjectForm
})

onMounted(async () => {
  try {
    school.value = await getSchool(code)
    project.value = school.value.projects.find(p => p.code === pcode) || null
    if (!project.value) toast.error('项目不存在')
  } catch (e: any) {
    toast.error('加载失败: ' + e.message)
  } finally {
    loading.value = false
  }
})

async function doSave() {
  if (!project.value) return
  saving.value = true
  try {
    // 保存时把 status 标记为 configured
    await updateProject(code, pcode, { ...project.value, status: 'configured' })
    toast.success('配置已保存')
  } catch (e: any) {
    toast.error('保存失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

function goDeploy() {
  router.push(`/schools/${code}/projects/${pcode}/deploy`)
}
</script>

<style scoped>
.loading { text-align: center; padding: 60px; color: var(--text-3); font-size: 16px; }
.config-content { max-width: 100%; }

.setting-section {
  background: var(--bg-surface); border-radius: var(--radius-lg);
  padding: 20px 24px; margin-bottom: var(--space-5); box-shadow: var(--shadow-sm);
}
.section-title {
  font-size: 16px; font-weight: 600; color: var(--text-1);
  margin-bottom: var(--space-4); padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-light);
}
.info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 24px; }
.info-item { display: flex; flex-direction: column; gap: 2px; }
.info-item .label { font-size: 12px; color: var(--text-3); }
.info-item .value { font-size: 14px; color: var(--text-1); }
.info-item .value.mono { font-family: var(--font-mono); font-size: 13px; }

.actions-bar { display: flex; gap: 12px; margin: 24px 0; }
.btn { padding: 10px 32px; border: none; border-radius: 8px; cursor: pointer; font-size: 15px; font-weight: 500; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-save { background: linear-gradient(135deg, var(--brand), var(--brand-active)); color: #fff; }
.btn-save:hover:not(:disabled) { opacity: 0.9; }
.btn-deploy-link { background: var(--border-light); color: var(--text-1); }
.btn-deploy-link:hover { background: var(--border); }
</style>
