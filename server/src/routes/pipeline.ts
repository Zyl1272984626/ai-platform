/**
 * 开发流水线路由
 *
 * 6 阶段固定流水线：需求分析 → 方案设计 → 代码实现 → 测试验证 → 代码审查 → 提交归档
 * SSE 流式推送模式复用 workflow.ts
 */
import { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';
import {
  getPipelineStageDefinitions,
  startPipeline,
  getPipelineRun,
  listPipelineRuns,
  confirmPipelineStage,
  abortPipeline,
  deletePipelineRun,
  resumePipeline,
  listKnowledgeEntries,
  getAvailableModels,
  generateStagePrompt,
  generateCodexHandoffPrompt,
  generateClaudeCodeHandoffPrompt,
  createPipelineRelayRunId,
  generateRelayContinuationPrompt,
  generateRelayStagePrompt,
  getPipelineRelayPlan,
  listPipelineArtifactRuns,
  registerPipelineRelayRun,
  scanPipelineArtifacts,
} from '../services/pipeline-engine.js';
import { getDeepSeekConfig, updateDeepSeekConfig } from '../services/deepseek-client.js';

export const pipelineRouter = Router();

// 流水线阶段定义
pipelineRouter.get('/', (_req: Request, res: Response) => {
  res.json(getPipelineStageDefinitions());
});

// 多平台接力阶段定义（平台只生成提示词和扫描产物，不调用模型）
pipelineRouter.get('/relay-plan', (req: Request, res: Response) => {
  const baseEngine = req.query.baseEngine === 'claudecode' ? 'claudecode' as const : undefined;
  res.json(getPipelineRelayPlan(req.query.runId ? String(req.query.runId) : undefined, baseEngine));
});

pipelineRouter.post('/relay-run-id', (req: Request, res: Response) => {
  const { requirement, projectId, baseEngine } = req.body || {};
  const runId = createPipelineRelayRunId(requirement || 'pipeline');
  const engine = baseEngine === 'claudecode' ? 'claudecode' as const : undefined;
  registerPipelineRelayRun(runId, requirement, projectId, engine);
  res.json({ runId });
});

// 启动全流水线（SSE）
pipelineRouter.post('/run', (req: Request, res: Response) => {
  const { requirement, projectId } = req.body || {};
  if (!requirement) {
    return res.status(400).json({ error: 'requirement 为必填参数' });
  }

  try {
    const emitter = new EventEmitter();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const run = startPipeline(requirement, projectId, emitter);

    res.write(`data: ${JSON.stringify({ type: 'pipeline:start', runId: run.id, requirement })}\n\n`);

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    const eventTypes = [
      'stage:start', 'stage:done', 'stage:gate',
      'pipeline:done', 'pipeline:failed',
    ];

    for (const type of eventTypes) {
      emitter.on(type, (data: any) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }
      });
    }

    const cleanup = () => {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    };

    emitter.on('pipeline:done', cleanup);
    emitter.on('pipeline:failed', cleanup);
    req.on('close', cleanup);
  } catch (err: unknown) {
    if (!res.headersSent) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
});

// 单独执行某阶段（SSE）
pipelineRouter.post('/run-stage', (req: Request, res: Response) => {
  const { runId, stageId, requirement, projectId } = req.body || {};
  if (!stageId) {
    return res.status(400).json({ error: 'stageId 为必填参数' });
  }

  try {
    const emitter = new EventEmitter();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // 如果有 runId，恢复已有运行到指定阶段；否则创建新运行
    let run;
    if (runId) {
      run = resumePipeline(runId, emitter);
    } else {
      run = startPipeline(requirement || `单阶段执行: ${stageId}`, projectId, emitter);
    }

    res.write(`data: ${JSON.stringify({ type: 'pipeline:start', runId: run.id })}\n\n`);

    const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); }, 15000);

    for (const type of ['stage:start', 'stage:done', 'stage:gate', 'pipeline:done', 'pipeline:failed']) {
      emitter.on(type, (data: any) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      });
    }

    const cleanup = () => { clearInterval(heartbeat); if (!res.writableEnded) res.end(); };
    emitter.on('pipeline:done', cleanup);
    emitter.on('pipeline:failed', cleanup);
    req.on('close', cleanup);
  } catch (err: unknown) {
    if (!res.headersSent) res.status(400).json({ error: (err as Error).message });
  }
});

// 运行历史
pipelineRouter.get('/runs', (_req: Request, res: Response) => {
  res.json(listPipelineRuns());
});

