import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import {
  addEvidence,
  evaluateGate,
  getTask,
  openDecision,
  setTaskAutomationState,
  startTask,
  type EvidenceType,
  type GateResult,
  type TaskEvidence,
} from './task-store.js';
import { getProjectById } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.resolve(__dirname, '../../data/projects');

export type GraphStatus = 'planned' | 'running' | 'waiting_human' | 'completed' | 'failed' | 'stopped';
export type GraphNodeStatus = 'pending' | 'runnable' | 'running' | 'waiting_human' | 'completed' | 'failed' | 'skipped';
export type GraphNodeKind = 'discovery' | 'design' | 'implementation' | 'verification' | 'review' | 'handoff';

export interface GraphNodeEvidence {
  id: string;
  taskEvidenceId: string;
  type: EvidenceType;
  label: string;
  summary: string;
  source?: string;
  result?: string;
  createdAt: string;
}

export interface TaskGraphNode {
  id: string;
  name: string;
  kind: GraphNodeKind;
  agentRole: string;
  instructions: string;
  dependsOn: string[];
  status: GraphNodeStatus;
  workerId?: string;
  leaseUntil?: string;
  retryCount: number;
  maxRetries: number;
  evidence: GraphNodeEvidence[];
  summary?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface GraphWorkerState {
  status: 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'stopped';
  threadId?: string;
  turnId?: string;
  pid?: number;
  message?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface TaskGraphEvent {
  id: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface TaskGraph {
  id: string;
  taskId: string;
  projectId: string;
  status: GraphStatus;
  plannerVersion: string;
  nodes: TaskGraphNode[];
  worker: GraphWorkerState;
  events: TaskGraphEvent[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AddGraphNodeInput {
  id?: string;
  name: string;
  kind: GraphNodeKind;
  agentRole: string;
  instructions: string;
  dependsOn?: string[];
  maxRetries?: number;
}

function now(): string {
  return new Date().toISOString();
}

function assertSafeId(value: string, field: string): void {
  if (!value || !/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`${field} 非法`);
}

function graphFile(projectId: string, taskId: string): string {
  assertSafeId(projectId, 'projectId');
  assertSafeId(taskId, 'taskId');
  return path.join(PROJECTS_DIR, projectId, 'tasks', taskId, 'graph.json');
}

function graphEvent(type: string, message: string): TaskGraphEvent {
  return { id: uuidv4(), type, message, createdAt: now() };
}

function node(input: AddGraphNodeInput): TaskGraphNode {
  const timestamp = now();
  return {
    id: input.id || uuidv4(),
    name: input.name,
    kind: input.kind,
    agentRole: input.agentRole,
    instructions: input.instructions,
    dependsOn: input.dependsOn || [],
    status: 'pending',
    retryCount: 0,
    maxRetries: Math.max(0, Math.min(input.maxRetries ?? 2, 5)),
    evidence: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function textIncludes(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some(pattern => lower.includes(pattern.toLowerCase()));
}

function planNodes(projectId: string, taskId: string): TaskGraphNode[] {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  const text = [task.requirement, task.goal, task.scope, ...task.acceptanceCriteria].join('\n');

  if (task.kind === 'research') {
    return [
      node({ id: 'source-research', name: '原始资料与现状研究', kind: 'discovery', agentRole: 'researcher', instructions: '读取原始资料、代码和当前状态，区分事实、推断与缺口。' }),
      node({ id: 'code-research', name: '代码与能力审计', kind: 'discovery', agentRole: 'code-explorer', instructions: '追踪真实代码、配置和可运行能力，记录证据路径。' }),
      node({ id: 'synthesis', name: '研究汇总', kind: 'design', agentRole: 'synthesizer', instructions: '合并前序证据，消除冲突，形成可执行结论。', dependsOn: ['source-research', 'code-research'] }),
      node({ id: 'review', name: '证据审查', kind: 'review', agentRole: 'reviewer', instructions: '检查关键结论是否均有证据，标记未证明能力。', dependsOn: ['synthesis'] }),
    ];
  }

  if (task.kind === 'diagnosis' || task.kind === 'bug') {
    return [
      node({ id: 'reproduce', name: '复现与基线', kind: 'discovery', agentRole: 'diagnostician', instructions: '复现或精确界定原始现象，保存最小基线证据。' }),
      node({ id: 'trace-code', name: '代码与调用链追踪', kind: 'discovery', agentRole: 'code-explorer', instructions: '从真实入口追踪前后端、配置和请求路径。', dependsOn: ['reproduce'] }),
      node({ id: 'trace-data', name: '数据与运行态追踪', kind: 'discovery', agentRole: 'data-investigator', instructions: '核对接口、日志和数据层事实；不可访问时明确记录限制。', dependsOn: ['reproduce'] }),
      node({ id: 'root-cause', name: '根因收敛', kind: 'design', agentRole: 'diagnostician', instructions: '用跨层证据收敛根因和最小修复范围。', dependsOn: ['trace-code', 'trace-data'] }),
      node({ id: 'implementation', name: task.kind === 'bug' ? '最小修复' : '诊断建议', kind: task.kind === 'bug' ? 'implementation' : 'design', agentRole: task.kind === 'bug' ? 'implementer' : 'architect', instructions: task.kind === 'bug' ? '实现命中根因的最小修改，不扩展相邻范围。' : '形成与已证实根因一致的建议和影响边界。', dependsOn: ['root-cause'] }),
      node({ id: 'verification', name: '回归验证', kind: 'verification', agentRole: 'tester', instructions: '复测原始现象和必要回归，记录命令、请求或浏览器证据。', dependsOn: ['implementation'] }),
      node({ id: 'review', name: '独立审查', kind: 'review', agentRole: 'reviewer', instructions: '审查根因、修改范围、回归证据和未覆盖风险。', dependsOn: ['verification'] }),
    ];
  }

  if (task.kind === 'design') {
    return [
      node({ id: 'source-trace', name: '原始材料追踪', kind: 'discovery', agentRole: 'researcher', instructions: '读取原始材料、历史决策和真实代码，不从现有页面倒推业务。' }),
      node({ id: 'model-audit', name: '业务与数据模型审计', kind: 'discovery', agentRole: 'domain-analyst', instructions: '核对业务对象、状态、权限、审计和数据生命周期。' }),
      node({ id: 'design', name: '设计收敛', kind: 'design', agentRole: 'architect', instructions: '基于前序证据形成边界明确、可交付的设计。', dependsOn: ['source-trace', 'model-audit'] }),
      node({ id: 'review', name: '设计审查', kind: 'review', agentRole: 'reviewer', instructions: '检查语义一致性、高影响边界和验收可观察性。', dependsOn: ['design'] }),
    ];
  }

  const discovery = [
    node({ id: 'code-discovery', name: '代码与项目基线', kind: 'discovery', agentRole: 'code-explorer', instructions: '读取真实代码、配置、工作区状态和现有实现，确定修改命中点。' }),
    node({ id: 'requirement-analysis', name: '需求与验收分析', kind: 'discovery', agentRole: 'requirement-analyst', instructions: '核对任务契约、业务语义、风险和验收标准，列出不做范围。' }),
  ];
  const design = node({ id: 'implementation-plan', name: '实施图收敛', kind: 'design', agentRole: 'architect', instructions: '汇总发现，确定最小实现、并行工作和验证方法。', dependsOn: discovery.map(item => item.id) });
  const implementationNodes: TaskGraphNode[] = [];
  if (textIncludes(text, ['前端', '页面', '界面', 'ui', 'vue', 'react', '浏览器'])) {
    implementationNodes.push(node({ id: 'frontend-implementation', name: '前端实现', kind: 'implementation', agentRole: 'frontend-engineer', instructions: '实现前端范围并覆盖加载、空态、错误态和关键交互。', dependsOn: [design.id] }));
  }
  if (textIncludes(text, ['后端', '接口', 'api', '服务', 'java', 'node', 'express'])) {
    implementationNodes.push(node({ id: 'backend-implementation', name: '后端实现', kind: 'implementation', agentRole: 'backend-engineer', instructions: '实现后端领域逻辑、状态约束和接口，遵守项目 HTTP 约束。', dependsOn: [design.id] }));
  }
  if (textIncludes(text, ['数据', '数据库', 'sql', '表', '字段', '迁移'])) {
    implementationNodes.push(node({ id: 'data-implementation', name: '数据与迁移实现', kind: 'implementation', agentRole: 'data-engineer', instructions: '实现数据、查询或迁移范围，保留幂等、历史和回退边界。', dependsOn: [design.id] }));
  }
  if (implementationNodes.length === 0) {
    implementationNodes.push(node({ id: 'implementation', name: '代码实现', kind: 'implementation', agentRole: 'implementer', instructions: '按任务契约实现最小完整增量，保留既有未提交改动。', dependsOn: [design.id] }));
  }
  const verification = node({ id: 'verification', name: '构建与自动化验证', kind: 'verification', agentRole: 'tester', instructions: '执行相关构建、测试、请求或查询，失败时回写事实。', dependsOn: implementationNodes.map(item => item.id) });
  const runtime = node({ id: 'runtime-verification', name: '真实入口验证', kind: 'verification', agentRole: 'runtime-tester', instructions: '验证真实接口、页面或运行入口，包括关键异常态。', dependsOn: [verification.id] });
  const review = node({ id: 'review', name: '独立交叉审查', kind: 'review', agentRole: 'reviewer', instructions: '审查任务契约覆盖、证据、失败回退、权限和未证明能力。', dependsOn: [runtime.id] });
  return [...discovery, design, ...implementationNodes, verification, runtime, review];
}

function refreshGraph(graph: TaskGraph): TaskGraph {
  for (const item of graph.nodes) {
    if (item.status !== 'pending') continue;
    const dependencies = item.dependsOn.map(id => graph.nodes.find(candidate => candidate.id === id));
    if (dependencies.every(dep => dep && ['completed', 'skipped'].includes(dep.status))) {
      item.status = 'runnable';
      item.updatedAt = now();
    }
  }
  const active = graph.nodes.some(item => ['running', 'runnable'].includes(item.status));
  const pending = graph.nodes.some(item => item.status === 'pending');
  const waiting = graph.nodes.some(item => item.status === 'waiting_human');
  const terminal = graph.nodes.every(item => ['completed', 'skipped'].includes(item.status));
  if (graph.status !== 'stopped') {
    if (terminal && graph.nodes.length > 0) {
      graph.status = 'completed';
      graph.completedAt ||= now();
    } else if (waiting) {
      graph.status = 'waiting_human';
    } else if (!active && !pending && graph.nodes.some(item => item.status === 'failed')) {
      graph.status = 'failed';
    } else if (graph.startedAt) {
      graph.status = 'running';
    }
  }
  graph.updatedAt = now();
  return graph;
}

function writeGraph(graph: TaskGraph): TaskGraph {
  refreshGraph(graph);
  const file = graphFile(graph.projectId, graph.taskId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(graph, null, 2), 'utf-8');
  return graph;
}

export function getTaskGraph(projectId: string, taskId: string): TaskGraph | null {
  const file = graphFile(projectId, taskId);
  if (!fs.existsSync(file)) return null;
  try {
    return refreshGraph(JSON.parse(fs.readFileSync(file, 'utf-8')) as TaskGraph);
  } catch {
    return null;
  }
}

export function createTaskGraph(projectId: string, taskId: string, replace = false): TaskGraph {
  const task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (['accepted', 'archived', 'awaiting_acceptance'].includes(task.status)) throw new Error('当前任务状态不能创建执行图');
  const existing = getTaskGraph(projectId, taskId);
  if (existing && !replace) return existing;
  const timestamp = now();
  const graph: TaskGraph = {
    id: uuidv4(),
    taskId,
    projectId,
    status: 'planned',
    plannerVersion: 'dynamic-graph-v1',
    nodes: planNodes(projectId, taskId),
    worker: { status: 'idle' },
    events: [graphEvent('created', '动态执行图已根据任务契约生成')],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return writeGraph(graph);
}

export function startTaskGraph(projectId: string, taskId: string): TaskGraph {
  let task = getTask(projectId, taskId);
  if (!task) throw new Error('任务不存在');
  if (task.status === 'draft') task = startTask(projectId, taskId);
  if (['accepted', 'archived', 'awaiting_acceptance'].includes(task.status)) throw new Error('当前任务状态不能启动自动研发');
  const graph = createTaskGraph(projectId, taskId);
  graph.status = 'running';
  graph.startedAt ||= now();
  graph.events.unshift(graphEvent('started', '自动研发 Graph 已启动'));
  setTaskAutomationState(projectId, taskId, 'running', '自动研发 Graph', '等待 Codex Worker 领取节点');
  return writeGraph(graph);
}

export function claimRunnableNode(projectId: string, taskId: string, workerId: string, preferredNodeId?: string): { graph: TaskGraph; node: TaskGraphNode | null } {
  const graph = getTaskGraph(projectId, taskId);
  if (!graph) throw new Error('执行图不存在');
  if (graph.status === 'stopped') throw new Error('执行图已停止');
  const candidates = graph.nodes.filter(item => item.status === 'runnable');
  const selected = preferredNodeId ? candidates.find(item => item.id === preferredNodeId) : candidates[0];
  if (!selected) return { graph, node: null };
  selected.status = 'running';
  selected.workerId = String(workerId || 'codex-supervisor').trim();
  selected.startedAt ||= now();
  selected.leaseUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  selected.updatedAt = now();
  graph.events.unshift(graphEvent('node_claimed', `${selected.name} 已由 ${selected.workerId} 领取`));
  setTaskAutomationState(projectId, taskId, 'running', selected.name, `Graph 节点 ${selected.id} 执行中`);
  return { graph: writeGraph(graph), node: selected };
}

export function getNodeContext(projectId: string, taskId: string, nodeId: string) {
  const graph = getTaskGraph(projectId, taskId);
  const task = getTask(projectId, taskId);
  const project = getProjectById(projectId);
  if (!graph || !task || !project) throw new Error('任务、执行图或项目不存在');
  const graphNode = graph.nodes.find(item => item.id === nodeId);
  if (!graphNode) throw new Error('节点不存在');
  const dependencies = graphNode.dependsOn.map(id => graph.nodes.find(item => item.id === id)).filter(Boolean);
  return {
    task: {
      id: task.id,
      title: task.title,
      kind: task.kind,
      requirement: task.requirement,
      goal: task.goal,
      scope: task.scope,
      outOfScope: task.outOfScope,
      acceptanceCriteria: task.acceptanceCriteria,
      risks: task.risks,
    },
    project: { id: project.id, name: project.name, sourcePath: project.sourcePath || '' },
    node: graphNode,
    dependencies,
    pendingGates: task.gates.filter(item => item.required && !['pass', 'not_applicable'].includes(item.result)),
  };
}

export function appendNodeEvidence(projectId: string, taskId: string, nodeId: string, input: Omit<TaskEvidence, 'id' | 'createdAt'>): { graph: TaskGraph; evidence: GraphNodeEvidence } {
  const graph = getTaskGraph(projectId, taskId);
  if (!graph) throw new Error('执行图不存在');
  const graphNode = graph.nodes.find(item => item.id === nodeId);
  if (!graphNode) throw new Error('节点不存在');
  if (!['running', 'waiting_human'].includes(graphNode.status)) throw new Error('只有执行中的节点可以追加证据');
  const task = addEvidence(projectId, taskId, input);
  const taskEvidence = task.evidence[0];
  const evidence: GraphNodeEvidence = {
    id: uuidv4(),
    taskEvidenceId: taskEvidence.id,
    type: taskEvidence.type,
    label: taskEvidence.label,
    summary: taskEvidence.summary,
    source: taskEvidence.source,
    result: taskEvidence.result,
    createdAt: taskEvidence.createdAt,
  };
  graphNode.evidence.unshift(evidence);
  graphNode.updatedAt = now();
  graph.events.unshift(graphEvent('node_evidence', `${graphNode.name} 新增证据：${evidence.label}`));
  return { graph: writeGraph(graph), evidence };
}

export function completeGraphNode(projectId: string, taskId: string, nodeId: string, workerId: string, summary: string): TaskGraph {
  const graph = getTaskGraph(projectId, taskId);
  if (!graph) throw new Error('执行图不存在');
  const graphNode = graph.nodes.find(item => item.id === nodeId);
  if (!graphNode) throw new Error('节点不存在');
  if (graphNode.status !== 'running') throw new Error('节点不在执行中');
  if (graphNode.workerId && graphNode.workerId !== workerId) throw new Error('节点已由其他 Worker 领取');
  const text = String(summary || '').trim();
  if (!text) throw new Error('节点完成摘要不能为空');
  if (graphNode.evidence.length === 0) throw new Error('节点完成前必须至少回写一条证据');
  graphNode.status = 'completed';
  graphNode.summary = text;
  graphNode.completedAt = now();
  graphNode.updatedAt = now();
  delete graphNode.leaseUntil;
  graph.events.unshift(graphEvent('node_completed', `${graphNode.name} 已完成`));
  const saved = writeGraph(graph);
  if (saved.status === 'completed') {
    setTaskAutomationState(projectId, taskId, 'running', '技术执行完成', 'Graph 节点均已完成，等待门禁与人工验收');
  }
  return saved;
}

export function failGraphNode(projectId: string, taskId: string, nodeId: string, workerId: string, error: string, retryable = true): TaskGraph {
  const graph = getTaskGraph(projectId, taskId);
  if (!graph) throw new Error('执行图不存在');
  const graphNode = graph.nodes.find(item => item.id === nodeId);
  if (!graphNode) throw new Error('节点不存在');
  if (graphNode.status !== 'running') throw new Error('节点不在执行中');
  if (graphNode.workerId && graphNode.workerId !== workerId) throw new Error('节点已由其他 Worker 领取');
  graphNode.retryCount += 1;
  graphNode.error = String(error || '未提供失败原因').trim();
  graphNode.status = retryable && graphNode.retryCount <= graphNode.maxRetries ? 'runnable' : 'failed';
  graphNode.updatedAt = now();
  delete graphNode.leaseUntil;
  graph.events.unshift(graphEvent('node_failed', `${graphNode.name} 失败：${graphNode.error}`));
  setTaskAutomationState(projectId, taskId, 'rework', graphNode.name, graphNode.error);
  return writeGraph(graph);
}

export function expandTaskGraph(projectId: string, taskId: string, parentNodeId: string, inputs: AddGraphNodeInput[]): TaskGraph {
  const graph = getTaskGraph(projectId, taskId);
  if (!graph) throw new Error('执行图不存在');
  const parent = graph.nodes.find(item => item.id === parentNodeId);
  if (!parent) throw new Error('父节点不存在');
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('新增节点不能为空');
  for (const input of inputs.slice(0, 8)) {
    const graphNode = node({ ...input, dependsOn: input.dependsOn?.length ? input.dependsOn : [parentNodeId] });
    assertSafeId(graphNode.id, 'nodeId');
    if (graph.nodes.some(item => item.id === graphNode.id)) throw new Error(`节点已存在：${graphNode.id}`);
    for (const dependency of graphNode.dependsOn) {
      if (!graph.nodes.some(item => item.id === dependency)) throw new Error(`依赖节点不存在：${dependency}`);
    }
    graph.nodes.push(graphNode);
  }
  graph.events.unshift(graphEvent('graph_expanded', `${parent.name} 扩展了 ${Math.min(inputs.length, 8)} 个子节点`));
  return writeGraph(graph);
}

export function evaluateGraphGate(projectId: string, taskId: string, gateId: string, result: GateResult, evidenceIds: string[], note?: string) {
  return evaluateGate(projectId, taskId, gateId, result, evidenceIds, note);
}

export function requestGraphDecision(projectId: string, taskId: string, nodeId: string, question: string): { graph: TaskGraph; task: ReturnType<typeof openDecision> } {
  const graph = getTaskGraph(projectId, taskId);
  if (!graph) throw new Error('执行图不存在');
  const graphNode = graph.nodes.find(item => item.id === nodeId);
  if (!graphNode) throw new Error('节点不存在');
  graphNode.status = 'waiting_human';
  graphNode.updatedAt = now();
  const task = openDecision(projectId, taskId, question);
  graph.events.unshift(graphEvent('human_decision', `${graphNode.name} 请求人工确认`));
  return { graph: writeGraph(graph), task };
}

export function updateGraphWorker(projectId: string, taskId: string, updates: Partial<GraphWorkerState>, eventMessage?: string): TaskGraph {
  const graph = getTaskGraph(projectId, taskId);
  if (!graph) throw new Error('执行图不存在');
  graph.worker = { ...graph.worker, ...updates };
  if (eventMessage) graph.events.unshift(graphEvent('worker', eventMessage));
  return writeGraph(graph);
}

export function stopTaskGraph(projectId: string, taskId: string, message = '用户停止自动研发'): TaskGraph {
  const graph = getTaskGraph(projectId, taskId);
  if (!graph) throw new Error('执行图不存在');
  graph.status = 'stopped';
  graph.worker = { ...graph.worker, status: 'stopped', message, endedAt: now() };
  graph.events.unshift(graphEvent('stopped', message));
  return writeGraph(graph);
}
