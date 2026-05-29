/**
 * 工作流路由（v2）
 *
 * 新增：resume（断点恢复）、abort（中止）、confirm（确认继续）
 */
import { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';
import {
  loadWorkflowDefinitions,
  startWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  resumeWorkflow,
  confirmStep,
  abortWorkflow,
} from '../services/workflow-engine.js';

export const workflowRouter = Router();

// 工作流模板列表
workflowRouter.get('/', (_req: Request, res: Response) => {
  const definitions = loadWorkflowDefinitions();
  res.json(definitions.map((d) => ({
    name: d.name,
    description: d.description,
    trigger: d.trigger,
    stepCount: d.steps.length,
  })));
});

// 触发执行
workflowRouter.post('/:name/run', (req: Request, res: Response) => {
  const { name } = req.params;
  const params = req.body || {};

  try {
    const emitter = new EventEmitter();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const run = startWorkflow(name, params, emitter);

    // 推送初始状态
    res.write(`data: ${JSON.stringify({ type: 'workflow:start', runId: run.id })}\n\n`);

    // 心跳（保持连接）
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    const eventTypes = [
      'step:start', 'step:stream', 'step:done',
      'step:retry', 'step:skip', 'step:waiting',
      'workflow:done', 'workflow:failed', 'workflow:error',
    ];

    for (const type of eventTypes) {
      emitter.on(type, (data: any) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      });
    }

    const cleanup = () => {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    };

    emitter.on('workflow:done', cleanup);
    emitter.on('workflow:failed', cleanup);
    emitter.on('workflow:error', cleanup);
    req.on('close', cleanup);
  } catch (err: unknown) {
    if (!res.headersSent) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
});

// 运行历史
workflowRouter.get('/runs', (_req: Request, res: Response) => {
  res.json(listWorkflowRuns());
});

// 单次运行详情
workflowRouter.get('/runs/:runId', (req: Request, res: Response) => {
  const run = getWorkflowRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

// 断点恢复
workflowRouter.post('/runs/:runId/resume', (req: Request, res: Response) => {
  try {
    const emitter = new EventEmitter();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const run = resumeWorkflow(req.params.runId, emitter);

    res.write(`data: ${JSON.stringify({ type: 'workflow:resumed', runId: run.id })}\n\n`);

    emitter.on('step:start', (data) => res.write(`data: ${JSON.stringify({ type: 'step:start', ...data })}\n\n`));
    emitter.on('step:done', (data) => res.write(`data: ${JSON.stringify({ type: 'step:done', ...data })}\n\n`));
    emitter.on('workflow:done', (data) => { res.write(`data: ${JSON.stringify({ type: 'workflow:done', ...data })}\n\n`); res.end(); });
    emitter.on('workflow:failed', (data) => { res.write(`data: ${JSON.stringify({ type: 'workflow:failed', ...data })}\n\n`); res.end(); });
  } catch (err: unknown) {
    if (!res.headersSent) res.status(400).json({ error: (err as Error).message });
  }
});

// 确认继续
workflowRouter.post('/runs/:runId/confirm', (req: Request, res: Response) => {
  try {
    confirmStep(req.params.runId);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 中止
workflowRouter.post('/runs/:runId/abort', (req: Request, res: Response) => {
  abortWorkflow(req.params.runId);
  res.json({ ok: true });
});
