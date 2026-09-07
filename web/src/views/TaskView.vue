<template>
  <div class="task-page page-container">
    <PageHeader title="研发任务" description="把真实需求推进为有证据、可回退、可验收的系统增量">
      <BaseButton variant="primary" :icon="IconAction.add" @click="openCreate">新建研发任务</BaseButton>
    </PageHeader>

    <section class="overview-grid" aria-label="任务概览">
      <button class="metric-card" :class="{ active: statusFilter === '' }" @click="statusFilter = ''">
        <span>全部任务</span><strong>{{ overview.total }}</strong>
      </button>
      <button class="metric-card metric-running" :class="{ active: statusFilter === 'running' }" @click="statusFilter = 'running'">
        <span>正在推进</span><strong>{{ overview.active }}</strong>
      </button>
      <button class="metric-card metric-warning" :class="{ active: statusFilter === 'blocked' }" @click="statusFilter = 'blocked'">
        <span>阻塞 / 待确认</span><strong>{{ overview.blocked }}</strong>
      </button>
      <button class="metric-card metric-info" :class="{ active: statusFilter === 'awaiting_acceptance' }" @click="statusFilter = 'awaiting_acceptance'">
        <span>等待验收</span><strong>{{ overview.awaitingAcceptance }}</strong>
      </button>
      <button class="metric-card metric-success" :class="{ active: statusFilter === 'accepted' }" @click="statusFilter = 'accepted'">
        <span>已验收</span><strong>{{ overview.accepted }}</strong>
      </button>
    </section>

    <div class="workspace-grid">
      <aside class="task-rail surface-card">
        <div class="rail-toolbar">
          <div>
            <strong>{{ filteredTasks.length }} 项任务</strong>
            <span>按最近更新排序</span>
          </div>
          <button class="icon-button" aria-label="刷新任务" @click="loadAll">↻</button>
        </div>
        <select v-model="projectFilter" class="native-select" aria-label="按项目筛选">
          <option value="">全部项目</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
        <div v-if="loading" class="rail-empty">正在读取任务…</div>
        <div v-else-if="filteredTasks.length === 0" class="rail-empty">
          <strong>还没有匹配的研发任务</strong>
          <span>从一项真实需求开始，不需要先选择 Skill 或流水线。</span>
        </div>
        <button
          v-for="task in filteredTasks"
          v-else
          :key="task.id"
          class="task-card"
          :class="{ active: selectedTask?.id === task.id }"
          @click="selectTask(task)"
        >
          <div class="task-card-top">
            <span class="kind-chip">{{ kindText(task.kind) }}</span>
            <StatusBadge :status="task.status" size="small" />
          </div>
          <strong>{{ task.title }}</strong>
          <p>{{ task.goal }}</p>
          <div class="task-card-meta">
            <span>{{ projectName(task.projectId) }}</span>
            <time>{{ formatRelative(task.updatedAt) }}</time>
          </div>
        </button>
      </aside>

      <main class="task-canvas">
        <div v-if="!selectedTask" class="empty-canvas surface-card">
          <div class="empty-mark">→</div>
          <h2>选择一项任务查看闭环状态</h2>
          <p>任务契约、决策、证据、动态门禁和验收结论都集中在这里。</p>
          <BaseButton variant="primary" @click="openCreate">创建第一项任务</BaseButton>
        </div>

        <template v-else>
          <section class="task-hero surface-card">
            <div class="hero-main">
              <div class="hero-kicker">
                <span>{{ projectName(selectedTask.projectId) }}</span>
                <span>{{ kindText(selectedTask.kind) }}</span>
                <span>{{ priorityText(selectedTask.priority) }}</span>
              </div>
              <div class="hero-title-row">
                <h2>{{ selectedTask.title }}</h2>
                <StatusBadge :status="selectedTask.status" />
              </div>
              <p>{{ selectedTask.goal }}</p>
              <div class="current-node">
                <span>当前节点</span>
                <strong>{{ selectedTask.currentNode }}</strong>
              </div>
            </div>
            <div class="hero-actions">
              <BaseButton v-if="canStart" variant="primary" :loading="acting" @click="runStart">启动任务</BaseButton>
              <BaseButton v-if="canAutomate" variant="primary" :loading="acting" @click="runAutomation">启动自动研发</BaseButton>
              <BaseButton v-if="canStopAutomation" variant="outline" :loading="acting" @click="runStopAutomation">停止自动研发</BaseButton>
              <BaseButton v-if="canSubmit" variant="primary" :disabled="!allRequiredGatesPassed" :loading="acting" @click="runSubmit">
                提交验收
              </BaseButton>
              <BaseButton v-if="selectedTask.status === 'awaiting_acceptance'" variant="primary" @click="openAccept">验收通过</BaseButton>
              <BaseButton v-if="!['accepted', 'archived'].includes(selectedTask.status)" variant="ghost" @click="openDecision">提出待确认</BaseButton>
              <BaseButton v-if="selectedTask.status === 'accepted'" variant="ghost" @click="runArchive">归档</BaseButton>
            </div>
          </section>

          <section class="flow-strip surface-card" aria-label="闭环进度">
            <div v-for="(step, index) in flowSteps" :key="step.label" class="flow-step" :class="step.state">
              <span>{{ index + 1 }}</span>
              <div><strong>{{ step.label }}</strong><small>{{ step.desc }}</small></div>
            </div>
          </section>

          <section v-if="taskGraph || graphLoading" class="graph-card surface-card" aria-label="动态执行图">
            <div class="section-heading graph-heading">
              <div><span class="eyebrow">AUTOMATION GRAPH</span><h3>动态执行图</h3></div>
              <div v-if="taskGraph" class="graph-summary">
                <StatusBadge :status="taskGraph.status" size="small" />
                <span>{{ completedGraphNodes }}/{{ taskGraph.nodes.length }} 节点完成</span>
              </div>
            </div>
            <div v-if="graphLoading" class="section-empty">正在读取执行图…</div>
            <template v-else-if="taskGraph">
              <div class="worker-strip" :class="`worker-${taskGraph.worker.status}`">
                <div><strong>Codex 主控</strong><span>{{ workerStatusText(taskGraph.worker.status) }}</span></div>
                <code v-if="taskGraph.worker.threadId">{{ taskGraph.worker.threadId }}</code>
                <p>{{ taskGraph.worker.message || '等待启动' }}</p>
              </div>
              <div class="graph-nodes">
                <article v-for="node in taskGraph.nodes" :key="node.id" class="graph-node" :class="`node-${node.status}`">
                  <div class="node-top">
                    <span class="node-kind">{{ graphKindText(node.kind) }}</span>
                    <span class="node-status">{{ graphNodeStatusText(node.status) }}</span>
                  </div>
                  <strong>{{ node.name }}</strong>
                  <p>{{ node.instructions }}</p>
                  <div v-if="node.dependsOn.length" class="node-dependencies"><span>依赖</span><code v-for="dependency in node.dependsOn" :key="dependency">{{ dependency }}</code></div>
                  <div class="node-meta"><span>{{ node.agentRole }}</span><span>证据 {{ node.evidence.length }}</span><span v-if="node.retryCount">重试 {{ node.retryCount }}/{{ node.maxRetries }}</span></div>
                  <div v-if="node.workerId" class="node-worker">执行者 {{ node.workerId }}</div>
                  <div v-if="node.error" class="node-error">{{ node.error }}</div>
                </article>
              </div>
            </template>
          </section>

          <div class="detail-grid">
            <section class="surface-card contract-card">
              <div class="section-heading">
                <div><span class="eyebrow">TASK CONTRACT</span><h3>任务契约</h3></div>
              </div>
              <dl class="contract-list">
                <div><dt>原始需求</dt><dd>{{ selectedTask.requirement }}</dd></div>
                <div><dt>范围</dt><dd>{{ selectedTask.scope || '未单独声明，以目标和验收标准为边界' }}</dd></div>
                <div><dt>不做范围</dt><dd>{{ selectedTask.outOfScope || '尚未声明' }}</dd></div>
              </dl>
              <div class="criteria-block">
                <strong>可观察验收标准</strong>
                <ol><li v-for="item in selectedTask.acceptanceCriteria" :key="item">{{ item }}</li></ol>
              </div>
              <div v-if="selectedTask.sourceRefs.length" class="reference-list">
                <strong>原始来源</strong>
                <code v-for="item in selectedTask.sourceRefs" :key="item">{{ item }}</code>
              </div>
            </section>

            <section class="surface-card gate-card">
              <div class="section-heading">
                <div><span class="eyebrow">DYNAMIC GATES</span><h3>动态门禁</h3></div>
                <span class="section-count">{{ passedGateCount }}/{{ requiredGateCount }}</span>
              </div>
              <div class="gate-list">
                <article v-for="gate in selectedTask.gates" :key="gate.id" class="gate-item" :class="`gate-${gate.result}`">
                  <div class="gate-state">{{ gateMark(gate.result) }}</div>
                  <div class="gate-body">
                    <div class="gate-title-row"><strong>{{ gate.claim }}</strong><StatusBadge :status="gate.result" size="small" /></div>
                    <p>{{ gate.method }}</p>
                    <small v-if="gate.result === 'fail' || gate.result === 'blocked'">失败返回：{{ gate.onFail }}</small>
                    <div v-if="gate.evidenceIds.length" class="gate-evidence">已关联 {{ gate.evidenceIds.length }} 条证据</div>
                  </div>
                  <button v-if="!['awaiting_acceptance', 'accepted', 'archived'].includes(selectedTask.status)" class="text-button" @click="openGate(gate)">评估</button>
                </article>
              </div>
            </section>
          </div>

          <div class="detail-grid lower-grid">
            <section class="surface-card evidence-card">
              <div class="section-heading">
                <div><span class="eyebrow">CURRENT EVIDENCE</span><h3>本轮证据</h3></div>
                <BaseButton v-if="!['accepted', 'archived'].includes(selectedTask.status)" size="small" variant="outline" @click="openEvidence">添加证据</BaseButton>
              </div>
              <div v-if="selectedTask.evidence.length === 0" class="section-empty">还没有证据，门禁不能通过。</div>
              <div v-else class="evidence-list">
                <article v-for="item in selectedTask.evidence" :key="item.id">
                  <span class="evidence-type">{{ evidenceTypeText(item.type) }}</span>
                  <div><strong>{{ item.label }}</strong><p>{{ item.summary }}</p><code v-if="item.source">{{ item.source }}</code></div>
                  <time>{{ formatTime(item.createdAt) }}</time>
                </article>
              </div>
            </section>

            <section class="surface-card decision-card">
              <div class="section-heading">
                <div><span class="eyebrow">HUMAN DECISIONS</span><h3>人工决策</h3></div>
              </div>
              <div v-if="selectedTask.decisions.length === 0" class="section-empty">暂无需要人工拍板的事项。</div>
              <div v-else class="decision-list">
                <article v-for="decision in selectedTask.decisions" :key="decision.id" :class="decision.status">
                  <div><strong>{{ decision.question }}</strong><p v-if="decision.resolution">{{ decision.resolution }}</p></div>
                  <BaseButton v-if="decision.status === 'open'" size="small" variant="primary" @click="openResolve(decision)">给出结论</BaseButton>
                  <span v-else class="resolved-label">已确认</span>
                </article>
              </div>
              <div class="timeline">
                <div v-for="item in selectedTask.events.slice(0, 6)" :key="item.id"><span></span><p>{{ item.message }}<time>{{ formatTime(item.createdAt) }}</time></p></div>
              </div>
            </section>
          </div>
        </template>
      </main>
    </div>

    <BaseModal v-model:show="createVisible" title="新建研发任务" width="760" show-default-footer confirm-text="建立任务契约" :confirm-loading="acting" @confirm="runCreate">
      <div class="form-grid">
        <label class="form-field"><span>项目 *</span><select v-model="createForm.projectId" class="native-select"><option value="" disabled>选择项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
        <label class="form-field"><span>任务类型 *</span><select v-model="createForm.kind" class="native-select"><option v-for="kind in taskKinds" :key="kind.value" :value="kind.value">{{ kind.label }}</option></select></label>
        <label class="form-field form-wide"><span>任务标题 *</span><BaseInput v-model="createForm.title" placeholder="例如：修复登录后权限菜单缺失" /></label>
        <label class="form-field form-wide"><span>原始需求 *</span><BaseInput v-model="createForm.requirement" type="textarea" :rows="3" placeholder="保留用户原始表达，不要先改写成实现方案" /></label>
        <label class="form-field form-wide"><span>本轮目标 *</span><BaseInput v-model="createForm.goal" type="textarea" :rows="2" placeholder="本轮最终要证明或交付什么" /></label>
        <label class="form-field"><span>允许范围</span><BaseInput v-model="createForm.scope" type="textarea" :rows="3" placeholder="允许读取和修改的模块" /></label>
        <label class="form-field"><span>不做范围</span><BaseInput v-model="createForm.outOfScope" type="textarea" :rows="3" placeholder="明确本轮不顺手扩展什么" /></label>
        <label class="form-field form-wide"><span>验收标准 *（每行一条）</span><BaseInput v-model="createForm.acceptanceText" type="textarea" :rows="4" placeholder="生产构建通过&#10;真实登录入口验证通过&#10;失败场景有明确反馈" /></label>
        <label class="form-field"><span>原始来源（每行一条）</span><BaseInput v-model="createForm.sourceText" type="textarea" :rows="3" placeholder="需求文档、代码路径、问题链接" /></label>
        <label class="form-field"><span>已知风险（每行一条）</span><BaseInput v-model="createForm.riskText" type="textarea" :rows="3" placeholder="权限、数据删除、外部依赖等" /></label>
      </div>
    </BaseModal>

    <BaseModal v-model:show="evidenceVisible" title="添加当前证据" width="620" show-default-footer confirm-text="保存证据" :confirm-loading="acting" @confirm="runAddEvidence">
      <div class="form-grid single">
        <label class="form-field"><span>证据类型 *</span><select v-model="evidenceForm.type" class="native-select"><option v-for="type in evidenceTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></label>
        <label class="form-field"><span>证据名称 *</span><BaseInput v-model="evidenceForm.label" placeholder="例如：前端生产构建" /></label>
        <label class="form-field"><span>事实摘要 *</span><BaseInput v-model="evidenceForm.summary" type="textarea" :rows="3" placeholder="记录实际发生了什么，不先写解释" /></label>
        <label class="form-field"><span>命令、路径或入口</span><BaseInput v-model="evidenceForm.source" placeholder="npm run build / 文件路径 / URL" /></label>
        <label class="form-field"><span>结果</span><BaseInput v-model="evidenceForm.result" placeholder="exit 0 / HTTP 200 / 12 passed" /></label>
      </div>
    </BaseModal>

    <BaseModal v-model:show="gateVisible" title="评估动态门禁" width="680" show-default-footer confirm-text="保存评估" :confirm-loading="acting" @confirm="runEvaluateGate">
      <div v-if="gateForm.gate" class="gate-modal">
        <strong>{{ gateForm.gate.claim }}</strong><p>{{ gateForm.gate.method }}</p>
        <label class="form-field"><span>评估结果</span><select v-model="gateForm.result" class="native-select"><option value="pass">通过</option><option value="fail">失败并返工</option><option value="blocked">环境阻塞</option><option value="not_applicable">本轮不适用</option></select></label>
        <div class="form-field"><span>关联证据 {{ gateForm.result === 'pass' ? '*' : '' }}</span><div class="evidence-picker"><label v-for="item in selectedTask?.evidence || []" :key="item.id"><input v-model="gateForm.evidenceIds" type="checkbox" :value="item.id" /><span><strong>{{ item.label }}</strong><small>{{ item.summary }}</small></span></label></div></div>
        <label class="form-field"><span>评估说明</span><BaseInput v-model="gateForm.note" type="textarea" :rows="2" placeholder="失败原因、限制或不适用依据" /></label>
      </div>
    </BaseModal>

    <BaseModal v-model:show="textActionVisible" :title="textActionTitle" width="620" show-default-footer :confirm-text="textActionConfirm" :confirm-loading="acting" @confirm="runTextAction">
      <label class="form-field"><span>{{ textActionLabel }}</span><BaseInput v-model="textActionValue" type="textarea" :rows="4" :placeholder="textActionPlaceholder" /></label>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../components/layout/PageHeader.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import BaseModal from '../components/ui/BaseModal.vue'
