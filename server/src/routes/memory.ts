/**
 * 记忆中枢 API 路由
 *
 * GET  /api/memory              列表（支持 ?source= &project= 过滤）
 * GET  /api/memory/stats        聚合统计
 * GET  /api/memory/insights     列出所有洞察
 * GET  /api/memory/artifacts    列出所有制品
 * GET  /api/memory/:id          获取完整对话详情
 * POST /api/memory/scan         扫描导入新对话
 * POST /api/memory/:id/summarize   LLM 生成摘要
 * POST /api/memory/:id/insights    LLM 提取洞察
 * POST /api/memory/:id/generate    生成制品
 * POST /api/memory/artifacts/:id/apply  应用制品
 */
import { Router, Request, Response } from 'express';
import { scanAllConversations } from '../services/conversation-scanner.js';
import {
  loadConversationIndex,
  loadConversationDetail,
  loadInsights,
  loadArtifacts,
  getMemoryStats,
  updateConversationSummary,
  deleteConversations,
  loadMemoryItems,
  loadAutomationLogs,
  getMemoryItemById,
  loadInjections,
  updateInjectionFeedback,
} from '../services/memory-store.js';
import {
  generateConversationSummary,
  extractInsights,
  generateArtifactFromConversation,
  applyArtifact,
} from '../services/memory-analyzer.js';
import {
  generateMemoryCandidates,
  exportProjectMemory,
  recallMemory,
  runMemoryAutomation,
  runFullMemoryUpdate,
  transitionMemoryItem,
  editMemoryItem,
  curateConversation,
  curateBatch,
  getMemoryVectorStatus,
  buildMemoryOverview,
  smartFilterCandidates,
  applyFilterSuggestions,
} from '../services/memory-curator.js';
import { getMemoryConfig, updateMemoryConfig } from '../services/memory-config.js';
import { rebuildVectorIndex } from '../services/memory-vector.js';

export const memoryRouter = Router();

// 对话列表（支持过滤）
memoryRouter.get('/', (req: Request, res: Response) => {
  const { source, project, from, to } = req.query;
  let list = loadConversationIndex();

  if (source && source !== 'all') {
    list = list.filter(c => c.source === source);
  }
  if (project) {
    const q = String(project).toLowerCase();
    list = list.filter(c =>
      c.projectPath.toLowerCase().includes(q) || c.projectSlug.toLowerCase().includes(q)
    );
  }
  if (from) {
    const fromDate = new Date(String(from));
    list = list.filter(c => c.startedAt && new Date(c.startedAt) >= fromDate);
  }
  if (to) {
    const toDate = new Date(String(to));
    list = list.filter(c => c.lastActivityAt && new Date(c.lastActivityAt) <= toDate);
  }

  // 按最近活动时间降序
  list.sort((a, b) => {
    const ta = a.lastActivityAt || a.importedAt || '';
    const tb = b.lastActivityAt || b.importedAt || '';
    return tb.localeCompare(ta);
  });

  res.json(list);
});

// 聚合统计
memoryRouter.get('/stats', (_req: Request, res: Response) => {
  res.json(getMemoryStats());
});

// 冷库概览（首页用：知识全景/活力/分布/产物预览）
memoryRouter.get('/overview', (req: Request, res: Response) => {
  const projectPath = req.query.project ? String(req.query.project) : undefined;
  res.json(buildMemoryOverview(projectPath));
});

// 所有洞察
memoryRouter.get('/insights', (_req: Request, res: Response) => {
  res.json(loadInsights());
});

// 所有制品
memoryRouter.get('/artifacts', (_req: Request, res: Response) => {
  res.json(loadArtifacts());
});

// 对话详情
memoryRouter.get('/items', (req: Request, res: Response) => {
  const { status, type, project } = req.query;
  let list = loadMemoryItems();
  if (status && status !== 'all') list = list.filter(item => item.status === status);
  if (type && type !== 'all') list = list.filter(item => item.type === type);
  if (project) {
    const q = String(project).toLowerCase().replace(/\\/g, '/');
    list = list.filter(item => (item.projectPath || '').toLowerCase().replace(/\\/g, '/').includes(q));
  }
  list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(list);
});

