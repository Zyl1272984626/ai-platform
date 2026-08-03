import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { getProjectById, getProjects } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.resolve(__dirname, '../../data/projects');

export type DevelopmentTaskKind = 'feature' | 'bug' | 'diagnosis' | 'design' | 'migration' | 'deployment' | 'research';
export type DevelopmentTaskStatus =
  | 'draft'
  | 'running'
  | 'needs_confirmation'
  | 'rework'
  | 'blocked'
  | 'awaiting_acceptance'
  | 'accepted'
  | 'archived';
export type GateResult = 'pending' | 'pass' | 'fail' | 'blocked' | 'not_applicable';
export type EvidenceType = 'file' | 'command' | 'test' | 'http' | 'browser' | 'database' | 'decision' | 'note' | 'acceptance';

export interface TaskEvidence {
  id: string;
  type: EvidenceType;
  label: string;
  summary: string;
  source?: string;
  result?: string;
  createdAt: string;
}

export interface TaskGate {
  id: string;
  claim: string;
  method: string;
  required: boolean;
  result: GateResult;
  evidenceIds: string[];
  note?: string;
  onFail: string;
  updatedAt?: string;
}

export interface TaskDecision {
  id: string;
  question: string;
  resolution?: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

export interface TaskEvent {
  id: string;
  type: 'created' | 'status_changed' | 'evidence_added' | 'gate_evaluated' | 'decision_opened' | 'decision_resolved' | 'updated';
  message: string;
  createdAt: string;
}

export interface DevelopmentTask {
  id: string;
  projectId: string;
  title: string;
  kind: DevelopmentTaskKind;
  priority: 'low' | 'medium' | 'high';
  requirement: string;
  goal: string;
  scope: string;
  outOfScope: string;
  acceptanceCriteria: string[];
  sourceRefs: string[];
  risks: string[];
  status: DevelopmentTaskStatus;
  currentNode: string;
  gates: TaskGate[];
  evidence: TaskEvidence[];
  decisions: TaskDecision[];
  events: TaskEvent[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  submittedAt?: string;
  acceptedAt?: string;
  archivedAt?: string;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  kind?: DevelopmentTaskKind;
  priority?: DevelopmentTask['priority'];
  requirement: string;
  goal: string;
  scope?: string;
  outOfScope?: string;
  acceptanceCriteria: string[];
  sourceRefs?: string[];
  risks?: string[];
}

function assertSafeId(value: string, field: string): void {
  if (!value || !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`${field} 非法`);
  }
}

function taskDir(projectId: string, taskId: string): string {
  assertSafeId(projectId, 'projectId');
  assertSafeId(taskId, 'taskId');
  return path.join(PROJECTS_DIR, projectId, 'tasks', taskId);
}

function taskFile(projectId: string, taskId: string): string {
  return path.join(taskDir(projectId, taskId), 'task.json');
}

function now(): string {
  return new Date().toISOString();
}

function cleanLines(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map(value => String(value).trim()).filter(Boolean);
}

function event(type: TaskEvent['type'], message: string): TaskEvent {
  return { id: uuidv4(), type, message, createdAt: now() };
}

function gate(id: string, claim: string, method: string, onFail: string): TaskGate {
  return { id, claim, method, required: true, result: 'pending', evidenceIds: [], onFail };
}

function defaultGates(kind: DevelopmentTaskKind): TaskGate[] {
  const contract = gate('contract', '目标、范围和验收标准已经形成可执行契约', '字段校验与任务契约快照', '返回需求收敛');
  if (kind === 'design') {
    return [
      contract,
      gate('source', '关键结论能够追溯到原始材料、真实代码或明确决策', '来源追踪', '返回材料盘点'),
      gate('semantics', '需求、业务对象、页面和数据模型的语义一致', '设计审查', '返回设计收敛'),
      gate('review', '高影响边界和验收标准已经人工确认', '人工评审', '进入待确认'),
    ];
  }
  if (kind === 'diagnosis') {
    return [
      contract,
      gate('reproduction', '原始现象可以被当前证据复现或准确界定', '命令、请求、查询或页面操作', '返回现象采集'),
      gate('cause', '根因由跨层证据链支撑，而不是相邻层推断', '代码、请求、数据与日志对照', '返回跨层诊断'),
      gate('recommendation', '建议与已证明根因一致并明确影响边界', '同行审查或人工确认', '返回结论审查'),
    ];
  }
  if (kind === 'bug') {
    return [
      contract,
      gate('reproduction', '修复前问题能够复现并记录基线', '测试、请求、日志或浏览器操作', '返回问题复现'),
      gate('implementation', '修改命中已证明根因且未扩大范围', '代码差异与类型检查', '返回实现'),
      gate('regression', '原问题与相关回归检查在当前工作区通过', '自动化测试或可复现操作', '返回实现或测试'),
      gate('runtime', '真实入口和关键交互已经验证', '接口或浏览器验证', '返回联调'),
    ];
  }
  return [
    contract,
    gate('implementation', '实现覆盖任务契约且代码可以构建', '代码差异、类型检查与生产构建', '返回实现'),
    gate('verification', '相关自动化检查在当前工作区通过', '测试、请求或查询', '返回实现或测试'),
    gate('runtime', '真实入口、异常态和关键交互已经验证', '接口或浏览器验证', '返回联调'),
  ];
}

function writeTask(task: DevelopmentTask): DevelopmentTask {
  const dir = taskDir(task.projectId, task.id);
  fs.mkdirSync(dir, { recursive: true });
  task.updatedAt = now();
  fs.writeFileSync(taskFile(task.projectId, task.id), JSON.stringify(task, null, 2), 'utf-8');
  return task;
}

function parseTask(file: string): DevelopmentTask | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as DevelopmentTask;
  } catch {
    return null;
  }
}

