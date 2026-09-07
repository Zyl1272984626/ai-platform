<template>
  <div class="page-container baseline-page">
    <PageHeader title="项目基线" description="平台只保存项目事实的索引，权威内容仍留在项目代码、文档和数据中">
      <BaseButton variant="outline" :loading="loading" @click="loadProjects">刷新基线</BaseButton>
    </PageHeader>

    <div class="baseline-note">
      <strong>事实边界</strong>
      <span>这里不复制业务设计。它负责告诉研发任务：源码在哪里、运行入口是什么、最近一次发现何时完成。</span>
    </div>

    <div v-if="loading" class="state-panel">正在读取项目基线…</div>
    <div v-else-if="projects.length === 0" class="state-panel">还没有项目，请先在系统设置中配置。</div>
    <div v-else class="project-grid">
      <article v-for="project in projects" :key="project.id" class="project-card surface-card">
        <div class="project-top">
          <div class="project-mark">{{ project.name.slice(0, 1).toUpperCase() }}</div>
          <div><h2>{{ project.name }}</h2><code>{{ project.id }}</code></div>
          <StatusBadge :status="project.status" size="small" />
        </div>
        <dl>
          <div><dt>源码路径</dt><dd>{{ project.sourcePath || '未配置' }}</dd></div>
          <div><dt>前端入口</dt><dd>{{ project.baseUrl || '未配置' }}</dd></div>
          <div><dt>API 入口</dt><dd>{{ project.apiBaseUrl || '未配置' }}</dd></div>
          <div><dt>最近发现</dt><dd>{{ project.discoveredAt ? formatTime(project.discoveredAt) : '尚未执行' }}</dd></div>
        </dl>
        <div class="project-stats">
          <span><strong>{{ pageCount(project) }}</strong> 已登记页面</span>
          <span><strong>{{ project.pageSets?.length || 0 }}</strong> 页面集</span>
        </div>
        <div class="project-actions">
          <BaseButton size="small" variant="primary" @click="$router.push({ path: '/tasks', query: { project: project.id, create: '1' } })">创建研发任务</BaseButton>
          <BaseButton size="small" variant="ghost" @click="$router.push('/settings')">维护配置</BaseButton>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PageHeader from '../components/layout/PageHeader.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import StatusBadge from '../components/common/StatusBadge.vue'
import { getProjects, type TestProject } from '../api/projects'
import { toast } from '../composables/useToast'

const projects = ref<TestProject[]>([])
const loading = ref(false)
function pageCount(project: TestProject) { return (project.pageSets || []).reduce((sum, set) => sum + set.pages.length, 0) }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN') }
async function loadProjects() { loading.value = true; try { projects.value = (await getProjects()).data } catch (error: any) { toast.error(error.message) } finally { loading.value = false } }
onMounted(loadProjects)
</script>

<style scoped>
.baseline-page{max-width:1320px}.baseline-note{display:flex;align-items:center;gap:14px;background:var(--info-bg);border:1px solid var(--info-border);color:var(--text-2);padding:14px 18px;border-radius:var(--radius-lg);margin-bottom:20px;font-size:12px}.baseline-note strong{color:var(--info);white-space:nowrap}.state-panel{padding:80px;text-align:center;color:var(--text-3);background:#fff;border:1px solid var(--border);border-radius:var(--radius-lg)}.project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}.project-card{padding:20px}.project-top{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:12px;align-items:center}.project-mark{width:44px;height:44px;border-radius:12px;background:var(--brand-grad);color:#fff;display:grid;place-items:center;font-size:18px;font-weight:800}.project-top h2{font-size:16px}.project-top code{font-size:10px;color:var(--text-4)}dl{margin:18px 0}dl>div{display:grid;grid-template-columns:80px minmax(0,1fr);gap:10px;padding:8px 0;border-bottom:1px solid var(--border-light)}dt{font-size:11px;color:var(--text-4)}dd{font-size:11px;color:var(--text-2);overflow-wrap:anywhere}.project-stats{display:flex;gap:18px;background:var(--bg-surface-2);padding:10px 12px;border-radius:8px;font-size:11px;color:var(--text-3)}.project-stats strong{color:var(--text-1);font-size:15px;margin-right:4px}.project-actions{display:flex;gap:8px;margin-top:16px}
</style>
