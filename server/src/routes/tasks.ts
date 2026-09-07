import { Router, type Request, type Response } from 'express';
import {
  acceptTask,
  addEvidence,
  archiveTask,
  buildTaskExecutionPrompt,
  createTask,
  evaluateGate,
  getTask,
  listEvidence,
  listTasks,
  openDecision,
  resolveDecision,
  startTask,
  submitTask,
  taskOverview,
  updateTask,
  type EvidenceType,
  type GateResult,
} from '../services/task-store.js';
import {
  appendNodeEvidence,
  claimRunnableNode,
  completeGraphNode,
  createTaskGraph,
  expandTaskGraph,
  failGraphNode,
  getNodeContext,
  getTaskGraph,
  requestGraphDecision,
  startTaskGraph,
  type GraphNodeKind,
} from '../services/task-graph-store.js';
import { getCodexRunnerStatus, startCodexGraphRunner, stopCodexGraphRunner } from '../services/codex-graph-runner.js';

export const tasksRouter = Router();

function handle(res: Response, action: () => unknown, successStatus = 200): void {
  try {
    res.status(successStatus).json(action());
  } catch (error: any) {
    const message = error?.message || '操作失败';
    const status = message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: message });
  }
}

async function handleAsync(res: Response, action: () => Promise<unknown>, successStatus = 200): Promise<void> {
  try {
    res.status(successStatus).json(await action());
  } catch (error: any) {
    const message = error?.message || '操作失败';
    const status = message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: message });
  }
}

tasksRouter.get('/overview', (req: Request, res: Response) => {
  handle(res, () => taskOverview(req.query.projectId ? String(req.query.projectId) : undefined));
});

tasksRouter.get('/evidence', (req: Request, res: Response) => {
  handle(res, () => listEvidence(req.query.projectId ? String(req.query.projectId) : undefined));
});

tasksRouter.get('/', (req: Request, res: Response) => {
  const includeArchived = req.query.includeArchived === 'true';
  handle(res, () => listTasks(req.query.projectId ? String(req.query.projectId) : undefined, includeArchived));
});

tasksRouter.get('/:id', (req: Request, res: Response) => {
  const projectId = String(req.query.projectId || '');
  handle(res, () => {
    const task = getTask(projectId, req.params.id);
    if (!task) throw new Error('任务不存在');
    return task;
  });
});

tasksRouter.get('/:id/graph', (req: Request, res: Response) => {
  handle(res, () => {
    const graph = getTaskGraph(String(req.query.projectId || ''), req.params.id);
    if (!graph) throw new Error('执行图不存在');
    return graph;
  });
});

tasksRouter.get('/:id/automation/status', (req: Request, res: Response) => {
  handle(res, () => getCodexRunnerStatus(String(req.query.projectId || ''), req.params.id));
});

tasksRouter.post('/:id/graph/plan', (req: Request, res: Response) => {
  handle(res, () => createTaskGraph(String(req.body.projectId || ''), req.params.id, Boolean(req.body.replace)), 201);
});

tasksRouter.post('/:id/automation/start', (req: Request, res: Response) => {
  void handleAsync(res, async () => {
    const projectId = String(req.body.projectId || '');
    startTaskGraph(projectId, req.params.id);
    if (req.body.launchWorker === false) return getTaskGraph(projectId, req.params.id);
    return startCodexGraphRunner(projectId, req.params.id);
  }, 201);
});

tasksRouter.post('/:id/automation/stop', (req: Request, res: Response) => {
  handle(res, () => stopCodexGraphRunner(String(req.body.projectId || ''), req.params.id));
});

tasksRouter.post('/:id/graph/claim', (req: Request, res: Response) => {
  handle(res, () => claimRunnableNode(
    String(req.body.projectId || ''),
    req.params.id,
    String(req.body.workerId || ''),
    req.body.nodeId ? String(req.body.nodeId) : undefined,
  ));
});

tasksRouter.get('/:id/graph/nodes/:nodeId/context', (req: Request, res: Response) => {
  handle(res, () => getNodeContext(String(req.query.projectId || ''), req.params.id, req.params.nodeId));
});