import StatusBadge from '../components/common/StatusBadge.vue'
import { IconAction } from '../composables/icons'
import { toast } from '../composables/useToast'
import { getProjects, type TestProject } from '../api/projects'
import {
  acceptTask,
  addTaskEvidence,
  archiveTask,
  createTask,
  evaluateTaskGate,
  getTaskOverview,
  getTaskGraph,
  listTasks,
  openTaskDecision,
  resolveTaskDecision,
  startTaskAutomation,
  startTask,
  stopTaskAutomation,
  submitTask,
  type DevelopmentTask,
  type DevelopmentTaskKind,
  type EvidenceType,
  type GateResult,
  type TaskDecision,
  type TaskGate,
  type TaskOverview,
  type TaskGraph,
} from '../api/tasks'

const projects = ref<TestProject[]>([])
const route = useRoute()
const tasks = ref<DevelopmentTask[]>([])
const selectedTask = ref<DevelopmentTask | null>(null)
const loading = ref(false)
const acting = ref(false)
const projectFilter = ref('')
const statusFilter = ref('')
const overview = reactive<TaskOverview>({ total: 0, active: 0, awaitingAcceptance: 0, accepted: 0, blocked: 0, counts: {} })

const createVisible = ref(false)
const evidenceVisible = ref(false)
const gateVisible = ref(false)
const taskGraph = ref<TaskGraph | null>(null)
const graphLoading = ref(false)
const textActionVisible = ref(false)
const textActionType = ref<'decision' | 'resolve' | 'accept'>('decision')
const textActionValue = ref('')
const resolvingDecision = ref<TaskDecision | null>(null)

