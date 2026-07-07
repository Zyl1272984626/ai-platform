<template>
  <div class="school-page page-container">
    <PageHeader title="学校管理" description="管理所有已部署的学校，支持新增、编辑和一键部署">
      <BaseButton variant="primary" :icon="IconAction.add" @click="showAddForm = true">添加学校</BaseButton>
    </PageHeader>

    <div v-if="schools.length === 0" class="empty-grid">
      <EmptyState title="暂无学校" description="点击右上角按钮注册第一所学校">
        <template #icon><Icon :icon="IconNav.school" :size="48" /></template>
        <button class="start-btn" @click="showAddForm = true">添加学校</button>
      </EmptyState>
    </div>

    <div v-else class="school-grid">
      <div v-for="s in schools" :key="s.code" class="school-card">
        <div class="card-top">
          <div class="school-name" @click="goDetail(s.code)">{{ s.name }}</div>
          <StatusBadge :status="s.status" />
        </div>
        <div class="card-info">
          <div class="info-row">
            <span class="info-label">编码</span>
            <span class="info-value">{{ s.code }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">项目数量</span>
            <span class="info-value">{{ s.projects?.length || 0 }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">最近部署</span>
            <span class="info-value">{{ s.lastDeploy || '-' }}</span>
          </div>
          <div v-if="(s.projects?.length || 0) > 0" class="project-tags">
            <span v-for="p in s.projects" :key="p.code" class="proj-tag" :class="`tag-${p.type}`">{{ projectName(p) }}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="act-btn act-config" @click="goDetail(s.code)">管理项目</button>
          <button class="act-btn act-edit" @click="startEdit(s)">编辑</button>
          <button class="act-btn act-del" @click="confirmDelete(s)">删除</button>
        </div>
      </div>
    </div>

    <SchoolForm
      v-if="showAddForm || editingSchool"
      :mode="editingSchool ? 'edit' : 'add'"
      :school="editingSchool || undefined"
      @save="handleSave"
      @cancel="closeForm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import StatusBadge from '../components/common/StatusBadge.vue'
import EmptyState from '../components/common/EmptyState.vue'
import SchoolForm from '../components/school/SchoolForm.vue'
import PageHeader from '../components/layout/PageHeader.vue'
import Icon from '../components/ui/Icon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import { IconNav, IconAction } from '../composables/icons'
import { listSchools, addSchool, updateSchool, deleteSchool } from '../api/schools'
import type { School, Project } from '../api/types'

const schools = ref<School[]>([])
const showAddForm = ref(false)
const editingSchool = ref<School | null>(null)
const router = useRouter()

function projectName(p: Project): string {
  return p.name || p.code
}

onMounted(fetchSchools)

function goDetail(code: string) {
  router.push(`/schools/${code}`)
}

async function fetchSchools() {
  try { schools.value = await listSchools() } catch { /* ignore */ }
}

function startEdit(s: School) {
  editingSchool.value = s
}

function closeForm() {
  showAddForm.value = false
  editingSchool.value = null
}

async function handleSave(data: any) {
  try {
    if (editingSchool.value) {
      await updateSchool(editingSchool.value.code, data)
    } else {
      await addSchool(data)
    }
    closeForm()
    await fetchSchools()
  } catch (e: any) {
    alert('保存失败: ' + e.message)
  }
}

async function confirmDelete(s: School) {
  if (!confirm(`确认删除学校「${s.name}」？该学校下所有项目配置将被一并删除，此操作不可撤销。`)) return
  try {
    await deleteSchool(s.code)
    await fetchSchools()
  } catch (e: any) {
    alert('删除失败: ' + e.message)
  }
}
</script>

<style scoped>

.school-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}
.school-card {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  transition: box-shadow var(--duration) var(--ease);
}
.school-card:hover {
  box-shadow: var(--shadow-md);
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
}
.school-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease);
}
.school-name:hover {
  color: var(--brand);
}
.card-info { flex: 1; margin-bottom: var(--space-4); }
.info-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}
.info-label { color: #999; }
.info-value { color: #333; font-family: monospace; font-size: 12px; }
.project-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 6px;
}
.proj-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #f0f0ff;
  color: #667eea;
}
.proj-tag.tag-knowledge-center { background: #e6f7ee; color: #1a8a4e; }
.card-actions {
  display: flex;
  gap: 8px;
  border-top: 1px solid #f0f0f0;
  padding-top: 12px;
}
.act-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  text-align: center;
  transition: all 0.15s;
}
.act-edit:hover { border-color: var(--info); color: var(--info); background: var(--info-bg); }
.act-config:hover { border-color: var(--brand); color: var(--brand); background: var(--brand-soft); }
.act-deploy:hover { border-color: var(--success); color: var(--success); background: var(--success-bg); }
.act-war:hover { border-color: var(--warning); color: var(--warning); background: var(--warning-bg); }
.act-del:hover { border-color: var(--error); color: var(--error); background: var(--error-bg); }
.empty-grid { padding: 40px 0; }
.start-btn {
  margin-top: 12px;
  padding: 8px 24px;
  background: var(--brand);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 14px;
  transition: background var(--duration-fast) var(--ease);
}
.start-btn:hover { background: var(--brand-hover); }
</style>
