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
import { memoryRouter } from './routes/memory.js';
import { startWorkflow } from './services/workflow-engine.js';
import { initScheduler } from './services/scheduler.js';
import { getConfig } from './services/config.js';
import { runMemoryAutomation } from './services/memory-curator.js';
import { getMemoryConfig } from './services/memory-config.js';
import { initFromPlatformConfig as initDeepSeekFromConfig } from './services/deepseek-client.js';
import { initExecutorConfig } from './services/relay-executor.js';

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
app.use('/api/memory', memoryRouter);

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

  // 启动即加载 DeepSeek 配置（修复：此前只在打开 Model Tab 时才初始化，
  // 导致 code-review 阶段的交叉审查可能在 apiKey 未注入时被静默跳过）
  initDeepSeekFromConfig();

  // 加载执行器开关（默认全部关闭，避免把平台变回伪自动化）
  initExecutorConfig();

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

  setTimeout(() => {
    // 启动自动化受冷库配置开关控制；关闭时跳过，避免每次启动都重算
    if (!getMemoryConfig().startupAutomation) {
      console.log('[Memory] startup automation skipped (disabled by config)');
      return;
    }
    runMemoryAutomation({ limit: 160, trigger: 'startup' })
      .then((result) => {
        console.log(`[Memory] startup automation done: scanned=${result.scan.scanned}, candidates+${result.candidates.created}`);
      })
      .catch((err: any) => {
        console.warn('[Memory] startup automation failed:', err?.message || err);
      });
  }, 5000);
});