const createForm = reactive({ projectId: '', title: '', kind: 'feature' as DevelopmentTaskKind, priority: 'medium' as const, requirement: '', goal: '', scope: '', outOfScope: '', acceptanceText: '', sourceText: '', riskText: '' })
const evidenceForm = reactive({ type: 'command' as EvidenceType, label: '', summary: '', source: '', result: '' })
const gateForm = reactive<{ gate: TaskGate | null; result: GateResult; evidenceIds: string[]; note: string }>({ gate: null, result: 'pass', evidenceIds: [], note: '' })

const taskKinds = [
  { value: 'feature', label: '新功能' }, { value: 'bug', label: '缺陷修复' }, { value: 'diagnosis', label: '问题诊断' },
  { value: 'design', label: '设计收敛' }, { value: 'migration', label: '迁移改造' }, { value: 'deployment', label: '部署交付' }, { value: 'research', label: '技术研究' },
] as const
const evidenceTypes = [
  { value: 'command', label: '命令 / 构建' }, { value: 'test', label: '测试结果' }, { value: 'http', label: '接口请求' },
  { value: 'browser', label: '浏览器交互' }, { value: 'database', label: '数据库查询' }, { value: 'file', label: '文件 / 代码' },
  { value: 'decision', label: '人工决策' }, { value: 'note', label: '事实记录' },
] as const

