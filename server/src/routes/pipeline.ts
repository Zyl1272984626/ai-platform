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
  generateDeliveryReport,
  createPipelineRelayRunId,
  generateRelayContinuationPrompt,
  generateRelayStagePrompt,
  getPipelineRelayPlan,
  listPipelineArtifactRuns,
  registerPipelineRelayRun,
  scanPipelineArtifacts,
  updateRelayStageMark,
  deleteRelayArtifact,
  deleteRelayRun,
  readRelayStageContent,
  exportRelayStageAsSkill,
} from '../services/pipeline-engine.js';
import { getDeepSeekConfig, updateDeepSeekConfig } from '../services/deepseek-client.js';
import {
  executeRelayStageWithDeepSeek,
  getExecutorConfig,
  updateExecutorConfig,
} from '../services/relay-executor.js';
import {
  listTraceEvents,
  listTraceRuns,
  traceExecutorCalled,
  traceFinalDecision,
} from '../services/pipeline-trace.js';
import {
  syncRelayContext,
  readRelayContext,
  buildRelaySnapshot,
} from '../services/relay-context.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const pipelineRouter = Router();

/** 统一的引擎白名单校验：接受 codex/claudecode/zcode，其他 fallback zcode */
function normalizeEngine(value: unknown): 'codex' | 'claudecode' | 'zcode' | undefined {
  if (value === 'codex' || value === 'claudecode' || value === 'zcode') return value;
  return undefined;
}

// relay-dev Skill 内容（与 ~/.zcode/skills/relay-dev/SKILL.md 一致，供一键安装）
const RELAY_DEV_SKILL_CONTENT = `---
name: relay-dev
description: 启动多平台接力开发流程。仅当用户明确说"启动接力任务"、"用接力流程做"、"走接力流程"时触发。通过 MCP 调用 ai-platform 平台创建任务、拆分阶段、记录产物、推进质量门。普通开发需求不要触发。
metadata:
  short-description: 用 MCP 调 ai-platform 走接力开发流程
---

# 接力开发流程（Relay Dev）

当用户说"启动接力任务做 XX"时调用本流程。通过 \`ai-platform-relay\` MCP server 管理任务的阶段、产物和质量门。

## 前置条件
- ai-platform-relay MCP 已配置（~/.zcode/cli/config.json 的 mcp.servers）
- ai-platform 后端在跑（localhost:3100）

如果 MCP 工具不可用，告诉用户去 /pipelines 页面点 MCP 配置查看。

## 流程
1. **创建任务**：调 \`create_relay_task(requirement, baseEngine)\`，记住返回的 runId
2. **第一阶段**：按返回的 masterPrompt 追问需求（不直接写代码），写入第1阶段产物
3. **每阶段循环**：调 \`get_relay_task(runId)\` 拿当前阶段→读必读前序产物→干活→写产物→\`scan_artifacts\` 确认→\`mark_stage(runId, stageId, "accepted")\` 推进
4. **暂停审核**：需求不清、设计完成、改多文件、提交推送时，必须暂停问用户

## 原则
- 该停就停，不假装自动化
- 产物优先：每阶段必写产物文件
- 读前序产物作为输入依据
- 不碰全局 AGENTS.md
- 多任务用不同 runId 隔离
`;

// 流水线阶段定义
pipelineRouter.get('/', (_req: Request, res: Response) => {
  res.json(getPipelineStageDefinitions());
});

// 多平台接力阶段定义（平台只生成提示词和扫描产物，不调用模型）
pipelineRouter.get('/relay-plan', (req: Request, res: Response) => {
  const baseEngine = normalizeEngine(req.query.baseEngine);
  res.json(getPipelineRelayPlan(req.query.runId ? String(req.query.runId) : undefined, baseEngine));
});