export function listTasks(projectId?: string, includeArchived = false): DevelopmentTask[] {
  const projects = projectId ? [getProjectById(projectId)].filter(Boolean) : getProjects();
  const tasks: DevelopmentTask[] = [];
  for (const project of projects) {
    if (!project) continue;
    const root = path.join(PROJECTS_DIR, project.id, 'tasks');
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const task = parseTask(path.join(root, entry.name, 'task.json'));
      if (task && (includeArchived || task.status !== 'archived')) tasks.push(task);
    }
  }
  return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getTask(projectId: string, taskId: string): DevelopmentTask | null {
  const file = taskFile(projectId, taskId);
  return fs.existsSync(file) ? parseTask(file) : null;
}

export function createTask(input: CreateTaskInput): DevelopmentTask {
  if (!getProjectById(input.projectId)) throw new Error('项目不存在');
  const title = String(input.title || '').trim();
  const requirement = String(input.requirement || '').trim();
  const goal = String(input.goal || '').trim();
  const acceptanceCriteria = cleanLines(input.acceptanceCriteria);
  if (!title || !requirement || !goal || acceptanceCriteria.length === 0) {
    throw new Error('标题、原始需求、目标和至少一条验收标准不能为空');
  }
  const createdAt = now();
  const kind = input.kind || 'feature';
  const task: DevelopmentTask = {
    id: uuidv4(),
    projectId: input.projectId,
    title,
    kind,
    priority: input.priority || 'medium',
    requirement,
    goal,
    scope: String(input.scope || '').trim(),
    outOfScope: String(input.outOfScope || '').trim(),
    acceptanceCriteria,
    sourceRefs: cleanLines(input.sourceRefs),
    risks: cleanLines(input.risks),
    status: 'draft',
    currentNode: '任务契约',
    gates: defaultGates(kind),
    evidence: [],
    decisions: [],
    events: [event('created', '研发任务已创建，等待启动')],
    createdAt,
    updatedAt: createdAt,
  };
  return writeTask(task);
}