const filteredTasks = computed(() => tasks.value.filter(task => {
  if (projectFilter.value && task.projectId !== projectFilter.value) return false
  if (!statusFilter.value) return true
  if (statusFilter.value === 'blocked') return ['blocked', 'needs_confirmation'].includes(task.status)
  if (statusFilter.value === 'running') return ['running', 'rework'].includes(task.status)
  return task.status === statusFilter.value
}))
const canStart = computed(() => !!selectedTask.value && ['draft', 'rework', 'blocked', 'needs_confirmation'].includes(selectedTask.value.status))
const canSubmit = computed(() => !!selectedTask.value && ['running', 'rework'].includes(selectedTask.value.status))
const canAutomate = computed(() => !!selectedTask.value && ['draft', 'running', 'rework'].includes(selectedTask.value.status) && !['starting', 'running'].includes(taskGraph.value?.worker.status || 'idle'))
const canStopAutomation = computed(() => !!taskGraph.value && ['starting', 'running'].includes(taskGraph.value.worker.status))
const completedGraphNodes = computed(() => taskGraph.value?.nodes.filter(item => ['completed', 'skipped'].includes(item.status)).length || 0)
const requiredGateCount = computed(() => selectedTask.value?.gates.filter(item => item.required).length || 0)
const passedGateCount = computed(() => selectedTask.value?.gates.filter(item => item.required && ['pass', 'not_applicable'].includes(item.result)).length || 0)
const allRequiredGatesPassed = computed(() => requiredGateCount.value > 0 && requiredGateCount.value === passedGateCount.value && !selectedTask.value?.decisions.some(item => item.status === 'open'))
const flowSteps = computed(() => {
  const task = selectedTask.value
  if (!task) return []
  const order = ['任务契约', '执行与回退', '证据门禁', '人工验收']
  const activeIndex = task.status === 'draft' ? 0 : ['running', 'rework', 'blocked', 'needs_confirmation'].includes(task.status) ? 1 : task.status === 'awaiting_acceptance' ? 3 : 4
  return order.map((label, index) => ({ label, desc: index === 0 ? '范围与完成条件' : index === 1 ? '动态路线推进' : index === 2 ? `${passedGateCount.value}/${requiredGateCount.value} 已通过` : '交付结论', state: index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'pending' }))
})
const textActionTitle = computed(() => textActionType.value === 'decision' ? '提出待确认事项' : textActionType.value === 'resolve' ? '记录人工结论' : '验收任务')
const textActionLabel = computed(() => textActionType.value === 'decision' ? '需要人工拍板的问题 *' : textActionType.value === 'resolve' ? '确认结论 *' : '验收结论 *')
const textActionConfirm = computed(() => textActionType.value === 'decision' ? '进入待确认' : textActionType.value === 'resolve' ? '保存结论' : '确认验收')
const textActionPlaceholder = computed(() => textActionType.value === 'decision' ? '说明具体决策、影响范围和可选方向' : textActionType.value === 'resolve' ? '记录谁基于什么作出了什么决定' : '说明验收范围和结果，不要只写“通过”')

