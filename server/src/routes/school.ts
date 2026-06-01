/**
 * 学校管理路由
 */
import { Router, Request, Response } from 'express';
import * as path from 'path';
import {
  listSchools,
  getSchool,
  addSchool,
  updateSchool,
  removeSchool,
} from '../services/school-manager.js';
import {
  previewConfigs,
  generateConfigs,
} from '../services/config-generator.js';
import { buildSchoolWar } from '../services/deploy-service.js';

export const schoolRouter = Router();

// 列表
schoolRouter.get('/', (_req: Request, res: Response) => {
  res.json(listSchools());
});

// 预览配置
schoolRouter.get('/:code/preview-configs', (req: Request, res: Response) => {
  try {
    const configs = previewConfigs(req.params.code);
    res.json(configs);
  } catch (err: unknown) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// 生成配置文件
schoolRouter.post('/:code/generate-configs', (req: Request, res: Response) => {
  try {
    const configs = generateConfigs(req.params.code);
    res.json({ ok: true, files: Object.keys(configs) });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 部署：生成学校专属 WAR 包并下载
schoolRouter.post('/:code/deploy', async (req: Request, res: Response) => {
  try {
    // 先保存配置到源码
    generateConfigs(req.params.code);
    // 更新状态为 deployed
    updateSchool(req.params.code, { status: 'deployed', lastDeploy: new Date().toISOString().slice(0, 10) });
    // 自动 mvn package + 替换配置 + 输出 WAR
    const warPath = await buildSchoolWar(req.params.code);
    const fileName = path.basename(warPath);
    res.download(warPath, fileName);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 详情
schoolRouter.get('/:code', (req: Request, res: Response) => {
  const school = getSchool(req.params.code);
  if (!school) return res.status(404).json({ error: 'School not found' });
  res.json(school);
});

// 注册新学校
schoolRouter.post('/', (req: Request, res: Response) => {
  try {
    const school = addSchool(req.body);
    res.status(201).json(school);
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 更新
schoolRouter.put('/:code', (req: Request, res: Response) => {
  try {
    const school = updateSchool(req.params.code, req.body);
    res.json(school);
  } catch (err: unknown) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// 删除
schoolRouter.delete('/:code', (req: Request, res: Response) => {
  const removed = removeSchool(req.params.code);
  if (!removed) return res.status(404).json({ error: 'School not found' });
  res.json({ ok: true });
});