memoryRouter.get('/candidates', (_req: Request, res: Response) => {
  res.json(loadMemoryItems().filter(item => item.status === 'candidate'));
});

memoryRouter.post('/candidates/generate', (req: Request, res: Response) => {
  try {
    const result = generateMemoryCandidates(req.body || {});
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 智能筛选候选（规则版 / LLM 版）
memoryRouter.post('/candidates/smart-filter', async (req: Request, res: Response) => {
  try {
    const mode = req.body?.mode === 'llm' ? 'llm' : 'rule';
    const result = await smartFilterCandidates(mode);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 批量应用筛选建议
memoryRouter.post('/candidates/apply-suggestions', (req: Request, res: Response) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items 必须是非空数组' });
  }
  try {
    const result = applyFilterSuggestions(items);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 记忆编辑 / 详情 / 批量 ----------
// 注意：批量路由 /items/batch/* 必须注册在 /items/:id/* 之前，避免 :id 吞掉 batch。

// 受控编辑（改 content/title/tags/type 等，不动状态/计数/溯源）
memoryRouter.post('/items/:id/update', (req: Request, res: Response) => {
  const item = editMemoryItem(req.params.id, req.body || {});
  if (!item) return res.status(404).json({ error: 'memory item not found' });
  res.json(item);
});

// 批量状态转换（通过 / 拒绝 / 归档）
memoryRouter.post('/items/batch/transition', (req: Request, res: Response) => {
  const { ids, action } = req.body || {};
  const allowedActions = ['approve', 'activate', 'reject', 'archive'];
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids 必须是非空数组' });
  }
  if (!allowedActions.includes(action)) {
    return res.status(400).json({ error: `action 必须为 ${allowedActions.join(' / ')}` });
  }
  const statusMap: Record<string, 'approved' | 'active' | 'rejected' | 'archived'> = {
    approve: 'approved',
    activate: 'active',
    reject: 'rejected',
    archive: 'archived',
  };
  const results = ids
    .map(id => transitionMemoryItem(id, statusMap[action]))
    .filter(Boolean);
  res.json({ action, applied: results.length, requested: ids.length, items: results });
});

// 单条详情
memoryRouter.get('/items/:id', (req: Request, res: Response) => {
  const item = getMemoryItemById(req.params.id);
  if (!item) return res.status(404).json({ error: 'memory item not found' });
  res.json(item);
});

// ---------- 冷库配置 ----------

memoryRouter.get('/config', (_req: Request, res: Response) => {
  res.json(getMemoryConfig());
});

memoryRouter.post('/config/update', (req: Request, res: Response) => {
  try {
    const updated = updateMemoryConfig(req.body || {});
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 注入记录 ----------

memoryRouter.get('/injections', (req: Request, res: Response) => {
  const { limit, target } = req.query;
  let list = loadInjections();
  if (target && target !== 'all') {
    list = list.filter(item => item.target === String(target));
  }
  const n = limit ? Number(limit) : 0;
  res.json(n > 0 ? list.slice(0, n) : list);
});

memoryRouter.post('/injections/:id/feedback', (req: Request, res: Response) => {
  const { feedback } = req.body || {};
  const allowed = ['useful', 'wrong', 'irrelevant'];
  if (!allowed.includes(feedback)) {
    return res.status(400).json({ error: `feedback 必须为 ${allowed.join(' / ')}` });
  }
  const item = updateInjectionFeedback(req.params.id, feedback);
  if (!item) return res.status(404).json({ error: 'injection not found' });
  res.json(item);
});

memoryRouter.post('/items/:id/approve', (req: Request, res: Response) => {
  const item = transitionMemoryItem(req.params.id, 'approved', req.body || {});
  if (!item) return res.status(404).json({ error: 'memory item not found' });
  res.json(item);
});

memoryRouter.post('/items/:id/activate', (req: Request, res: Response) => {
  const item = transitionMemoryItem(req.params.id, 'active', req.body || {});
  if (!item) return res.status(404).json({ error: 'memory item not found' });
  res.json(item);
});

memoryRouter.post('/items/:id/reject', (req: Request, res: Response) => {
  const item = transitionMemoryItem(req.params.id, 'rejected');
  if (!item) return res.status(404).json({ error: 'memory item not found' });
  res.json(item);
});

memoryRouter.post('/items/:id/archive', (req: Request, res: Response) => {
  const item = transitionMemoryItem(req.params.id, 'archived');
  if (!item) return res.status(404).json({ error: 'memory item not found' });
  res.json(item);
});

memoryRouter.post('/recall', (req: Request, res: Response) => {
  try {
    const result = recallMemory(req.body || {});
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

memoryRouter.get('/automation/status', (_req: Request, res: Response) => {
  res.json({
    enabled: true,
    mode: 'manual-runner-with-logs',
    pipeline: ['scan', 'candidate-generation', 'recall-ready'],
    recentRuns: loadAutomationLogs().slice(0, 10),
    next: 'Can be wired to node-cron or service startup after the review loop is stable.',
  });
});

memoryRouter.post('/automation/run', async (req: Request, res: Response) => {
  try {
    const result = await runMemoryAutomation({ ...(req.body || {}), trigger: 'manual' });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 一键全自动更新（新人/日常唯一需要的入口）
memoryRouter.post('/full-update', async (req: Request, res: Response) => {
  try {
    const result = await runFullMemoryUpdate({ useLLM: req.body?.useLLM !== false });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

memoryRouter.get('/automation/logs', (_req: Request, res: Response) => {
  res.json(loadAutomationLogs());
});

memoryRouter.post('/export/project', (req: Request, res: Response) => {
  const { projectPath, outputFile } = req.body || {};
  if (!projectPath) return res.status(400).json({ error: 'projectPath is required' });
  try {
    res.json(exportProjectMemory(projectPath, outputFile));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- LLM 策展（Phase 2）----------

// 单会话深度策展（DeepSeek）
memoryRouter.post('/curate', async (req: Request, res: Response) => {
  const { conversationId } = req.body || {};
  if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
  try {
    const result = await curateConversation(conversationId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 批量策展（最近 N 条）
memoryRouter.post('/curate/batch', async (req: Request, res: Response) => {
  try {
    const result = await curateBatch(req.body || {});
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 向量索引（Phase 4）----------

memoryRouter.get('/vectors/status', (_req: Request, res: Response) => {
  res.json(getMemoryVectorStatus());
});

memoryRouter.post('/vectors/rebuild', (_req: Request, res: Response) => {
  try {
    res.json(rebuildVectorIndex());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

memoryRouter.get('/:id', (req: Request, res: Response) => {
  const detail = loadConversationDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: '对话不存在' });
  res.json(detail);
});

// 扫描导入
memoryRouter.post('/scan', async (_req: Request, res: Response) => {
  try {
    const result = await scanAllConversations();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: `扫描失败: ${err.message}` });
  }
});

// 批量删除
memoryRouter.post('/delete', (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids 必须是非空数组' });
  }
  try {
    const result = deleteConversations(ids);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: `删除失败: ${err.message}` });
  }
});

// LLM 生成摘要
memoryRouter.post('/:id/summarize', async (req: Request, res: Response) => {
  try {
    const summary = await generateConversationSummary(req.params.id);
    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// LLM 提取洞察
memoryRouter.post('/:id/insights', async (req: Request, res: Response) => {
  try {
    const insights = await extractInsights(req.params.id);
    res.json(insights);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 生成制品
memoryRouter.post('/:id/generate', async (req: Request, res: Response) => {
  const { type } = req.body;
  if (!type || !['skill', 'prompt', 'memory-note'].includes(type)) {
    return res.status(400).json({ error: 'type 必须为 skill、prompt 或 memory-note' });
  }
  try {
    const artifact = await generateArtifactFromConversation(req.params.id, type);
    res.json(artifact);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 应用制品
memoryRouter.post('/artifacts/:id/apply', async (req: Request, res: Response) => {
  try {
    const result = await applyArtifact(req.params.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