watch(projectFilter, () => { if (selectedTask.value && projectFilter.value && selectedTask.value.projectId !== projectFilter.value) selectedTask.value = null })

function lines(value: string) { return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean) }
function projectName(id: string) { return projects.value.find(item => item.id === id)?.name || id }
function kindText(kind: DevelopmentTaskKind) { return taskKinds.find(item => item.value === kind)?.label || kind }
function priorityText(value: string) { return ({ low: '低优先级', medium: '中优先级', high: '高优先级' } as Record<string, string>)[value] || value }
function evidenceTypeText(value: string) { return evidenceTypes.find(item => item.value === value)?.label || (value === 'acceptance' ? '验收结论' : value) }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function formatRelative(value: string) { const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前` }
function gateMark(result: GateResult) { return ({ pending: '·', pass: '✓', fail: '!', blocked: '×', not_applicable: '–' } as Record<GateResult, string>)[result] }

async function loadAll() {
  loading.value = true
  try {
    const [projectResponse, taskData, overviewData] = await Promise.all([getProjects(), listTasks(), getTaskOverview()])
    projects.value = projectResponse.data
    tasks.value = taskData
    Object.assign(overview, overviewData)
    if (selectedTask.value) selectedTask.value = taskData.find(item => item.id === selectedTask.value?.id) || null
  } catch (error: any) { toast.error(error.message) } finally { loading.value = false }
}

function applyRouteQuery() {
  const projectId = typeof route.query.project === 'string' ? route.query.project : ''
  const taskId = typeof route.query.task === 'string' ? route.query.task : ''
  if (projectId && projects.value.some(item => item.id === projectId)) projectFilter.value = projectId
  if (taskId) selectedTask.value = tasks.value.find(item => item.id === taskId) || null
  if (route.query.create === '1' && !createVisible.value) openCreate()
}

async function selectTask(task: DevelopmentTask) { selectedTask.value = task; await loadSelectedGraph() }
function openCreate() { if (!createForm.projectId && projects.value.length) createForm.projectId = projects.value[0].id; createVisible.value = true }
function openEvidence() { Object.assign(evidenceForm, { type: 'command', label: '', summary: '', source: '', result: '' }); evidenceVisible.value = true }
function openGate(gate: TaskGate) { gateForm.gate = gate; gateForm.result = gate.result === 'pending' ? 'pass' : gate.result; gateForm.evidenceIds = [...gate.evidenceIds]; gateForm.note = gate.note || ''; gateVisible.value = true }
function openDecision() { textActionType.value = 'decision'; textActionValue.value = ''; resolvingDecision.value = null; textActionVisible.value = true }
function openResolve(decision: TaskDecision) { textActionType.value = 'resolve'; textActionValue.value = decision.resolution || ''; resolvingDecision.value = decision; textActionVisible.value = true }
function openAccept() { textActionType.value = 'accept'; textActionValue.value = ''; resolvingDecision.value = null; textActionVisible.value = true }

async function loadSelectedGraph() {
  if (!selectedTask.value) { taskGraph.value = null; return }
  graphLoading.value = true
  try {
    taskGraph.value = await getTaskGraph(selectedTask.value.projectId, selectedTask.value.id)
  } catch (error: any) {
    if (error?.response?.status === 404) taskGraph.value = null
    else toast.error(error.message)
  } finally { graphLoading.value = false }
}

async function runAutomation() {
  if (!selectedTask.value) return
  acting.value = true
  try {
    taskGraph.value = await startTaskAutomation(selectedTask.value.projectId, selectedTask.value.id, true)
    toast.success('动态 Graph 与 Codex 主控已启动')
    await loadAll()
  } catch (error: any) { toast.error(error.message) } finally { acting.value = false }
}

async function runStopAutomation() {
  if (!selectedTask.value) return
  acting.value = true
  try {
    taskGraph.value = await stopTaskAutomation(selectedTask.value.projectId, selectedTask.value.id)
    toast.success('自动研发已停止，运行证据仍保留')
  } catch (error: any) { toast.error(error.message) } finally { acting.value = false }
}

function graphKindText(value: string) { return ({ discovery: '发现', design: '设计', implementation: '实现', verification: '验证', review: '审查', handoff: '交付' } as Record<string, string>)[value] || value }
function graphNodeStatusText(value: string) { return ({ pending: '等待依赖', runnable: '可执行', running: '执行中', waiting_human: '等待确认', completed: '已完成', failed: '失败', skipped: '已跳过' } as Record<string, string>)[value] || value }
function workerStatusText(value: string) { return ({ idle: '未启动', starting: '启动中', running: '运行中', completed: '本轮已结束', failed: '启动或执行失败', stopped: '已停止' } as Record<string, string>)[value] || value }

async function applyTaskAction(action: () => Promise<DevelopmentTask>, success: string) {
  acting.value = true
  try { selectedTask.value = await action(); toast.success(success); await loadAll() } catch (error: any) { toast.error(error.message) } finally { acting.value = false }
}

async function runCreate() {
  acting.value = true
  try {
    const task = await createTask({ projectId: createForm.projectId, title: createForm.title, kind: createForm.kind, priority: createForm.priority, requirement: createForm.requirement, goal: createForm.goal, scope: createForm.scope, outOfScope: createForm.outOfScope, acceptanceCriteria: lines(createForm.acceptanceText), sourceRefs: lines(createForm.sourceText), risks: lines(createForm.riskText) })
    createVisible.value = false
    Object.assign(createForm, { title: '', kind: 'feature', requirement: '', goal: '', scope: '', outOfScope: '', acceptanceText: '', sourceText: '', riskText: '' })
    await loadAll(); selectedTask.value = tasks.value.find(item => item.id === task.id) || task; toast.success('任务契约已建立')
  } catch (error: any) { toast.error(error.message) } finally { acting.value = false }
}
function runStart() { if (selectedTask.value) applyTaskAction(() => startTask(selectedTask.value!.projectId, selectedTask.value!.id), '任务已启动') }
function runSubmit() { if (selectedTask.value) applyTaskAction(() => submitTask(selectedTask.value!.projectId, selectedTask.value!.id), '已提交人工验收') }
function runArchive() { if (selectedTask.value) applyTaskAction(() => archiveTask(selectedTask.value!.projectId, selectedTask.value!.id), '任务已软归档') }

async function runAddEvidence() {
  if (!selectedTask.value) return
  await applyTaskAction(() => addTaskEvidence(selectedTask.value!.projectId, selectedTask.value!.id, { ...evidenceForm }), '证据已记录')
  evidenceVisible.value = false
}
async function runEvaluateGate() {
  if (!selectedTask.value || !gateForm.gate) return
  await applyTaskAction(() => evaluateTaskGate(selectedTask.value!.projectId, selectedTask.value!.id, gateForm.gate!.id, gateForm.result, gateForm.evidenceIds, gateForm.note), '门禁结果已更新')
  gateVisible.value = false
}
async function runTextAction() {
  if (!selectedTask.value) return
  const value = textActionValue.value.trim()
  if (!value) { toast.error('请填写具体内容'); return }
  if (textActionType.value === 'decision') await applyTaskAction(() => openTaskDecision(selectedTask.value!.projectId, selectedTask.value!.id, value), '任务已进入待确认')
  if (textActionType.value === 'resolve' && resolvingDecision.value) await applyTaskAction(() => resolveTaskDecision(selectedTask.value!.projectId, selectedTask.value!.id, resolvingDecision.value!.id, value), '人工结论已记录')
  if (textActionType.value === 'accept') await applyTaskAction(() => acceptTask(selectedTask.value!.projectId, selectedTask.value!.id, value), '任务已验收完成')
  textActionVisible.value = false
}

watch(() => route.fullPath, applyRouteQuery)
watch(() => selectedTask.value?.id, () => { void loadSelectedGraph() })
const graphPoll = window.setInterval(() => {
  if (selectedTask.value && taskGraph.value && ['starting', 'running', 'waiting_human'].includes(taskGraph.value.worker.status)) {
    void loadSelectedGraph()
  }
}, 3000)
onBeforeUnmount(() => window.clearInterval(graphPoll))
onMounted(async () => { await loadAll(); applyRouteQuery(); await loadSelectedGraph() })
</script>

<style scoped>
.task-page { max-width: 1540px; }
.overview-grid { display:grid; grid-template-columns:repeat(5,minmax(130px,1fr)); gap:12px; margin-bottom:20px; }
.metric-card { border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--bg-surface); padding:15px 18px; text-align:left; cursor:pointer; box-shadow:var(--shadow-xs); }
.metric-card span { display:block; color:var(--text-3); font-size:12px; margin-bottom:6px; }.metric-card strong{font-size:25px;color:var(--text-1)}
.metric-card:hover,.metric-card.active{border-color:var(--brand);box-shadow:var(--shadow-md)}.metric-running strong{color:var(--brand)}.metric-warning strong{color:var(--warning)}.metric-info strong{color:var(--info)}.metric-success strong{color:var(--success)}
.workspace-grid { display:grid; grid-template-columns:320px minmax(0,1fr); gap:20px; align-items:start; }.task-rail{padding:0;overflow:hidden;position:sticky;top:24px;max-height:calc(100vh - 48px);overflow-y:auto}
.rail-toolbar{display:flex;justify-content:space-between;align-items:center;padding:18px;border-bottom:1px solid var(--border)}.rail-toolbar strong,.rail-toolbar span{display:block}.rail-toolbar span{font-size:11px;color:var(--text-4);margin-top:3px}.icon-button{border:1px solid var(--border);background:var(--bg-surface);border-radius:8px;width:32px;height:32px;cursor:pointer;color:var(--text-3)}
.task-rail>.native-select{margin:14px;width:calc(100% - 28px)}.rail-empty{padding:36px 22px;text-align:center;color:var(--text-3);font-size:13px}.rail-empty strong,.rail-empty span{display:block}.rail-empty span{margin-top:8px;line-height:1.5}
.task-card{width:100%;border:0;border-top:1px solid var(--border-light);background:transparent;text-align:left;padding:16px 18px;cursor:pointer}.task-card:hover{background:var(--bg-surface-2)}.task-card.active{background:var(--brand-soft);box-shadow:inset 3px 0 var(--brand)}.task-card-top,.task-card-meta{display:flex;align-items:center;justify-content:space-between;gap:8px}.task-card>strong{display:block;margin-top:10px;font-size:14px;color:var(--text-1)}.task-card p{font-size:12px;color:var(--text-3);line-height:1.5;margin:6px 0 12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.task-card-meta{font-size:11px;color:var(--text-4)}.kind-chip{font-size:11px;padding:3px 8px;border-radius:999px;background:var(--bg-surface-2);color:var(--text-3)}
.task-canvas{min-width:0}.empty-canvas{min-height:480px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.empty-mark{width:56px;height:56px;border-radius:18px;background:var(--brand-soft);color:var(--brand);font-size:30px;display:grid;place-items:center}.empty-canvas h2{margin:18px 0 6px}.empty-canvas p{color:var(--text-3);margin-bottom:20px}
.task-hero{display:flex;justify-content:space-between;gap:20px;background:linear-gradient(135deg,#fff 55%,var(--brand-soft));margin-bottom:14px}.hero-main{min-width:0}.hero-kicker{display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--text-3);text-transform:uppercase}.hero-kicker span{padding-right:8px;border-right:1px solid var(--border)}.hero-title-row{display:flex;align-items:center;gap:12px;margin:10px 0 6px}.hero-title-row h2{font-size:23px;color:var(--text-1)}.hero-main>p{color:var(--text-2);line-height:1.6}.current-node{display:flex;gap:10px;align-items:center;margin-top:14px;font-size:12px}.current-node span{color:var(--text-4)}.current-node strong{color:var(--brand)}.hero-actions{display:flex;align-items:flex-start;justify-content:flex-end;gap:8px;flex-wrap:wrap;max-width:360px}
.flow-strip{display:grid;grid-template-columns:repeat(4,1fr);padding:14px;margin-bottom:14px}.flow-step{display:flex;align-items:center;gap:10px;padding:8px 12px;position:relative}.flow-step:not(:last-child)::after{content:'';position:absolute;right:-6px;width:12px;height:1px;background:var(--border-strong)}.flow-step>span{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--bg-surface-2);color:var(--text-4);font-size:12px}.flow-step strong,.flow-step small{display:block}.flow-step strong{font-size:12px;color:var(--text-2)}.flow-step small{font-size:10px;color:var(--text-4);margin-top:2px}.flow-step.done>span{background:var(--success-bg);color:var(--success)}.flow-step.current>span{background:var(--brand);color:#fff}.flow-step.current strong{color:var(--brand)}
.graph-card{margin-bottom:14px}.graph-heading{margin-bottom:12px}.graph-summary{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--text-3)}.worker-strip{display:grid;grid-template-columns:auto auto minmax(0,1fr);align-items:center;gap:12px;border:1px solid var(--border);background:var(--bg-surface-2);border-radius:10px;padding:11px 13px;margin-bottom:12px}.worker-strip>div{display:flex;align-items:center;gap:8px}.worker-strip strong{font-size:12px}.worker-strip span,.worker-strip p{font-size:11px;color:var(--text-3)}.worker-strip code{font-size:9px;color:var(--brand);overflow-wrap:anywhere}.worker-running,.worker-starting{border-color:var(--brand-border);background:var(--brand-soft)}.worker-failed{border-color:var(--error-border);background:var(--error-bg)}.graph-nodes{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.graph-node{border:1px solid var(--border);border-radius:10px;padding:12px;min-width:0;position:relative}.graph-node::before{content:'';position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:0 3px 3px 0;background:var(--border-strong)}.node-runnable::before{background:var(--info)}.node-running::before{background:var(--brand)}.node-completed::before{background:var(--success)}.node-failed::before,.node-waiting_human::before{background:var(--error)}.node-top,.node-meta{display:flex;align-items:center;justify-content:space-between;gap:7px}.node-kind,.node-status{font-size:9px;color:var(--text-4);text-transform:uppercase}.node-status{padding:2px 6px;border-radius:999px;background:var(--bg-surface-2)}.graph-node>strong{display:block;font-size:13px;color:var(--text-1);margin:9px 0 5px}.graph-node>p{font-size:10px;line-height:1.55;color:var(--text-3);min-height:32px}.node-dependencies{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:8px}.node-dependencies span{font-size:9px;color:var(--text-4)}.node-dependencies code{font-size:8px;padding:2px 5px;border-radius:4px;background:var(--bg-surface-2);color:var(--text-3)}.node-meta{justify-content:flex-start;flex-wrap:wrap;margin-top:9px;font-size:9px;color:var(--text-4)}.node-worker{font-size:9px;color:var(--brand);margin-top:6px;overflow-wrap:anywhere}.node-error{font-size:10px;color:var(--error);background:var(--error-bg);padding:6px;border-radius:5px;margin-top:7px}
.detail-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:14px;margin-bottom:14px}.lower-grid{grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr)}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}.section-heading h3{font-size:16px;color:var(--text-1);margin-top:2px}.eyebrow{font-size:9px;letter-spacing:.12em;color:var(--brand);font-weight:700}.section-count{font-size:20px;color:var(--brand);font-weight:700}.contract-list>div{display:grid;grid-template-columns:84px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-light)}.contract-list dt{font-size:11px;color:var(--text-4)}.contract-list dd{font-size:13px;color:var(--text-2);line-height:1.6}.criteria-block,.reference-list{margin-top:16px}.criteria-block>strong,.reference-list>strong{font-size:12px}.criteria-block ol{padding-left:20px;margin-top:8px}.criteria-block li{font-size:12px;color:var(--text-2);line-height:1.7}.reference-list code{display:block;font-size:10px;background:var(--bg-surface-2);padding:6px 8px;margin-top:6px;border-radius:6px;overflow-wrap:anywhere}
.gate-list{display:flex;flex-direction:column;gap:8px}.gate-item{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:10px;align-items:start;border:1px solid var(--border);border-radius:10px;padding:12px}.gate-state{width:28px;height:28px;border-radius:8px;background:var(--bg-surface-2);display:grid;place-items:center;font-weight:800;color:var(--text-4)}.gate-pass{border-color:var(--success-border)}.gate-pass .gate-state{background:var(--success-bg);color:var(--success)}.gate-fail,.gate-blocked{border-color:var(--error-border)}.gate-fail .gate-state,.gate-blocked .gate-state{background:var(--error-bg);color:var(--error)}.gate-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.gate-body strong{font-size:12px;line-height:1.4}.gate-body p{font-size:11px;color:var(--text-3);margin-top:4px}.gate-body small{color:var(--error)}.gate-evidence{font-size:10px;color:var(--success);margin-top:5px}.text-button{border:0;background:transparent;color:var(--brand);font-size:11px;cursor:pointer;padding:3px}
.section-empty{padding:22px;text-align:center;background:var(--bg-surface-2);border-radius:8px;color:var(--text-4);font-size:12px}.evidence-list,.decision-list{display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto}.evidence-list article{display:grid;grid-template-columns:82px minmax(0,1fr) auto;gap:10px;padding:11px;border:1px solid var(--border-light);border-radius:9px}.evidence-type{font-size:10px;color:var(--brand);background:var(--brand-soft);border-radius:6px;padding:4px 6px;height:max-content;text-align:center}.evidence-list strong{font-size:12px}.evidence-list p{font-size:11px;color:var(--text-3);margin:3px 0}.evidence-list code{font-size:9px;color:var(--text-4);overflow-wrap:anywhere}.evidence-list time,.timeline time{font-size:9px;color:var(--text-4)}.decision-list article{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--border);border-radius:9px;padding:11px}.decision-list article.open{border-color:var(--warning-border);background:var(--warning-bg)}.decision-list strong{font-size:12px}.decision-list p{font-size:11px;color:var(--text-3);margin-top:4px}.resolved-label{font-size:10px;color:var(--success)}.timeline{margin-top:18px;border-top:1px solid var(--border);padding-top:12px}.timeline>div{display:flex;gap:9px}.timeline>div>span{width:7px;height:7px;border-radius:50%;background:var(--border-strong);margin-top:5px;flex:none}.timeline p{font-size:10px;color:var(--text-3);padding-bottom:9px}.timeline time{margin-left:7px}
.native-select{height:34px;border:1px solid var(--border-strong);border-radius:8px;background:#fff;padding:0 10px;color:var(--text-2);font-size:12px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.form-grid.single{grid-template-columns:1fr}.form-field{display:flex;flex-direction:column;gap:7px}.form-field>span{font-size:12px;font-weight:600;color:var(--text-2)}.form-wide{grid-column:1/-1}.gate-modal>strong{font-size:15px}.gate-modal>p{color:var(--text-3);font-size:12px;margin:6px 0 16px}.gate-modal>.form-field{margin-top:14px}.evidence-picker{display:flex;flex-direction:column;gap:6px;max-height:230px;overflow:auto;border:1px solid var(--border);padding:8px;border-radius:8px}.evidence-picker label{display:flex;gap:8px;align-items:flex-start;padding:8px;border-radius:6px}.evidence-picker label:hover{background:var(--bg-surface-2)}.evidence-picker strong,.evidence-picker small{display:block;font-size:11px}.evidence-picker small{color:var(--text-4);margin-top:3px}
@media(max-width:1100px){.overview-grid{grid-template-columns:repeat(3,1fr)}.workspace-grid{grid-template-columns:270px minmax(0,1fr)}.detail-grid,.lower-grid{grid-template-columns:1fr}.task-hero{flex-direction:column}.hero-actions{justify-content:flex-start;max-width:none}}
@media(max-width:760px){.overview-grid{grid-template-columns:repeat(2,1fr)}.workspace-grid{grid-template-columns:1fr}.task-rail{position:static;max-height:420px}.flow-strip{grid-template-columns:1fr 1fr}.form-grid{grid-template-columns:1fr}.form-wide{grid-column:auto}}
</style>
