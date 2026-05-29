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

  emitter.on('event', (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    // 强制 flush，避免 Express/Node 缓冲 SSE 数据
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  });

  emitter.on('close', () => {
    res.end();
  });

  await sendMessage(req.params.id, message, emitter);
});

// 删除会话
sessionRouter.delete('/:id', (req: Request, res: Response) => {
  const deleted = deleteSession(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});
