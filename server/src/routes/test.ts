/**
 * 测试路由
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import {
  createTestSuite,
  executeTestRun,
  listTestRuns,
  getTestRun,
  deleteTestRun,
  abortTestRun,
  listRunningSuites,
  getConcurrency,
  setConcurrency,
  resumeTestRun,
  chatWithReview,
  generateTestPrompt,
  registerManualReport,
  type TestType,
} from '../services/test-runner.js';
import { testBus } from '../services/test-events.js';

export const testRouter = Router();

// 测试类型列表（前端用）
testRouter.get('/types', (_req: Request, res: Response) => {
  res.json([
    { type: 'agent', name: 'Agent 智能体测试', description: '测试 AI Agent 的对话响应、工具调用、代码理解能力', icon: '🤖' },
    { type: 'e2e', name: 'E2E 页面测试', description: 'Playwright 真实浏览器测试，覆盖主系统88个页面，支持 quick/standard/deep 三种模式', icon: '🌐' },
    { type: 'frontend', name: '前端单元测试', description: 'Claude Code 发现可测试单元，生成 vitest 测试用例并执行', icon: '🧪' },
    { type: 'api', name: 'API 接口测试', description: 'Claude Code 扫描源码发现接口，自动生成测试用例并验证响应', icon: '🔌' },
    { type: 'codereview', name: '代码审查', description: 'Claude Code 扫描源码，按安全/性能/规范等维度生成审查报告', icon: '🔍' },
  ]);
});

// 列出测试记录
testRouter.get('/runs', (req: Request, res: Response) => {
  const type = req.query.type as TestType | undefined;
  res.json(listTestRuns(type));
});

// 单条记录
testRouter.get('/runs/:id', (req: Request, res: Response) => {
  const run = getTestRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

// 生成提示词（供前端复制到 Claude Code 手动执行）
testRouter.post('/generate-prompt', (req: Request, res: Response) => {
  const { type, config } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });
  try {
    const result = generateTestPrompt(type as TestType, config || {});
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// 注册手动执行产生的报告（让测试页面可见）
testRouter.post('/register-manual-report', (req: Request, res: Response) => {
  const { type, projectId, projectName, reportPath } = req.body;
  if (!reportPath) return res.status(400).json({ error: 'reportPath is required' });
  try {
    const suiteId = registerManualReport({ type, projectId, projectName, reportPath });
    res.json({ ok: true, suiteId });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// 创建并执行测试（返回 JSON，SSE 通过 /runs/:id/stream 订阅）
testRouter.post('/run', (req: Request, res: Response) => {
  const { type, config } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });

  try {
    const suite = createTestSuite(type as TestType, config);
    // Fire-and-forget 执行（事件通过 testBus 广播）
    executeTestRun(suite.id).catch((err) => {
      testBus.emit('test:error', { suiteId: suite.id, error: err.message });
    });
    res.json({ suiteId: suite.id });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// SSE 订阅某个测试运行的实时事件
testRouter.get('/runs/:id/stream', (req: Request, res: Response) => {
  const suiteId = req.params.id;
  const suite = getTestRun(suiteId);
  if (!suite) return res.status(404).json({ error: 'Run not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // 如果已完成，直接返回最终状态
  if (suite.status !== 'running' && suite.status !== 'pending') {
    res.write(`data: ${JSON.stringify({ event: 'test:done', suiteId, status: suite.status })}\n\n`);
    res.end();
    return;
  }

  // 事件处理函数
  function onEvent(eventName: string, data: any) {
    if (data.suiteId !== suiteId) return;
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ event: eventName, ...data })}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
    }
  }

  function onDone(data: any) {
    if (data.suiteId !== suiteId) return;
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ event: 'test:done', ...data })}\n\n`);
      res.end();
    }
  }

  // 订阅事件总线
  const onTestStart = (d: any) => onEvent('test:start', d);
  const onTestUpdate = (d: any) => onEvent('test:update', d);
  const onAgentStream = (d: any) => onEvent('agent:stream', d);
  const onTestError = (d: any) => onEvent('test:error', d);
  const onTestResumed = (d: any) => onEvent('test:resumed', d);
  const onAgentChat = (d: any) => onEvent('agent:chat', d);

  testBus.on('test:start', onTestStart);
  testBus.on('test:update', onTestUpdate);
  testBus.on('agent:stream', onAgentStream);
  testBus.on('test:done', onDone);
  testBus.on('test:error', onTestError);
  testBus.on('test:resumed', onTestResumed);
  testBus.on('agent:chat', onAgentChat);

  // 心跳保活
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': heartbeat\n\n');
    }
  }, 15000);

  // 客户端断开时清理
  req.on('close', () => {
    clearInterval(heartbeat);
    testBus.off('test:start', onTestStart);
    testBus.off('test:update', onTestUpdate);
    testBus.off('agent:stream', onAgentStream);
    testBus.off('test:done', onDone);
    testBus.off('test:error', onTestError);
    testBus.off('test:resumed', onTestResumed);
    testBus.off('agent:chat', onAgentChat);
  });
});

// 列出当前运行中的测试
testRouter.get('/running', (_req: Request, res: Response) => {
  res.json(listRunningSuites());
});

// 获取/设置并发配置
testRouter.get('/concurrency', (_req: Request, res: Response) => {
  res.json(getConcurrency());
});

testRouter.post('/concurrency', (req: Request, res: Response) => {
  const { type, value } = req.body;
  if (!type || typeof value !== 'number') {
    return res.status(400).json({ error: 'type and value(number) are required' });
  }
  setConcurrency(type as TestType, value);
  res.json(getConcurrency());
});

// 中断正在运行的测试
testRouter.post('/runs/:id/abort', (req: Request, res: Response) => {
  const ok = abortTestRun(req.params.id);
  res.json({ ok });
});

// 恢复中断的代码审查
testRouter.post('/runs/:id/resume', async (req: Request, res: Response) => {
  try {
    const suiteId = await resumeTestRun(req.params.id);
    // 启动执行
    executeTestRun(suiteId).catch((err) => {
      testBus.emit('test:error', { suiteId, error: err.message });
    });
    res.json({ suiteId });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 人工对话（基于审查上下文）
testRouter.post('/runs/:id/chat', async (req: Request, res: Response) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const chatSuiteId = await chatWithReview(req.params.id, message);
    res.json({ suiteId: chatSuiteId });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 获取 E2E 测试报告（HTML）
testRouter.get('/runs/:id/report', (req: Request, res: Response) => {
  const run = getTestRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const reportPath = run.config?.reportPath as string;
  if (!reportPath) return res.status(404).json({ error: '报告未生成' });

  if (!fs.existsSync(reportPath)) return res.status(404).json({ error: '报告文件不存在' });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(reportPath);
});

// 删除测试记录
testRouter.delete('/runs/:id', (req: Request, res: Response) => {
  const ok = deleteTestRun(req.params.id);
  res.json({ ok });
});
