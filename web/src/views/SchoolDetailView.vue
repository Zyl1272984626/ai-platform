<template>
  <div class="detail-page page-container">
    <!-- Header -->
    <PageHeader show-back :title="school?.name || '加载中...'" @back="router.push('/schools')">
      <template #badge>
        <StatusBadge v-if="school" :status="school.status" />
      </template>
    </PageHeader>

    <div v-if="loading" class="loading">加载中...</div>

    <div v-else-if="!school" class="loading">学校不存在</div>

    <div v-else class="detail-content">
      <!-- Basic Info -->
      <section class="setting-section">
        <h2 class="section-title">基础信息</h2>
        <div class="info-grid">
          <div class="info-item"><span class="label">编码</span><span class="value mono">{{ school.code }}</span></div>
          <div class="info-item"><span class="label">名称</span><span class="value">{{ school.name }}</span></div>
          <div class="info-item">
            <span class="label">项目数量</span>
            <span class="value">{{ school.projects.length }}</span>
          </div>
          <div class="info-item">
            <span class="label">最近部署</span>
            <span class="value mono">{{ school.lastDeploy || '-' }}</span>
          </div>
        </div>
      </section>

      <!-- 项目列表 -->
      <section class="setting-section">
        <div class="section-title-row">
          <h2 class="section-title no-border">部署项目</h2>
          <BaseButton variant="primary" :icon="IconAction.add" @click="showAddProject = true">添加项目</BaseButton>
        </div>
        <p class="section-hint">每个项目是一个独立可部署的应用，拥有各自的数据库、端口和服务器配置。</p>

        <div v-if="school.projects.length === 0" class="empty-projects">
          <EmptyState title="暂无项目" description="点击右上角添加第一个项目（如 Agent 智能体平台、知识中心）">
            <template #icon><Icon :icon="IconNav.school" :size="40" /></template>
          </EmptyState>
        </div>

        <div v-else class="project-grid">
          <div v-for="p in school.projects" :key="p.code" class="project-card">
            <div class="proj-top">
              <div class="proj-name-row">
                <span class="proj-type-badge" :class="`type-${p.type}`">{{ typeLabel(p.type) }}</span>
                <span class="proj-name" @click="goConfig(p.code)">{{ p.name }}</span>
              </div>
              <StatusBadge :status="p.status" />
            </div>
            <div class="proj-info">
              <div class="info-row"><span class="info-label">服务器</span><span class="info-value mono">{{ p.deploy.host || '-' }}</span></div>
              <div class="info-row"><span class="info-label">应用端口</span><span class="info-value mono">{{ p.deploy.appPort }}</span></div>
              <div class="info-row"><span class="info-label">数据库</span><span class="info-value mono">{{ p.database }}</span></div>
              <div class="info-row"><span class="info-label">最近部署</span><span class="info-value mono">{{ p.lastDeploy || '-' }}</span></div>
            </div>
            <div class="proj-actions">
              <button class="act-btn act-config" @click="goConfig(p.code)">配置</button>
              <button class="act-btn act-deploy" @click="goDeploy(p.code)">部署</button>
              <button class="act-btn act-del" @click="confirmDeleteProject(p)">移除</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 添加项目 -->
    <ProjectAddDialog
      v-if="showAddProject"
      :school-code="school?.code || ''"
      @added="onProjectAdded"
      @cancel="showAddProject = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import StatusBadge from '../components/common/StatusBadge.vue'
import EmptyState from '../components/common/EmptyState.vue'
import PageHeader from '../components/layout/PageHeader.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import Icon from '../components/ui/Icon.vue'
import ProjectAddDialog from '../components/project/ProjectAddDialog.vue'
import { IconNav, IconAction } from '../composables/icons'
import { useToast } from '../composables/useToast'
import { getSchool, deleteProject } from '../api/schools'
import type { School, Project, ProjectType } from '../api/types'

const router = useRouter()
const route = useRoute()
const code = route.params.code as string
const { toast } = useToast()

const loading = ref(true)
const school = ref<School | null>(null)
const showAddProject = ref(false)

const TYPE_LABELS: Record<ProjectType, string> = {
  'agent': 'Agent',
  'knowledge-center': '知识中心',
}

function typeLabel(type: ProjectType): string {
  return TYPE_LABELS[type] || type
}

onMounted(async () => {
  await fetchSchool()
})

async function fetchSchool() {
  loading.value = true
  try {
    school.value = await getSchool(code)
  } catch (e: any) {
    toast.error('加载失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

function goConfig(projectCode: string) {
  router.push(`/schools/${code}/projects/${projectCode}`)
}

function goDeploy(projectCode: string) {
  router.push(`/schools/${code}/projects/${projectCode}/deploy`)
}

async function onProjectAdded() {
  showAddProject.value = false
  await fetchSchool()
  toast.success('项目已添加')
}

async function confirmDeleteProject(p: Project) {
  if (!confirm(`确认从该学校移除项目「${p.name}」？此操作不可撤销。`)) return
  try {
    await deleteProject(code, p.code)
    await fetchSchool()
    toast.success('项目已移除')
  } catch (e: any) {
    toast.error('移除失败: ' + e.message)
  }
}
</script>

<style scoped>
.loading {
  text-align: center;
  padding: 60px;
  color: var(--text-3);
  font-size: 16px;
}

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
.section-title.no-border { border-bottom: none; padding-bottom: 0; margin-bottom: 0; }
.section-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.section-hint {
  font-size: 13px;
  color: var(--text-3);
  margin: 8px 0 16px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px 24px;
}
.info-item { display: flex; flex-direction: column; gap: 2px; }
.info-item .label { font-size: 12px; color: var(--text-3); }
.info-item .value { font-size: 14px; color: var(--text-1); }
.info-item .value.mono { font-family: var(--font-mono); font-size: 13px; }

.empty-projects { padding: 24px 0; }

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.project-card {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: box-shadow var(--duration) var(--ease);
}
.project-card:hover { box-shadow: var(--shadow-md); }
.proj-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.proj-name-row { display: flex; align-items: center; gap: 8px; }
.proj-type-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--brand-soft);
  color: var(--brand);
}
.proj-type-badge.type-knowledge-center { background: #e6f7ee; color: #1a8a4e; }
.proj-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease);
}
.proj-name:hover { color: var(--brand); }
.proj-info { flex: 1; }
.info-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
  font-size: 13px;
}
.info-label { color: var(--text-3); }
.info-value { color: var(--text-1); }
.info-value.mono { font-family: var(--font-mono); font-size: 12px; }

.proj-actions {
  display: flex;
  gap: 8px;
  border-top: 1px solid var(--border-light);
  padding-top: 12px;
}
.act-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-surface);
  cursor: pointer;
  font-size: 12px;
  text-align: center;
  transition: all 0.15s;
}
.act-config:hover { border-color: var(--brand); color: var(--brand); background: var(--brand-soft); }
.act-deploy:hover { border-color: var(--success); color: var(--success); background: var(--success-bg); }
.act-del:hover { border-color: var(--error); color: var(--error); background: var(--error-bg); }
</style>