pipelineRouter.post('/relay-run-id', (req: Request, res: Response) => {
  const { requirement, projectId, baseEngine } = req.body || {};
  const runId = createPipelineRelayRunId(requirement || 'pipeline');
  const engine = normalizeEngine(baseEngine) || 'zcode';
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
      const engine = normalizeEngine(baseEngine);
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

pipelineRouter.post('/artifacts/:runId/stage-mark', (req: Request, res: Response) => {
  const { stageId, mark } = req.body || {};
  if (!stageId || !['working', 'rework', 'accepted', 'skipped'].includes(mark)) {
    return res.status(400).json({ error: 'stageId 和 mark 为必填参数' });
  }
  try {
    res.json(updateRelayStageMark(req.params.runId, stageId, mark));
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 删除单个阶段产物（写操作使用 POST + /delete 后缀，遵守项目约束）
pipelineRouter.post('/artifacts/:runId/stages/:stageId/delete', (req: Request, res: Response) => {
  try {
    const ok = deleteRelayArtifact(req.params.runId, req.params.stageId);
    if (!ok) return res.status(404).json({ error: '阶段产物文件不存在' });
    res.json({ ok: true, runId: req.params.runId, stageId: req.params.stageId });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 删除整条接力 run（产物 + manifest）
pipelineRouter.post('/artifacts/:runId/delete', (req: Request, res: Response) => {
  try {
    const result = deleteRelayRun(req.params.runId);
    res.json({ ok: true, runId: req.params.runId, removedFiles: result.removedFiles });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 读取单个阶段产物的完整内容（用于前端 Markdown 预览，参考 GET /skill/:name 的 content 约定）
pipelineRouter.get('/artifacts/:runId/stages/:stageId/content', (req: Request, res: Response) => {
  try {
    const result = readRelayStageContent(req.params.runId, req.params.stageId);
    if (!result.exists) return res.status(404).json({ error: '阶段产物文件不存在' });
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 导出单个 relay 阶段为 SKILL.md 内容（不写本地文件，平台独立于本地 Skill 路径）
pipelineRouter.post('/relay-stage-skill', (req: Request, res: Response) => {
  const { stageId, baseEngine } = req.body || {};
  if (!stageId) {
    return res.status(400).json({ error: 'stageId 为必填参数' });
  }
  try {
    const engine = normalizeEngine(baseEngine);
    res.json(exportRelayStageAsSkill(stageId, engine));
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ========== 接力上下文（每个 run 独立 CONTEXT.md，多任务隔离） ==========

// 生成 CONTEXT.md 到产物目录（兜底文件，MCP 是主通道）
pipelineRouter.post('/relay-context/sync', (req: Request, res: Response) => {
  const { runId } = req.body || {};
  if (!runId) {
    return res.status(400).json({ error: 'runId 为必填参数' });
  }
  try {
    const snapshot = syncRelayContext(runId);
    res.json({ ok: true, snapshot });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 读取 CONTEXT.md 是否已生成
pipelineRouter.get('/relay-context/:runId', (req: Request, res: Response) => {
  try {
    res.json(readRelayContext(req.params.runId));
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 拿某个 run 的上下文快照（MCP 和前端共用，不写文件）
pipelineRouter.get('/relay-context/:runId/snapshot', (req: Request, res: Response) => {
  try {
    res.json(buildRelaySnapshot(req.params.runId));
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 列出所有接力 run 的简表（给 MCP list 用，复用现有 listPipelineArtifactRuns）
// 已有 GET /artifact-runs，MCP 直接用它。

// ========== ZCode Skill 安装（让 ZCode 能反向调平台） ==========

// 检查 relay-dev Skill 是否已安装到 ZCode
pipelineRouter.get('/zcode-skill/status', (_req: Request, res: Response) => {
  const skillPath = path.join(os.homedir(), '.zcode', 'skills', 'relay-dev', 'SKILL.md');
  res.json({ installed: fs.existsSync(skillPath), path: skillPath });
});

// 把 relay-dev Skill 安装到 ~/.zcode/skills/relay-dev/SKILL.md
pipelineRouter.post('/zcode-skill/install', (_req: Request, res: Response) => {
  try {
    const skillDir = path.join(os.homedir(), '.zcode', 'skills', 'relay-dev');
    const skillPath = path.join(skillDir, 'SKILL.md');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillPath, RELAY_DEV_SKILL_CONTENT, 'utf-8');
    res.json({ ok: true, installed: true, path: skillPath });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ========== 执行器（P2）：默认关闭，开关可在模型 Tab 切换 ==========

// 读取执行器开关
pipelineRouter.get('/executor-config', (_req: Request, res: Response) => {
  res.json({
    config: getExecutorConfig(),
    deepseekAvailable: !!getDeepSeekConfig().apiKey,
  });
});

// 更新执行器开关（持久化到 platform-config.json）
pipelineRouter.post('/executor-config', (req: Request, res: Response) => {
  const { deepseekEnabled, deepseekMaxTokens } = req.body || {};
  try {
    const updates: Record<string, unknown> = {};
    if (typeof deepseekEnabled === 'boolean') updates.deepseekEnabled = deepseekEnabled;
    if (typeof deepseekMaxTokens === 'number') updates.deepseekMaxTokens = deepseekMaxTokens;
    res.json({ ok: true, config: updateExecutorConfig(updates) });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 用 DeepSeek 执行一个 relay 阶段（仅 design/review 类）
pipelineRouter.post('/execute-deepseek', async (req: Request, res: Response) => {
  const { runId, stageId, requirement, baseEngine } = req.body || {};
  if (!runId || !stageId) {
    return res.status(400).json({ error: 'runId 和 stageId 为必填参数' });
  }
  try {
    const engine = normalizeEngine(baseEngine);
    const result = await executeRelayStageWithDeepSeek(runId, stageId, requirement || '', engine);
    // trace：执行器调用（无论成败都记）
    traceExecutorCalled(
      runId,
      `${result.ok ? 'DeepSeek 执行成功' : 'DeepSeek 执行失败'}：${stageId}`,
      {
        stageId,
        executor: 'deepseek',
        ok: result.ok,
        durationMs: result.durationMs,
        error: result.error,
        artifactPath: result.artifactPath,
        meta: result.meta,
      },
      'executor',
    );
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ========== Trace 审计（P3） ==========

// 列出有 trace 记录的 run
pipelineRouter.get('/trace-runs', (_req: Request, res: Response) => {
  try {
    res.json(listTraceRuns());
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 读取单条 run 的全部 trace 事件
pipelineRouter.get('/traces/:runId', (req: Request, res: Response) => {
  try {
    res.json({ runId: req.params.runId, events: listTraceEvents(req.params.runId) });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 记录一条最终决策（交付摘要 / Pull 确认等，由用户在 UI 触发）
pipelineRouter.post('/traces/:runId/final-decision', (req: Request, res: Response) => {
  const { summary, detail } = req.body || {};
  if (!summary) {
    return res.status(400).json({ error: 'summary 为必填参数' });
  }
  try {
    res.json(traceFinalDecision(req.params.runId, summary, detail || {}));
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

// 生成交付报告（汇总阶段/文件/风险/验收）
pipelineRouter.post('/delivery-report/:runId', (req: Request, res: Response) => {
  try {
    const result = generateDeliveryReport(req.params.runId);
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
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
