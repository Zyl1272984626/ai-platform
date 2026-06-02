/**
 * 项目管理 API
 * 多项目的 CRUD、页面发现、连通性检测
 */
import { Router, type Request, type Response } from 'express';
import {
  getProjects,
  getProjectById,
  addProject,
  updateProject,
  deleteProject,
  setDefaultProject,
  updateProjectPages,
  loadProjectPages,
  saveProjectPageSets,
  getGlobalParams,
  saveGlobalParams,
  type TestProject,
  type PageSet,
  type PageConfig,
} from '../services/config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

export const projectsRouter = Router();

// ========== 项目 CRUD ==========

/** 列出所有项目 */
projectsRouter.get('/', (_req: Request, res: Response) => {
  const projects = getProjects();
  // 不返回密码明文
  res.json(projects.map(p => ({
    ...p,
    password: p.password ? '******' : '',
  })));
});

/** 获取单个项目 */
projectsRouter.get('/:id', (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json({ ...project, password: '******' });
});

/** 添加项目 */
projectsRouter.post('/', (req: Request, res: Response) => {
  const { name, baseUrl, apiBaseUrl, loginUrl, username, password } = req.body;

  if (!name || !baseUrl || !username || !password) {
    res.status(400).json({ error: '缺少必填字段: name, baseUrl, username, password' });
    return;
  }

  const project = addProject({
    name,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiBaseUrl: (apiBaseUrl || baseUrl).replace(/\/+$/, ''),
    loginUrl: loginUrl || '/login',
    username,
    password,
    sourcePath: req.body.sourcePath,
    skillPath: req.body.skillPath,
    status: 'active',
  });

  res.status(201).json({ ...project, password: '******' });
});

/** 更新项目 */
projectsRouter.post('/:id/update', (req: Request, res: Response) => {
  const updated = updateProject(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json({ ...updated, password: '******' });
});

/** 删除项目 */
projectsRouter.post('/:id/delete', (req: Request, res: Response) => {
  const ok = deleteProject(req.params.id);
  if (!ok) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json({ success: true });
});

/** 设置默认项目 */
projectsRouter.post('/:id/default', (req: Request, res: Response) => {
  const ok = setDefaultProject(req.params.id);
  if (!ok) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json({ success: true });
});

// ========== 页面管理 ==========

/** 获取项目的页面集 */
projectsRouter.get('/:id/pages', (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json(project.pageSets || []);
});

/** 批量保存项目页面集 */
projectsRouter.post('/:id/pages/save', (req: Request, res: Response) => {
  const { pageSets } = req.body;
  if (!Array.isArray(pageSets)) {
    res.status(400).json({ error: 'pageSets 必须为数组' });
    return;
  }

  const result = saveProjectPageSets(req.params.id, pageSets);
  if (!result) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json(result);
});

/** 新建页面集 */
projectsRouter.post('/:id/page-sets/create', (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: '页面集名称不能为空' });
    return;
  }

  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  const pageData = loadProjectPages(req.params.id);
  const newSet: PageSet = {
    id: uuidv4().substring(0, 8),
    name,
    pages: [],
  };
  pageData.pageSets.push(newSet);
  saveProjectPageSets(req.params.id, pageData.pageSets);
  res.json(newSet);
});

/** 更新页面集（重命名等） */
projectsRouter.post('/:id/page-sets/update', (req: Request, res: Response) => {
  const { setId, name, description } = req.body;
  if (!setId) {
    res.status(400).json({ error: '缺少 setId' });
    return;
  }

  const pageData = loadProjectPages(req.params.id);
  const set = pageData.pageSets.find(s => s.id === setId);
  if (!set) {
    res.status(404).json({ error: '页面集不存在' });
    return;
  }

  if (name) set.name = name;
  if (description !== undefined) set.description = description;
  saveProjectPageSets(req.params.id, pageData.pageSets);
  res.json(set);
});

/** 删除页面集 */
projectsRouter.post('/:id/page-sets/delete', (req: Request, res: Response) => {
  const { setId } = req.body;
  if (!setId) {
    res.status(400).json({ error: '缺少 setId' });
    return;
  }

  const pageData = loadProjectPages(req.params.id);
  const idx = pageData.pageSets.findIndex(s => s.id === setId);
  if (idx === -1) {
    res.status(404).json({ error: '页面集不存在' });
    return;
  }

  pageData.pageSets.splice(idx, 1);
  saveProjectPageSets(req.params.id, pageData.pageSets);
  res.json({ success: true });
});

