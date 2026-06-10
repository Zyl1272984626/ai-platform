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
import { settingsRouter } from './routes/settings.js';
import { projectsRouter } from './routes/projects.js';
import { pipelineRouter } from './routes/pipeline.js';
import { startWorkflow } from './services/workflow-engine.js';
import { initScheduler } from './services/scheduler.js';
import { getConfig } from './services/config.js';

const app = express();
const PORT = process.env.PORT || 3100;

app.use(cors());
app.use(express.json());

// 静态文件（Web UI 构建产物）
import * as path from 'path';
import * as fs from 'fs';
const webDist = path.resolve(import.meta.dirname, '../../web/dist');
const hasWebDist = fs.existsSync(path.join(webDist, 'index.html'));
if (hasWebDist) {
  app.use(express.static(webDist));
}

// API 路由
app.use('/api/sessions', sessionRouter);
app.use('/api/schools', schoolRouter);
app.use('/api/workflows', workflowRouter);
app.use('/api/skills', skillRouter);
app.use('/api/tests', testRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/pipelines', pipelineRouter);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', projects: getConfig().projects.length, version: '0.1.0' });
});

// SPA fallback：非 /api 路径返回 index.html，交给前端路由处理
app.get('*', (_req, res) => {
  if (hasWebDist) {
    res.sendFile('index.html', { root: webDist });
  } else {
    res.status(404).json({ error: 'Frontend not built. Run: cd web && npm run build' });
  }
});

app.listen(PORT, () => {
  const config = getConfig();
  console.log(`[AI Platform] Server running on http://localhost:${PORT}`);
  console.log(`[AI Platform] Projects: ${config.projects.length}`);

  // 预加载 Claude Code SDK（~75MB），避免首次测试时等待
  import('@anthropic-ai/claude-code').then(() => {
    console.log('[AI Platform] Claude Code SDK 预加载完成');
  }).catch((err: any) => {
    console.warn('[AI Platform] Claude Code SDK 预加载失败（首次使用时会再尝试）:', err.message);
  });

  // 初始化定时任务调度器
  initScheduler((workflowName, params, emitter) => {
    startWorkflow(workflowName, params, emitter);
  });
});
