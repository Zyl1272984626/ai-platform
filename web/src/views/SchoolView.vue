<template>
  <div class="school-page">
    <header class="page-header">
      <div>
        <h1>学校管理</h1>
        <p class="page-desc">管理所有已部署的学校，支持新增、编辑和一键部署</p>
      </div>
      <button class="btn-add" @click="showAddForm = true">+ 添加学校</button>
    </header>

    <div v-if="schools.length === 0" class="empty-grid">
      <EmptyState icon="🏫" title="暂无学校" description="点击右上角按钮注册第一所学校">
        <button class="start-btn" @click="showAddForm = true">添加学校</button>
      </EmptyState>
    </div>

    <div v-else class="school-grid">
      <div v-for="s in schools" :key="s.code" class="school-card">
        <div class="card-top">
          <div class="school-name">{{ s.name }}</div>
          <StatusBadge :status="s.status" />
        </div>
        <div class="card-info">
          <div class="info-row"><span class="info-label">编码</span><span class="info-value">{{ s.code }}</span></div>
          <div class="info-row"><span class="info-label">数据库</span><span class="info-value">{{ s.type }}</span></div>
          <div class="info-row"><span class="info-label">端口</span><span class="info-value">{{ s.port }}</span></div>
          <div class="info-row"><span class="info-label">主机</span><span class="info-value">{{ s.deploy?.host || '-' }}</span></div>
          <div v-if="s.lastDeploy" class="info-row"><span class="info-label">最近部署</span><span class="info-value">{{ s.lastDeploy }}</span></div>
        </div>
        <div class="card-actions">
          <button class="act-btn act-edit" @click="startEdit(s)">编辑</button>
          <button class="act-btn act-deploy" @click="deploySchool(s)">部署</button>
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
import StatusBadge from '../components/common/StatusBadge.vue'
import EmptyState from '../components/common/EmptyState.vue'
import SchoolForm from '../components/school/SchoolForm.vue'
import { listSchools, addSchool, updateSchool, deleteSchool } from '../api/schools'
import type { School } from '../api/types'

const schools = ref<School[]>([])
const showAddForm = ref(false)
const editingSchool = ref<School | null>(null)

onMounted(fetchSchools)

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
  if (!confirm(`确认删除学校「${s.name}」？此操作不可撤销。`)) return
  try {
    await deleteSchool(s.code)
    await fetchSchools()
  } catch (e: any) {
    alert('删除失败: ' + e.message)
  }
}

function deploySchool(s: School) {
  alert(`部署功能将通过工作流触发：POST /api/workflows/学校部署全流程/run\n学校: ${s.name} (${s.code})`)
}
</script>

<style scoped>
.school-page {
  padding: 28px 32px;
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}
.page-header h1 {
  font-size: 22px;
  font-weight: 700;
  color: #1a1a2e;
}
.page-desc {
  font-size: 13px;
  color: #999;
  margin-top: 4px;
}
.btn-add {
  padding: 10px 20px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}
.btn-add:hover { opacity: 0.9; }

.school-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}
.school-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  display: flex;
  flex-direction: column;
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.school-name {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a2e;
}
.card-info { flex: 1; margin-bottom: 14px; }
.info-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}
.info-label { color: #999; }
.info-value { color: #333; font-family: monospace; font-size: 12px; }
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
.act-edit:hover { border-color: #1890ff; color: #1890ff; background: #e6f7ff; }
.act-deploy:hover { border-color: #52c41a; color: #52c41a; background: #f6ffed; }
.act-del:hover { border-color: #ff4d4f; color: #ff4d4f; background: #fff2f0; }
.empty-grid { padding: 40px 0; }
.start-btn {
  margin-top: 12px;
  padding: 8px 24px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
</style>