/** 添加页面到页面集 */
projectsRouter.post('/:id/page-sets/:setId/pages/add', (req: Request, res: Response) => {
  const { setId } = req.params;
  const { name, url, path, description } = req.body;
  if (!name || !path) {
    res.status(400).json({ error: '页面名称和路径不能为空' });
    return;
  }

  const pageData = loadProjectPages(req.params.id);
  const set = pageData.pageSets.find(s => s.id === setId);
  if (!set) {
    res.status(404).json({ error: '页面集不存在' });
    return;
  }

  const newPage: PageConfig = {
    id: uuidv4().substring(0, 8),
    name,
    url: url || path,
    path,
    description,
  };
  set.pages.push(newPage);
  saveProjectPageSets(req.params.id, pageData.pageSets);
  res.json(newPage);
});

/** 更新页面 */
projectsRouter.post('/:id/pages/update', (req: Request, res: Response) => {
  const { pageId, name, url, path, description, targetSetId, params } = req.body;
  if (!pageId) {
    res.status(400).json({ error: '缺少 pageId' });
    return;
  }

  const pageData = loadProjectPages(req.params.id);
  let found = false;

  for (const set of pageData.pageSets) {
    const page = set.pages.find(p => p.id === pageId);
    if (page) {
      // 如果要移动到其他页面集
      if (targetSetId && targetSetId !== set.id) {
        const targetSet = pageData.pageSets.find(s => s.id === targetSetId);
        if (!targetSet) {
          res.status(404).json({ error: '目标页面集不存在' });
          return;
        }
        set.pages = set.pages.filter(p => p.id !== pageId);
        targetSet.pages.push({
          ...page,
          name: name || page.name,
          url: url || page.url,
          path: path || page.path,
          description: description !== undefined ? description : page.description,
          params: params !== undefined ? params : page.params,
        });
      } else {
        if (name) page.name = name;
        if (url) page.url = url;
        if (path) page.path = path;
        if (description !== undefined) page.description = description;
        if (params !== undefined) page.params = params;
      }
      found = true;
      break;
    }
  }

  if (!found) {
    res.status(404).json({ error: '页面不存在' });
    return;
  }

  saveProjectPageSets(req.params.id, pageData.pageSets);
  res.json({ success: true });
});

/** 批量设置动态参数值（为项目中所有含该参数的页面统一设置） */
projectsRouter.post('/:id/pages/batch-set-param', (req: Request, res: Response) => {
  const { paramName, values, scope } = req.body;
  if (!paramName || !Array.isArray(values)) {
    res.status(400).json({ error: '缺少 paramName 或 values' });
    return;
  }

  const pageData = loadProjectPages(req.params.id);
  let updatedCount = 0;

  const targetSets = scope
    ? pageData.pageSets.filter(ps => ps.id === scope)
    : pageData.pageSets;

  for (const set of targetSets) {
    for (const page of set.pages) {
      // 匹配有 params 字段且包含该参数的，或者路径中包含该参数的（兼容旧数据）
      const hasParam = (page.params && paramName in page.params) || page.path?.includes(paramName);
      if (hasParam) {
        if (!page.params) page.params = {};
        page.params[paramName] = values;
        updatedCount++;
      }
    }
  }

  if (updatedCount === 0) {
    res.status(404).json({ error: `未找到含参数 ${paramName} 的页面` });
    return;
  }

  saveProjectPageSets(req.params.id, pageData.pageSets);
  res.json({ success: true, updatedCount });
});

/** 获取项目公共动态参数 */
projectsRouter.get('/:id/global-params', (req: Request, res: Response) => {
  const params = getGlobalParams(req.params.id);
  res.json(params);
});

/** 保存项目公共动态参数 */
projectsRouter.post('/:id/global-params', (req: Request, res: Response) => {
  const { params } = req.body;
  if (!params || typeof params !== 'object') {
    res.status(400).json({ error: '缺少 params' });
    return;
  }
  saveGlobalParams(req.params.id, params);
  res.json({ success: true });
});