export function updateTask(projectId: string, taskId: string, updates: Partial<CreateTaskInput> & { currentNode?: string }): DevelopmentTask {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (task.status === 'accepted' || task.status === 'archived') throw new Error('已验收或已归档任务不能修改契约');
  if (updates.title !== undefined) task.title = String(updates.title).trim();
  if (updates.requirement !== undefined) task.requirement = String(updates.requirement).trim();
  if (updates.goal !== undefined) task.goal = String(updates.goal).trim();
  if (updates.scope !== undefined) task.scope = String(updates.scope).trim();
  if (updates.outOfScope !== undefined) task.outOfScope = String(updates.outOfScope).trim();
  if (updates.priority !== undefined) task.priority = updates.priority;
  if (updates.acceptanceCriteria !== undefined) task.acceptanceCriteria = cleanLines(updates.acceptanceCriteria);
  if (updates.sourceRefs !== undefined) task.sourceRefs = cleanLines(updates.sourceRefs);
  if (updates.risks !== undefined) task.risks = cleanLines(updates.risks);
  if (updates.currentNode !== undefined) task.currentNode = String(updates.currentNode).trim();
  task.events.unshift(event('updated', '任务契约已更新'));
  return writeTask(task);
}

export function startTask(projectId: string, taskId: string): DevelopmentTask {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (task.status === 'accepted' || task.status === 'archived' || task.status === 'awaiting_acceptance') {
    throw new Error('当前状态不能启动');
  }
  if (!task.goal || !task.requirement || task.acceptanceCriteria.length === 0) throw new Error('任务契约不完整');
  const contractGate = task.gates.find(item => item.id === 'contract');
  if (contractGate && contractGate.result !== 'pass') {
    const contractEvidence: TaskEvidence = {
      id: uuidv4(),
      type: 'decision',
      label: '任务契约快照',
      summary: `${task.goal}；验收标准 ${task.acceptanceCriteria.length} 条`,
      source: `task:${task.id}`,
      result: '字段校验通过',
      createdAt: now(),
    };
    task.evidence.unshift(contractEvidence);
    contractGate.result = 'pass';
    contractGate.evidenceIds = [contractEvidence.id];
    contractGate.updatedAt = now();
  }
  const previous = task.status;
  task.status = 'running';
  task.currentNode = task.kind === 'design' ? '来源追踪' : task.kind === 'diagnosis' || task.kind === 'bug' ? '现象与证据' : '实现';
  task.startedAt ||= now();
  task.events.unshift(event('status_changed', `${previous} → running`));
  return writeTask(task);
}

export function setTaskAutomationState(
  projectId: string,
  taskId: string,
  status: Extract<DevelopmentTaskStatus, 'running' | 'rework' | 'blocked' | 'needs_confirmation'>,
  currentNode: string,
  message: string,
): DevelopmentTask {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (['accepted', 'archived', 'awaiting_acceptance'].includes(task.status)) {
    throw new Error('当前任务状态不能由自动执行器修改');
  }
  const previous = task.status;
  task.status = status;
  task.currentNode = currentNode;
  task.events.unshift(event('status_changed', `${previous} → ${status}：${message}`));
  return writeTask(task);
}

export function addEvidence(projectId: string, taskId: string, input: Omit<TaskEvidence, 'id' | 'createdAt'>): DevelopmentTask {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (task.status === 'accepted' || task.status === 'archived') throw new Error('已验收或已归档任务不能添加证据');
  const label = String(input.label || '').trim();
  const summary = String(input.summary || '').trim();
  if (!label || !summary) throw new Error('证据名称和摘要不能为空');
  const evidence: TaskEvidence = {
    id: uuidv4(),
    type: input.type,
    label,
    summary,
    source: input.source ? String(input.source).trim() : undefined,
    result: input.result ? String(input.result).trim() : undefined,
    createdAt: now(),
  };
  task.evidence.unshift(evidence);
  task.events.unshift(event('evidence_added', `新增证据：${label}`));
  return writeTask(task);
}