tasksRouter.post('/:id/graph/nodes/:nodeId/evidence', (req: Request, res: Response) => {
  handle(res, () => appendNodeEvidence(String(req.body.projectId || ''), req.params.id, req.params.nodeId, {
    type: req.body.type as EvidenceType,
    label: req.body.label,
    summary: req.body.summary,
    source: req.body.source,
    result: req.body.result,
  }), 201);
});

tasksRouter.post('/:id/graph/nodes/:nodeId/complete', (req: Request, res: Response) => {
  handle(res, () => completeGraphNode(
    String(req.body.projectId || ''),
    req.params.id,
    req.params.nodeId,
    String(req.body.workerId || ''),
    req.body.summary,
  ));
});

tasksRouter.post('/:id/graph/nodes/:nodeId/fail', (req: Request, res: Response) => {
  handle(res, () => failGraphNode(
    String(req.body.projectId || ''),
    req.params.id,
    req.params.nodeId,
    String(req.body.workerId || ''),
    req.body.error,
    req.body.retryable !== false,
  ));
});

tasksRouter.post('/:id/graph/nodes/:nodeId/decision', (req: Request, res: Response) => {
  handle(res, () => requestGraphDecision(
    String(req.body.projectId || ''),
    req.params.id,
    req.params.nodeId,
    req.body.question,
  ), 201);
});

tasksRouter.post('/:id/graph/expand', (req: Request, res: Response) => {
  handle(res, () => expandTaskGraph(
    String(req.body.projectId || ''),
    req.params.id,
    String(req.body.parentNodeId || ''),
    (req.body.nodes || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      kind: item.kind as GraphNodeKind,
      agentRole: item.agentRole,
      instructions: item.instructions,
      dependsOn: item.dependsOn,
      maxRetries: item.maxRetries,
    })),
  ));
});

tasksRouter.post('/:id/execution-prompt', (req: Request, res: Response) => {
  handle(res, () => buildTaskExecutionPrompt(String(req.body.projectId || ''), req.params.id));
});

tasksRouter.post('/', (req: Request, res: Response) => {
  handle(res, () => createTask(req.body), 201);
});

tasksRouter.post('/:id/update', (req: Request, res: Response) => {
  handle(res, () => updateTask(String(req.body.projectId || ''), req.params.id, req.body));
});

tasksRouter.post('/:id/start', (req: Request, res: Response) => {
  handle(res, () => startTask(String(req.body.projectId || ''), req.params.id));
});

tasksRouter.post('/:id/evidence', (req: Request, res: Response) => {
  handle(res, () => addEvidence(String(req.body.projectId || ''), req.params.id, {
    type: req.body.type as EvidenceType,
    label: req.body.label,
    summary: req.body.summary,
    source: req.body.source,
    result: req.body.result,
  }), 201);
});

tasksRouter.post('/:id/gates/:gateId/evaluate', (req: Request, res: Response) => {
  handle(res, () => evaluateGate(
    String(req.body.projectId || ''),
    req.params.id,
    req.params.gateId,
    req.body.result as GateResult,
    req.body.evidenceIds || [],
    req.body.note,
  ));
});

tasksRouter.post('/:id/decisions', (req: Request, res: Response) => {
  handle(res, () => openDecision(String(req.body.projectId || ''), req.params.id, req.body.question), 201);
});

tasksRouter.post('/:id/decisions/:decisionId/resolve', (req: Request, res: Response) => {
  handle(res, () => resolveDecision(String(req.body.projectId || ''), req.params.id, req.params.decisionId, req.body.resolution));
});

tasksRouter.post('/:id/submit', (req: Request, res: Response) => {
  handle(res, () => submitTask(String(req.body.projectId || ''), req.params.id));
});

tasksRouter.post('/:id/accept', (req: Request, res: Response) => {
  handle(res, () => acceptTask(String(req.body.projectId || ''), req.params.id, req.body.summary));
});

tasksRouter.post('/:id/archive', (req: Request, res: Response) => {
  handle(res, () => archiveTask(String(req.body.projectId || ''), req.params.id));
});
