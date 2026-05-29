<template>
  <div class="workflow-page">
    <header class="page-header">
      <div>
        <h1>工作流</h1>
        <p class="page-desc">触发自动化工作流，监控执行进度</p>
      </div>
    </header>

    <!-- Tab 切换 -->
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'templates' }" @click="tab = 'templates'">工作流模板</button>
      <button class="tab" :class="{ active: tab === 'history' }" @click="tab = 'history'">
        执行历史
        <span v-if="runs.length" class="run-count">{{ runs.length }}</span>
      </button>
    </div>

    <!-- 模板列表 -->
    <div v-if="tab === 'templates'" class="template-grid">
      <div v-for="wf in templates" :key="wf.name" class="wf-card">
        <div class="wf-name">{{ wf.name }}</div>
        <div class="wf-desc">{{ wf.description }}</div>
        <div class="wf-meta">
          <span class="meta-item">{{ wf.stepCount }} 个步骤</span>
          <span class="meta-item trigger">{{ wf.trigger?.command }}</span>
        </div>
        <button class="btn-exec" @click="startWorkflow(wf)">执行</button>
      </div>
    </div>

    <!-- 执行历史 -->
    <div v-if="tab === 'history'">
      <div v-if="runs.length === 0" class="no-runs">暂无工作流执行记录</div>
      <div v-for="run in runs" :key="run.id" class="run-card">
        <div class="run-header" @click="toggleRun(run.id)">
          <div class="run-info">
            <span class="run-name">{{ run.workflowName }}</span>
            <StatusBadge :status="run.status" size="small" />
          </div>
          <div class="run-time">{{ formatTime(run.startedAt) }}</div>
        </div>
        <!-- 步骤流水线 -->
        <div v-if="expandedRun === run.id && run.steps?.length" class="run-detail">
          <StepPipeline :steps="run.steps" />
          <!-- 操作按钮 -->
          <div v-if="run.status === 'paused' || run.status === 'failed'" class="run-actions">
            <button v-if="run.status === 'paused'" class="act confirm" @click="confirmStep(run.id)">确认继续</button>
            <button v-if="run.status === 'failed'" class="act resume" @click="resumeWorkflow(run.id)">恢复执行</button>
            <button class="act abort" @click="abortWorkflow(run.id)">中止</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 参数表单 -->
    <WorkflowParamsForm
      v-if="showParams"
      :params="activeParams"
      :description="activeDescription"
      @run="executeWorkflow"
      @cancel="showParams = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import StatusBadge from '../components/common/StatusBadge.vue'
import StepPipeline from '../components/workflow/StepPipeline.vue'
import WorkflowParamsForm from '../components/workflow/WorkflowParamsForm.vue'
import { listTemplates, listRuns, runWorkflow, confirmStep as apiConfirm, abortRun as apiAbort } from '../api/workflows'
import type { WorkflowTemplate, WorkflowRun } from '../api/types'

const tab = ref<'templates' | 'history'>('templates')
const templates = ref<WorkflowTemplate[]>([])
const runs = ref<WorkflowRun[]>([])
const expandedRun = ref<string | null>(null)

const showParams = ref(false)
const activeWfName = ref('')
const activeParams = ref<string[]>([])
const activeDescription = ref('')

onMounted(async () => {
  try {
    const [t, r] = await Promise.all([listTemplates(), listRuns()])
    templates.value = t
    runs.value = r
  } catch { /* ignore */ }
})

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function toggleRun(id: string) {
  expandedRun.value = expandedRun.value === id ? null : id
}

function startWorkflow(wf: WorkflowTemplate) {
  activeWfName.value = wf.name
  activeParams.value = wf.trigger?.params || []
  activeDescription.value = wf.description
  if (activeParams.value.length > 0) {
    showParams.value = true
  } else {
    executeWorkflow({})
  }
}

async function executeWorkflow(params: Record<string, string>) {
  showParams.value = false
  try {
    const { promise } = runWorkflow(activeWfName.value, params, (event: any) => {
      console.log('[Workflow SSE]', event.type, event)
      // TODO: 实时更新步骤状态
    })
    await promise
    // 刷新历史
    runs.value = await listRuns()
    tab.value = 'history'
  } catch (e: any) {
    alert('执行失败: ' + e.message)
  }
}

async function confirmStep(runId: string) {
  try {
    await apiConfirm(runId)
    runs.value = await listRuns()
  } catch (e: any) {
    alert('操作失败: ' + e.message)
  }
}

async function abortWorkflow(runId: string) {
  if (!confirm('确认中止此工作流？')) return
  try {
    await apiAbort(runId)
    runs.value = await listRuns()
  } catch (e: any) {
    alert('操作失败: ' + e.message)
  }
}

async function resumeWorkflow(runId: string) {
  try {
    const { promise } = runWorkflow('__resume__', {}, (event: any) => {
      console.log('[Resume SSE]', event)
    })
    await promise
    runs.value = await listRuns()
  } catch (e: any) {
    alert('恢复失败: ' + e.message)
  }
}
</script>

<style scoped>
.workflow-page {
  padding: 28px 32px;
  max-width: 1200px;
  margin: 0 auto;
}
.page-header { margin-bottom: 20px; }
.page-header h1 { font-size: 22px; font-weight: 700; color: #1a1a2e; }
.page-desc { font-size: 13px; color: #999; margin-top: 4px; }

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 2px solid #eee;
  padding-bottom: 0;
}
.tab {
  padding: 10px 20px;
  background: none;
  border: none;
  font-size: 14px;
  color: #999;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.15s;
}
.tab.active {
  color: #667eea;
  border-bottom-color: #667eea;
  font-weight: 600;
}
.run-count {
  background: #667eea;
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  margin-left: 6px;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
.wf-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.wf-name {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 8px;
}
.wf-desc {
  font-size: 13px;
  color: #888;
  line-height: 1.5;
  margin-bottom: 12px;
}
.wf-meta {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
}
.meta-item {
  font-size: 12px;
  color: #999;
  background: #f5f5f7;
  padding: 3px 8px;
  border-radius: 4px;
}
.meta-item.trigger {
  font-family: monospace;
  color: #667eea;
  background: #eef0ff;
}
.btn-exec {
  width: 100%;
  padding: 8px 0;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: opacity 0.15s;
}
.btn-exec:hover { opacity: 0.9; }

.no-runs {
  color: #bbb;
  text-align: center;
  padding: 40px;
  font-size: 14px;
}
.run-card {
  background: #fff;
  border-radius: 10px;
  margin-bottom: 10px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  overflow: hidden;
}
.run-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  cursor: pointer;
  transition: background 0.15s;
}
.run-header:hover { background: #fafafa; }
.run-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
.run-name { font-size: 14px; font-weight: 500; color: #333; }
.run-time { font-size: 12px; color: #bbb; }
.run-detail {
  padding: 0 18px 16px;
  border-top: 1px solid #f0f0f0;
}
.run-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.act {
  padding: 6px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}
.act.confirm:hover { border-color: #52c41a; color: #52c41a; }
.act.resume:hover { border-color: #1890ff; color: #1890ff; }
.act.abort:hover { border-color: #ff4d4f; color: #ff4d4f; }
</style>