export function evaluateGate(projectId: string, taskId: string, gateId: string, result: GateResult, evidenceIds: string[], note?: string): DevelopmentTask {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (['awaiting_acceptance', 'accepted', 'archived'].includes(task.status)) throw new Error('已提交验收、已验收或已归档任务不能重评门禁');
  const taskGate = task.gates.find(item => item.id === gateId);
  if (!taskGate) throw new Error('门禁不存在');
  const validEvidenceIds = cleanLines(evidenceIds).filter(id => task.evidence.some(item => item.id === id));
  if (result === 'pass' && validEvidenceIds.length === 0) throw new Error('门禁通过必须关联至少一条当前任务证据');
  taskGate.result = result;
  taskGate.evidenceIds = validEvidenceIds;
  taskGate.note = note ? String(note).trim() : undefined;
  taskGate.updatedAt = now();
  if (result === 'fail') {
    task.status = 'rework';
    task.currentNode = taskGate.onFail;
  } else if (result === 'blocked') {
    task.status = 'blocked';
    task.currentNode = taskGate.onFail;
  } else if (task.status === 'rework' || task.status === 'blocked') {
    task.status = 'running';
  }
  task.events.unshift(event('gate_evaluated', `${taskGate.claim}：${result}`));
  return writeTask(task);
}

export function openDecision(projectId: string, taskId: string, question: string): DevelopmentTask {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (task.status === 'accepted' || task.status === 'archived') throw new Error('已验收或已归档任务不能新增决策');
  const text = String(question || '').trim();
  if (!text) throw new Error('待确认问题不能为空');
  task.decisions.unshift({ id: uuidv4(), question: text, status: 'open', createdAt: now() });
  task.status = 'needs_confirmation';
  task.currentNode = '人工确认';
  task.events.unshift(event('decision_opened', `等待确认：${text}`));
  return writeTask(task);
}

export function resolveDecision(projectId: string, taskId: string, decisionId: string, resolution: string): DevelopmentTask {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (task.status === 'accepted' || task.status === 'archived') throw new Error('已验收或已归档任务不能修改决策');
  const decision = task.decisions.find(item => item.id === decisionId);
  if (!decision) throw new Error('待确认事项不存在');
  const text = String(resolution || '').trim();
  if (!text) throw new Error('确认结论不能为空');
  decision.status = 'resolved';
  decision.resolution = text;
  decision.resolvedAt = now();
  task.evidence.unshift({
    id: uuidv4(),
    type: 'decision',
    label: `决策：${decision.question}`,
    summary: text,
    source: `decision:${decision.id}`,
    result: '已确认',
    createdAt: now(),
  });
  task.status = task.decisions.some(item => item.status === 'open') ? 'needs_confirmation' : 'running';
  task.currentNode = task.status === 'running' ? '继续执行' : '人工确认';
  task.events.unshift(event('decision_resolved', `已确认：${decision.question}`));
  return writeTask(task);
}

export function submitTask(projectId: string, taskId: string): DevelopmentTask {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (!['running', 'rework'].includes(task.status)) throw new Error('只有执行中或返工中的任务可以提交验收');
  if (task.decisions.some(item => item.status === 'open')) throw new Error('仍有未确认决策');
  const failed = task.gates.filter(item => item.required && !['pass', 'not_applicable'].includes(item.result));
  if (failed.length > 0) throw new Error(`仍有 ${failed.length} 个必需门禁未通过`);
  task.status = 'awaiting_acceptance';
  task.currentNode = '人工验收';
  task.submittedAt = now();
  task.events.unshift(event('status_changed', '任务已提交验收'));
  return writeTask(task);
}

export function acceptTask(projectId: string, taskId: string, summary: string): DevelopmentTask {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (task.status !== 'awaiting_acceptance') throw new Error('任务尚未进入待验收状态');
  const text = String(summary || '').trim();
  if (!text) throw new Error('验收结论不能为空');
  task.evidence.unshift({
    id: uuidv4(),
    type: 'acceptance',
    label: '人工验收结论',
    summary: text,
    result: 'ACCEPTED',
    createdAt: now(),
  });
  task.status = 'accepted';
  task.currentNode = '已完成';
  task.acceptedAt = now();
  task.events.unshift(event('status_changed', '任务已验收完成'));
  return writeTask(task);
}

