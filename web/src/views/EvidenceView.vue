<template>
  <div class="page-container evidence-page">
    <PageHeader title="证据与验收" description="只展示真实运行、查询、交互和人工决策，不用总结代替证明">
      <select v-model="projectFilter" class="native-select" @change="loadEvidence"><option value="">全部项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select>
    </PageHeader>
    <div class="evidence-summary">
      <div><strong>{{ evidence.length }}</strong><span>证据总数</span></div>
      <div><strong>{{ typeCount('test') + typeCount('command') }}</strong><span>构建与测试</span></div>
      <div><strong>{{ typeCount('http') + typeCount('browser') + typeCount('database') }}</strong><span>运行态验证</span></div>
      <div><strong>{{ typeCount('acceptance') }}</strong><span>人工验收</span></div>
    </div>
    <section class="surface-card evidence-table-wrap">
      <div class="table-toolbar"><strong>证据账本</strong><BaseButton size="small" variant="outline" :loading="loading" @click="loadEvidence">刷新</BaseButton></div>
      <div v-if="!loading && evidence.length === 0" class="empty-table">暂无证据。请从研发任务中添加，并关联到动态门禁。</div>
      <table v-else>
        <thead><tr><th>类型</th><th>事实</th><th>来源 / 结果</th><th>研发任务</th><th>时间</th></tr></thead>
        <tbody><tr v-for="item in evidence" :key="item.id"><td><span class="type-chip">{{ typeText(item.type) }}</span></td><td><strong>{{ item.label }}</strong><p>{{ item.summary }}</p></td><td><code>{{ item.source || '-' }}</code><small>{{ item.result || '' }}</small></td><td><button class="task-link" @click="$router.push({ path: '/tasks', query: { task: item.taskId } })">{{ item.taskTitle }}</button><StatusBadge :status="item.taskStatus" size="small" /></td><td>{{ formatTime(item.createdAt) }}</td></tr></tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PageHeader from '../components/layout/PageHeader.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import StatusBadge from '../components/common/StatusBadge.vue'
import { getProjects, type TestProject } from '../api/projects'
import { listTaskEvidence, type EvidenceType, type TaskEvidence, type DevelopmentTaskStatus } from '../api/tasks'
import { toast } from '../composables/useToast'
type EvidenceRow = TaskEvidence & { taskId: string; taskTitle: string; projectId: string; taskStatus: DevelopmentTaskStatus }
const projects = ref<TestProject[]>([]); const evidence = ref<EvidenceRow[]>([]); const projectFilter = ref(''); const loading = ref(false)
const labels: Record<EvidenceType,string> = { file:'文件 / 代码',command:'命令 / 构建',test:'测试',http:'接口',browser:'浏览器',database:'数据库',decision:'决策',note:'记录',acceptance:'验收' }
function typeText(type: EvidenceType){return labels[type] || type} function typeCount(type: EvidenceType){return evidence.value.filter(item=>item.type===type).length} function formatTime(value:string){return new Date(value).toLocaleString('zh-CN')}
async function loadEvidence(){loading.value=true;try{evidence.value=await listTaskEvidence(projectFilter.value||undefined)}catch(error:any){toast.error(error.message)}finally{loading.value=false}}
onMounted(async()=>{try{projects.value=(await getProjects()).data}catch{}await loadEvidence()})
</script>

<style scoped>
.evidence-page{max-width:1400px}.native-select{height:34px;border:1px solid var(--border-strong);border-radius:8px;background:#fff;padding:0 10px;color:var(--text-2)}.evidence-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}.evidence-summary>div{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px}.evidence-summary strong,.evidence-summary span{display:block}.evidence-summary strong{font-size:24px}.evidence-summary span{font-size:11px;color:var(--text-3);margin-top:4px}.evidence-table-wrap{padding:0;overflow:hidden}.table-toolbar{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border)}.empty-table{padding:80px;text-align:center;color:var(--text-4)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--border-light);vertical-align:top}th{font-size:10px;color:var(--text-4);background:var(--bg-surface-2)}td{font-size:11px;color:var(--text-2)}td strong{font-size:12px}td p{color:var(--text-3);margin-top:4px;line-height:1.5}td code,td small{display:block;font-size:9px;color:var(--text-4);max-width:260px;overflow-wrap:anywhere}.type-chip{font-size:10px;color:var(--brand);background:var(--brand-soft);padding:4px 7px;border-radius:6px;white-space:nowrap}.task-link{display:block;border:0;background:none;padding:0;color:var(--brand);cursor:pointer;font-size:11px;margin-bottom:6px}@media(max-width:900px){.evidence-summary{grid-template-columns:1fr 1fr}.evidence-table-wrap{overflow:auto}table{min-width:900px}}
</style>
