/**
 * 学校管理路由
 * 支持学校 CRUD + 项目级 CRUD + 项目级部署。
 * 遵循 AGENTS.md：写操作用 POST，通过路径区分（/update、/delete 等）。
 */
import { Router, Request, Response } from 'express';
import * as path from 'path';
import {
  listSchools,
  getSchool,
  addSchool,
  updateSchool,
  removeSchool,
  addProject,
  updateProject,
  removeProject,
} from '../services/school-manager.js';
import { buildSchoolWar, buildSchoolDeployPackage, buildProjectWar, buildProjectDeployPackage } from '../services/deploy-service.js';
import type { DeployScriptParams } from '../services/deploy-script-generator.js';

export const schoolRouter = Router();

/** 标记部署成功（更新 school + project 状态） */
function markDeployed(code: string, projectCode?: string): void {
  const today = new Date().toISOString().slice(0, 10);
  if (projectCode) {
    updateProject(code, projectCode, { status: 'deployed', lastDeploy: today });
  }
  updateSchool(code, { status: 'deployed', lastDeploy: today });
}

// ========== 学校级 ==========

// 列表
schoolRouter.get('/', (_req: Request, res: Response) => {
  res.json(listSchools());
});

// 详情
schoolRouter.get('/:code', (req: Request, res: Response) => {
  const school = getSchool(req.params.code);
  if (!school) return res.status(404).json({ error: 'School not found' });
  res.json(school);
});

// 注册新学校（可带初始 projects）
schoolRouter.post('/', (req: Request, res: Response) => {
  try {
    const school = addSchool(req.body);
    res.status(201).json(school);
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 更新学校（整体覆盖，含 projects）
schoolRouter.post('/:code/update', (req: Request, res: Response) => {
  try {
    const school = updateSchool(req.params.code, req.body);
    res.json(school);
  } catch (err: unknown) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// 删除学校
schoolRouter.post('/:code/delete', (req: Request, res: Response) => {
  const removed = removeSchool(req.params.code);
  if (!removed) return res.status(404).json({ error: 'School not found' });
  res.json({ ok: true });
});

// ========== 项目级 ==========

// 给学校添加项目
schoolRouter.post('/:code/projects', (req: Request, res: Response) => {
  try {
    const school = addProject(req.params.code, req.body);
    res.status(201).json(school);
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 更新某项目配置
schoolRouter.post('/:code/projects/:pcode/update', (req: Request, res: Response) => {
  try {
    const school = updateProject(req.params.code, req.params.pcode, req.body);
    res.json(school);
  } catch (err: unknown) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// 移除某项目
schoolRouter.post('/:code/projects/:pcode/delete', (req: Request, res: Response) => {
  try {
    const school = removeProject(req.params.code, req.params.pcode);
    res.json(school);
  } catch (err: unknown) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// 项目部署：生成项目专属 WAR 包并下载
schoolRouter.post('/:code/projects/:pcode/deploy', async (req: Request, res: Response) => {
  try {
    markDeployed(req.params.code, req.params.pcode);
    const warPath = await buildProjectWar(req.params.code, req.params.pcode);
    const fileName = path.basename(warPath);
    res.download(warPath, fileName);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 项目部署（完整包）：WAR + 脚本 + 项目专属资源，打包 ZIP
schoolRouter.post('/:code/projects/:pcode/deploy-full', async (req: Request, res: Response) => {
  try {
    const params = req.body as DeployScriptParams;
    markDeployed(req.params.code, req.params.pcode);
    const zipPath = await buildProjectDeployPackage(req.params.code, req.params.pcode, params);
    const fileName = path.basename(zipPath);
    res.download(zipPath, fileName);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ========== 兼容旧端点（默认 agent project）==========

// 旧：生成学校专属 WAR
schoolRouter.post('/:code/deploy', async (req: Request, res: Response) => {
  try {
    markDeployed(req.params.code);
    const warPath = await buildSchoolWar(req.params.code);
    const fileName = path.basename(warPath);
    res.download(warPath, fileName);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 旧：生成完整部署包
schoolRouter.post('/:code/deploy-full', async (req: Request, res: Response) => {
  try {
    const params = req.body as DeployScriptParams;
    markDeployed(req.params.code);
    const zipPath = await buildSchoolDeployPackage(req.params.code, params);
    const fileName = path.basename(zipPath);
    res.download(zipPath, fileName);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 旧：PUT/DELETE 兼容（前端 schools.ts 仍在用）
schoolRouter.put('/:code', (req: Request, res: Response) => {
  try {
    const school = updateSchool(req.params.code, req.body);
    res.json(school);
  } catch (err: unknown) {
    res.status(404).json({ error: (err as Error).message });
  }
});

schoolRouter.delete('/:code', (req: Request, res: Response) => {
  const removed = removeSchool(req.params.code);
  if (!removed) return res.status(404).json({ error: 'School not found' });
  res.json({ ok: true });
});
