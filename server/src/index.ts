/**
 * AI 工程平台 - Server 入口
 */
import express from 'express';
import cors from 'cors';
import { sessionRouter } from './routes/session.js';
import { schoolRouter } from './routes/school.js';
import { workflowRouter } from './routes/workflow.js';
import { skillRouter } from './routes/skill.js';
import { testRouter } from './routes/test.js';
import { startWorkflow } from './services/workflow-engine.js';
import { initScheduler } from './services/scheduler.js';
import { PROJECT_ROOT } from './services/config.js';

const app = express();
const PORT = process.env.PORT || 3100;

app.use(cors());
app.use(express.json());

// 静态文件（Web UI 构建产物）
app.use(express.static('../web/dist'));

// API 路由
app.use('/api/sessions', sessionRouter);
app.use('/api/schools', schoolRouter);
app.use('/api/workflows', workflowRouter);
app.use('/api/skills', skillRouter);
app.use('/api/tests', testRouter);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', projectRoot: PROJECT_ROOT, version: '0.1.0' });
});

app.listen(PORT, () => {
  console.log(`[AI Platform] Server running on http://localhost:${PORT}`);
  console.log(`[AI Platform] Project root: ${PROJECT_ROOT}`);

  // 初始化定时任务调度器
  initScheduler((workflowName, params, emitter) => {
    startWorkflow(workflowName, params, emitter);
  });
});
