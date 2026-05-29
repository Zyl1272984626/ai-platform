/**
 * 学校管理路由
 */
import { Router, Request, Response } from 'express';
import {
  listSchools,
  getSchool,
  addSchool,
  updateSchool,
  removeSchool,
} from '../services/school-manager.js';

export const schoolRouter = Router();

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
