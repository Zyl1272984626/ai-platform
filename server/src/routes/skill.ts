/**
 * Skill 管理路由
 */
import { Router, Request, Response } from 'express';
import { listSkills, getSkill } from '../services/skill-registry.js';

export const skillRouter = Router();

// Skill 列表
skillRouter.get('/', (_req: Request, res: Response) => {
  const skills = listSkills().map((s) => ({
    name: s.name,
    description: s.description,
    type: s.type,
    tags: s.tags,
    dependencies: s.dependencies,
  }));
  res.json(skills);
});

// Skill 详情
skillRouter.get('/:name', (req: Request, res: Response) => {
  const skill = getSkill(req.params.name);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  res.json(skill);
});
