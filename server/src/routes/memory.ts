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
} from '../services/memory-store.js';
import {
  generateConversationSummary,
  extractInsights,
  generateArtifactFromConversation,
  applyArtifact,
} from '../services/memory-analyzer.js';

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

// 所有洞察
memoryRouter.get('/insights', (_req: Request, res: Response) => {
  res.json(loadInsights());
});

// 所有制品
memoryRouter.get('/artifacts', (_req: Request, res: Response) => {
  res.json(loadArtifacts());
});

// 对话详情
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