/** 删除页面 */
projectsRouter.post('/:id/pages/delete', (req: Request, res: Response) => {
  const { pageId } = req.body;
  if (!pageId) {
    res.status(400).json({ error: '缺少 pageId' });
    return;
  }

  const pageData = loadProjectPages(req.params.id);
  let found = false;

  for (const set of pageData.pageSets) {
    const idx = set.pages.findIndex(p => p.id === pageId);
    if (idx !== -1) {
      set.pages.splice(idx, 1);
      found = true;
      break;
    }
  }

  if (!found) {
    res.status(404).json({ error: '页面不存在' });
    return;
  }

  saveProjectPageSets(req.params.id, pageData.pageSets);
  res.json({ success: true });
});

// ========== 发现日志 ==========

/** 获取项目的发现结果（探测了哪些入口、哪些有效/无效） */
projectsRouter.get('/:id/discovery-log', (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const filePath = path.join(DATA_DIR, 'projects', req.params.id, 'discovery-result.json');
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const data = raw.rawRoutes || raw; // 兼容两种结构
      const entries: { name: string; status: string; routeCount: number; error?: string }[] = [];
      for (const [name, info] of Object.entries(data)) {
        const entry = info as any;
        if (entry.error) {
          entries.push({ name, status: 'error', routeCount: 0, error: entry.error });
        } else if (entry.routes) {
          entries.push({ name, status: 'valid', routeCount: entry.routes.length });
        } else {
          entries.push({ name, status: 'unknown', routeCount: 0 });
        }
      }
      res.json({
        entries,
        validEntries: entries.filter(e => e.status === 'valid').map(e => e.name),
        sourceEntries: raw.sourceEntries || [],
        probedEntries: raw.probedEntries || [],
        discoveredAt: project.discoveredAt,
      });
    } else {
      res.json({ entries: [], validEntries: [], discoveredAt: project.discoveredAt });
    }
  } catch {
    res.json({ entries: [], validEntries: [], discoveredAt: project.discoveredAt });
  }
});

// ========== 连通性检测 ==========

/** 检测项目连通性 */
projectsRouter.post('/:id/check', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  const results: Record<string, { ok: boolean; msg: string }> = {};

  // 1. 前端地址可达性
  try {
    const resp = await fetch(project.baseUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    results['frontend'] = {
      ok: resp.ok || resp.status === 200,
      msg: `前端可达 (${resp.status})`,
    };
  } catch (e: any) {
    results['frontend'] = { ok: false, msg: `前端不可达: ${e.message}` };
  }

  // 2. 后端 API 可达性
  try {
    const resp = await fetch(project.apiBaseUrl + '/api/health', {
      signal: AbortSignal.timeout(5000),
    });
    results['backend'] = {
      ok: resp.ok,
      msg: `后端可达 (${resp.status})`,
    };
  } catch {
    results['backend'] = { ok: false, msg: '后端不可达' };
  }

  // 3. 登录页可达性
  try {
    const loginUrl = project.baseUrl + project.loginUrl;
    const resp = await fetch(loginUrl, {
      signal: AbortSignal.timeout(5000),
    });
    results['login'] = {
      ok: resp.ok || resp.status === 200,
      msg: `登录页可达 (${resp.status})`,
    };
  } catch {
    results['login'] = { ok: false, msg: '登录页不可达' };
  }

  // 4. 源码路径（如果配置了）
  if (project.sourcePath) {
    const fs = await import('fs');
    results['sourcePath'] = {
      ok: fs.existsSync(project.sourcePath),
      msg: fs.existsSync(project.sourcePath)
        ? `源码路径存在: ${project.sourcePath}`
        : `源码路径不存在: ${project.sourcePath}`,
    };
  }

  // 5. Skill 文件（如果配置了）
  if (project.skillPath) {
    const fs = await import('fs');
    results['skillPath'] = {
      ok: fs.existsSync(project.skillPath),
      msg: fs.existsSync(project.skillPath) ? 'Skill 文件存在' : 'Skill 文件不存在',
    };
  }

  res.json(results);
});

// ========== 页面发现（触发 + SSE） ==========

/** 触发 API 接口发现 — SSE 流式返回进度 */
projectsRouter.post('/:id/discover-api', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendSSE = (data: any) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  try {
    const { discoverApi } = await import('../services/api-discovery.js');

    await discoverApi(project.id, (progress) => {
      sendSSE(progress);
    });

    sendSSE({ stage: 'complete', message: 'API 接口发现完成' });
  } catch (err: any) {
    sendSSE({ stage: 'error', message: err.message });
  } finally {
    try { res.end(); } catch { /* already closed */ }
  }
});