// 单次运行详情
pipelineRouter.get('/runs/:runId', (req: Request, res: Response) => {
  const run = getPipelineRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

// Gate 确认
pipelineRouter.post('/runs/:runId/confirm', (req: Request, res: Response) => {
  try {
    confirmPipelineStage(req.params.runId);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 终止
pipelineRouter.post('/runs/:runId/abort', (req: Request, res: Response) => {
  abortPipeline(req.params.runId);
  res.json({ ok: true });
});

// 删除运行历史（写操作使用 POST，遵守项目约束）
pipelineRouter.post('/runs/:runId/delete', (req: Request, res: Response) => {
  try {
    const ok = deletePipelineRun(req.params.runId);
    if (!ok) return res.status(404).json({ error: 'Run not found' });
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 恢复（SSE）
pipelineRouter.post('/runs/:runId/resume', (req: Request, res: Response) => {
  try {
    const emitter = new EventEmitter();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const run = resumePipeline(req.params.runId, emitter);
    res.write(`data: ${JSON.stringify({ type: 'pipeline:resumed', runId: run.id })}\n\n`);

    for (const type of ['stage:start', 'stage:done', 'stage:gate', 'pipeline:done', 'pipeline:failed']) {
      emitter.on(type, (data: any) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      });
    }

    const cleanup = () => { if (!res.writableEnded) res.end(); };
    emitter.on('pipeline:done', cleanup);
    emitter.on('pipeline:failed', cleanup);
    req.on('close', cleanup);
  } catch (err: unknown) {
    if (!res.headersSent) res.status(400).json({ error: (err as Error).message });
  }
});

// 知识图谱
pipelineRouter.get('/knowledge', (_req: Request, res: Response) => {
  res.json(listKnowledgeEntries());
});

// 生成阶段提示词（用于前端复制）
pipelineRouter.post('/generate-prompt', (req: Request, res: Response) => {
  const { stageId, requirement, projectId, runId, mode, baseEngine } = req.body || {};
  if (!stageId || !requirement) {
    return res.status(400).json({ error: 'stageId 和 requirement 为必填参数' });
  }
  try {
    if (mode === 'relay') {
      const engine = baseEngine === 'claudecode' ? 'claudecode' as const : undefined;
      const result = generateRelayStagePrompt(stageId, requirement, projectId, runId, engine);
      res.json(result);
      return;
    }
    const prompt = generateStagePrompt(stageId, requirement, projectId);
    res.json({ stageId, prompt });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

pipelineRouter.get('/artifacts/:runId', (req: Request, res: Response) => {
  try {
    res.json(scanPipelineArtifacts(req.params.runId));
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

pipelineRouter.get('/artifact-runs', (_req: Request, res: Response) => {
  try {
    res.json(listPipelineArtifactRuns());
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

pipelineRouter.post('/generate-continuation-prompt', (req: Request, res: Response) => {
  const { runId, stageIds, requirement, projectId } = req.body || {};
  if (!runId || !Array.isArray(stageIds) || stageIds.length === 0) {
    return res.status(400).json({ error: 'runId 和 stageIds 为必填参数' });
  }
  try {
    res.json(generateRelayContinuationPrompt(runId, stageIds, requirement, projectId));
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 生成 Codex 主流程交接提示词（用于轻量平台 -> Codex 执行）
pipelineRouter.post('/generate-codex-prompt', (req: Request, res: Response) => {
  const { requirement, projectId, runId } = req.body || {};
  if (!requirement) {
    return res.status(400).json({ error: 'requirement 为必填参数' });
  }
  try {
    const prompt = generateCodexHandoffPrompt(requirement, projectId, runId);
    res.json({ prompt, runId });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 生成 ClaudeCode 主流程交接提示词（用于 Codex 额度用完时切换底座）
pipelineRouter.post('/generate-claudecode-prompt', (req: Request, res: Response) => {
  const { requirement, projectId, runId } = req.body || {};
  if (!requirement) {
    return res.status(400).json({ error: 'requirement 为必填参数' });
  }
  try {
    const prompt = generateClaudeCodeHandoffPrompt(requirement, projectId, runId);
    res.json({ prompt, runId });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 获取可用模型列表
pipelineRouter.get('/models', (_req: Request, res: Response) => {
  const models = getAvailableModels();
  const deepseekConfig = getDeepSeekConfig();
  res.json({
    models,
    config: {
      deepseek: {
        configured: !!deepseekConfig.apiKey,
        baseUrl: deepseekConfig.baseUrl,
        model: deepseekConfig.model,
      },
    },
  });
});

// 更新 DeepSeek 模型配置
pipelineRouter.post('/model-config', (req: Request, res: Response) => {
  const { apiKey, baseUrl, model } = req.body || {};
  try {
    const updates: Record<string, string> = {};
    if (apiKey !== undefined) updates.apiKey = apiKey;
    if (baseUrl !== undefined) updates.baseUrl = baseUrl;
    if (model !== undefined) updates.model = model;
    const newConfig = updateDeepSeekConfig(updates);
    res.json({
      ok: true,
      config: {
        baseUrl: newConfig.baseUrl,
        model: newConfig.model,
        configured: !!newConfig.apiKey,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});
