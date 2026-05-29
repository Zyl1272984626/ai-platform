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
  type TestProject,
} from '../services/config.js';

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
projectsRouter.put('/:id', (req: Request, res: Response) => {
  const updated = updateProject(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json({ ...updated, password: '******' });
});

/** 删除项目 */
projectsRouter.delete('/:id', (req: Request, res: Response) => {
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

/** 手动更新项目的页面集 */
projectsRouter.put('/:id/pages', (req: Request, res: Response) => {
  const { pageSets } = req.body;
  if (!Array.isArray(pageSets)) {
    res.status(400).json({ error: 'pageSets 必须为数组' });
    return;
  }

  const updated = updateProjectPages(req.params.id, pageSets);
  if (!updated) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json(updated.pageSets);
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

// ========== 页面发现（触发） ==========

/** 触发页面发现 — 返回 task ID，进度通过 SSE 推送 */
projectsRouter.post('/:id/discover', (req: Request, res: Response) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  // 发现逻辑在 page-discovery.ts 中实现
  // 这里先返回确认，实际发现通过 SSE stream 接口
  res.json({
    projectId: project.id,
    message: '请使用 SSE 接口监听发现进度: GET /api/projects/:id/discover/stream',
  });
});