/** 获取 API 发现结果 */
projectsRouter.get('/:id/api-discovery', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const { getApiDiscovery } = await import('../services/api-discovery.js');
  const result = getApiDiscovery(req.params.id);
  res.json(result || { modules: [], summary: { totalModules: 0, totalEndpoints: 0 } });
});

/** 获取 API 测试定义 */
projectsRouter.get('/:id/api-tests', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const { getApiTests } = await import('../services/api-discovery.js');
  const result = getApiTests(req.params.id);
  res.json(result || { testModules: [] });
});

/** 触发页面发现 — 直接开始，通过 SSE 实时推送进度 */
projectsRouter.post('/:id/discover', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  const mode = (req.body?.mode as string) || 'runtime';

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendSSE = (data: any) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  try {
    const { discoverPages } = await import('../services/page-discovery.js');

    await discoverPages(project.id, mode as any, (progress) => {
      sendSSE(progress);
    });

    sendSSE({ stage: 'complete', message: '发现流程结束' });
  } catch (err: any) {
    sendSSE({ stage: 'error', message: err.message });
  } finally {
    try { res.end(); } catch { /* already closed */ }
  }
});

// ========== 前端单元测试发现 ==========

/** 触发前端发现 — SSE 流式返回进度 */
projectsRouter.post('/:id/discover-frontend', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendSSE = (data: any) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
  };

  try {
    const { discoverFrontend } = await import('../services/frontend-discovery.js');
    await discoverFrontend(project.id, (progress) => { sendSSE(progress); });
    sendSSE({ stage: 'complete', message: '前端发现完成' });
  } catch (err: any) {
    sendSSE({ stage: 'error', message: err.message });
  } finally {
    try { res.end(); } catch { /* already closed */ }
  }
});

/** 获取前端发现结果 */
projectsRouter.get('/:id/frontend-discovery', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const { getFrontendDiscovery } = await import('../services/frontend-discovery.js');
  const result = getFrontendDiscovery(req.params.id);
  res.json(result || { modules: [], summary: { totalModules: 0, totalTestTargets: 0 } });
});

// ========== 代码审查发现 ==========

/** 触发代码审查发现 — SSE 流式返回进度 */
projectsRouter.post('/:id/discover-review', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendSSE = (data: any) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
  };

  try {
    const { discoverReview } = await import('../services/review-discovery.js');
    await discoverReview(project.id, (progress) => { sendSSE(progress); });
    sendSSE({ stage: 'complete', message: '审查点发现完成' });
  } catch (err: any) {
    sendSSE({ stage: 'error', message: err.message });
  } finally {
    try { res.end(); } catch { /* already closed */ }
  }
});

/** 获取代码审查发现结果 */
projectsRouter.get('/:id/review-discovery', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const { getReviewDiscovery } = await import('../services/review-discovery.js');
  const result = getReviewDiscovery(req.params.id);
  res.json(result || { modules: [], summary: {} });
});

/** 获取审查规则 */
projectsRouter.get('/:id/review-rules', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const { getReviewRules } = await import('../services/review-discovery.js');
  const result = getReviewRules(req.params.id);
  res.json(result || { dimensions: [] });
});

// ========== 知识图谱发现 ==========

/** 触发知识图谱发现 — SSE 流式返回进度 */
projectsRouter.post('/:id/discover-context', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendSSE = (data: any) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  try {
    const { discoverPageContext } = await import('../services/page-context-discovery.js');
    await discoverPageContext(project.id, (progress) => { sendSSE(progress); });
    sendSSE({ stage: 'complete', message: '知识图谱生成完成' });
  } catch (err: any) {
    sendSSE({ stage: 'error', message: err.message });
  } finally {
    try { res.end(); } catch { /* already closed */ }
  }
});

/** 获取知识图谱 */
projectsRouter.get('/:id/page-context', async (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  const { getPageContext } = await import('../services/page-context-discovery.js');
  const result = getPageContext(req.params.id);
  if (!result) {
    res.json({ _meta: { totalPages: 0 }, pages: [] });
    return;
  }
  res.json(result);
});
