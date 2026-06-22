/**
 * 会话管理路由
 */
import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import {
  createSession,
  getSession,
  listSessions,
  deleteSession,
  sendMessage,
} from '../services/claude-client.js';
import { PROJECT_ROOT } from '../services/config.js';

export const sessionRouter = Router();

// 创建会话
sessionRouter.post('/', (req: Request, res: Response) => {
  const { systemPrompt, allowedTools, cwd } = req.body;
  const id = uuid();
  const session = createSession(id, {
    cwd: cwd || PROJECT_ROOT,
    systemPrompt,
    allowedTools,
  });
  res.status(201).json(session);
});

// 列出会话
sessionRouter.get('/', (_req: Request, res: Response) => {
  res.json(listSessions());
});

// 获取会话详情
sessionRouter.get('/:id', (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// 发送消息（SSE 流式返回）
sessionRouter.post('/:id/messages', async (req: Request, res: Response) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const { EventEmitter } = await import('events');
  const emitter = new EventEmitter();

  // 客户端断开（关页面 / 切会话 / 主动停止）时中断后端生成，避免空跑烧 token
  // 注意：SSE 场景必须监听 res 的 close（req.close 在请求体读完后不可靠）
  const abortController = new AbortController();
  let clientGone = false;
  res.on('close', () => {
    clientGone = true;
    abortController.abort();
  });

  emitter.on('event', (event) => {
    // 客户端已断开则不再写入（res 可能已结束）
    if (clientGone) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    // 强制 flush，避免 Express/Node 缓冲 SSE 数据
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  });

  emitter.on('close', () => {
    if (!clientGone) res.end();
  });

  await sendMessage(req.params.id, message, emitter, abortController.signal);
});

// 删除会话（遵循 AGENTS.md：写操作用 POST，不用 DELETE）
sessionRouter.post('/:id/delete', (req: Request, res: Response) => {
  const deleted = deleteSession(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});
