<template>
  <div class="workflow-page page-container">
    <PageHeader title="工作流" description="触发自动化工作流，监控执行进度" />

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

    <!-- 中止确认弹窗 -->
    <BaseModal
      v-model:show="showAbortConfirm"
      title="确认中止"
      preset="dialog"
      :width="420"
      @confirm="doAbort"
    >
      <div style="padding: 4px 0">确认中止此工作流？中止后无法恢复。</div>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import StatusBadge from '../components/common/StatusBadge.vue'
import StepPipeline from '../components/workflow/StepPipeline.vue'
import WorkflowParamsForm from '../components/workflow/WorkflowParamsForm.vue'
import PageHeader from '../components/layout/PageHeader.vue'
import BaseModal from '../components/ui/BaseModal.vue'
import { useToast } from '../composables/useToast'
import { listTemplates, listRuns, runWorkflow, confirmStep as apiConfirm, abortRun as apiAbort } from '../api/workflows'
import type { WorkflowTemplate, WorkflowRun } from '../api/types'

const tab = ref<'templates' | 'history'>('templates')
const templates = ref<WorkflowTemplate[]>([])
const runs = ref<WorkflowRun[]>([])
const expandedRun = ref<string | null>(null)
const { toast } = useToast()
const showAbortConfirm = ref(false)
const pendingAbortId = ref<string | null>(null)

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
    toast.error('执行失败: ' + e.message)
  }
}

async function confirmStep(runId: string) {
  try {
    await apiConfirm(runId)
    runs.value = await listRuns()
  } catch (e: any) {
    toast.error('操作失败: ' + e.message)
  }
}

function abortWorkflow(runId: string) {
  pendingAbortId.value = runId
  showAbortConfirm.value = true
}

async function doAbort() {
  const runId = pendingAbortId.value
  if (!runId) return
  try {
    await apiAbort(runId)
    runs.value = await listRuns()
  } catch (e: any) {
    toast.error('操作失败: ' + e.message)
  } finally {
    pendingAbortId.value = null
    showAbortConfirm.value = false
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
    toast.error('恢复失败: ' + e.message)
  }
}
</script>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: var(--space-5);
  border-bottom: 2px solid var(--border-light);
  padding-bottom: 0;
}
.tab {
  padding: 10px 20px;
  background: none;
  border: none;
  font-size: 14px;
  color: var(--text-3);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all var(--duration-fast) var(--ease);
}
.tab.active {
  color: var(--brand);
  border-bottom-color: var(--brand);
  font-weight: 600;
}
.run-count {
  background: var(--brand);
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  margin-left: 6px;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}
.wf-card {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
}
.wf-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: var(--space-2);
}
.wf-desc {
  font-size: 13px;
  color: var(--text-3);
  line-height: 1.5;
  margin-bottom: var(--space-3);
}
.wf-meta {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.meta-item {
  font-size: 12px;
  color: var(--text-3);
  background: var(--bg-surface-2);
  padding: 3px 8px;
  border-radius: var(--radius-xs);
}
.meta-item.trigger {
  font-family: var(--font-mono);
  color: var(--brand);
  background: var(--brand-soft);
}
.btn-exec {
  width: 100%;
  padding: 8px 0;
  background: var(--brand);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background var(--duration-fast) var(--ease);
}
.btn-exec:hover { background: var(--brand-hover); }

.no-runs {
  color: var(--text-4);
  text-align: center;
  padding: 40px;
  font-size: 14px;
}
.run-card {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  margin-bottom: 10px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.run-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease);
}
.run-header:hover { background: var(--bg-surface-2); }
.run-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
.run-name { font-size: 14px; font-weight: 500; color: var(--text-1); }
.run-time { font-size: 12px; color: var(--text-4); }
.run-detail {
  padding: 0 18px 16px;
  border-top: 1px solid var(--border-light);
}
.run-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.act {
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  cursor: pointer;
  font-size: 12px;
  transition: all var(--duration-fast) var(--ease);
}
.act.confirm:hover { border-color: var(--success); color: var(--success); }
.act.resume:hover { border-color: var(--info); color: var(--info); }
.act.abort:hover { border-color: var(--error); color: var(--error); }
</style>