export function archiveTask(projectId: string, taskId: string): DevelopmentTask {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  task.status = 'archived';
  task.currentNode = '已归档';
  task.archivedAt = now();
  task.events.unshift(event('status_changed', '任务已归档，数据和证据保留'));
  return writeTask(task);
}

export function taskOverview(projectId?: string) {
  const tasks = listTasks(projectId);
  const counts: Record<string, number> = {};
  for (const task of tasks) counts[task.status] = (counts[task.status] || 0) + 1;
  return {
    total: tasks.length,
    active: tasks.filter(task => ['running', 'rework', 'blocked', 'needs_confirmation'].includes(task.status)).length,
    awaitingAcceptance: counts.awaiting_acceptance || 0,
    accepted: counts.accepted || 0,
    blocked: (counts.blocked || 0) + (counts.needs_confirmation || 0),
    counts,
  };
}

export function listEvidence(projectId?: string) {
  return listTasks(projectId).flatMap(task => task.evidence.map(item => ({
    ...item,
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.projectId,
    taskStatus: task.status,
  }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function buildTaskExecutionPrompt(projectId: string, taskId: string) {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (task.status === 'draft') throw new Error('请先启动任务，再生成执行指令');
  if (task.status === 'accepted' || task.status === 'archived') throw new Error('已验收或已归档任务不需要继续执行');
  const project = getProjectById(projectId);
  if (!project) throw new Error('项目不存在');
  const pendingGates = task.gates.filter(item => item.required && !['pass', 'not_applicable'].includes(item.result));
  const apiBase = 'http://127.0.0.1:3100/api';
  const prompt = [
    '你现在负责执行一项证据驱动的研发任务。不要把文档数量、构建成功或自我总结单独当成完成。',
    '',
    `任务编号：${task.id}`,
    `项目编号：${task.projectId}`,
    `建议工作目录：${project.sourcePath || '未配置，请先确认项目源码路径'}`,
    `当前状态：${task.status}`,
    `当前节点：${task.currentNode}`,
    '',
    '## 原始需求',
    task.requirement,
    '',
    '## 本轮目标',
    task.goal,
    '',
    '## 允许范围',
    task.scope || '以目标和验收标准为边界，不扩大修改范围。',
    '',
    '## 不做范围',
    task.outOfScope || '未单独声明；发现相邻问题时单独报告，不顺手扩展。',
    '',
    '## 验收标准',
    ...task.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 本轮尚未通过的动态门禁',
    ...(pendingGates.length ? pendingGates.map(item => `- [${item.id}] ${item.claim}\n  方法：${item.method}\n  失败返回：${item.onFail}`) : ['- 当前必需门禁均已通过；请检查是否正在等待人工验收。']),
    '',
    '## 执行纪律',
    '1. 先读取真实代码、配置和原始材料，再决定修改；不要根据页面或清单倒推业务事实。',
    '2. 修改严格限制在本轮范围，保留用户或同事已有的未提交改动。',
    '3. 每个关键结论记录当前机器实际运行的命令、请求、查询、截图或文件路径。',
    '4. 门禁失败时记录失败证据并返回对应节点；需要业务拍板时停止并提出具体问题。',
    '5. 你可以记录执行证据和评估技术门禁，但不得调用 accept 接口代替人工验收。',
    '',
    '## 证据回写接口',
    `新增证据：POST ${apiBase}/tasks/${task.id}/evidence`,
    `请求体示例：{"projectId":"${task.projectId}","type":"command","label":"构建","summary":"实际事实","source":"执行命令或入口","result":"exit 0"}`,
    `评估门禁：POST ${apiBase}/tasks/${task.id}/gates/{gateId}/evaluate`,
    `请求体示例：{"projectId":"${task.projectId}","result":"pass","evidenceIds":["先前返回的证据ID"],"note":"证据为何支持该结论"}`,
    '',
    '完成时返回：修改范围、逐条验收结果、证据清单、失败与回退、未证明能力、是否可以提交人工验收。',
  ].join('\n');
  return { prompt, cwd: project.sourcePath || '', taskId: task.id, projectId: task.projectId };
}
