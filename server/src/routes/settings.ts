/**
 * 系统设置 API
 */
import { Router, type Request, type Response } from 'express';
import { getConfig, updateConfig, checkConfig, type PlatformConfig } from '../services/config.js';

export const settingsRouter = Router();

/** 获取当前配置 */
settingsRouter.get('/', (_req: Request, res: Response) => {
  res.json(getConfig());
});

/** 更新配置 */
settingsRouter.post('/', (req: Request, res: Response) => {
  const partial = req.body as Partial<PlatformConfig>;

  // 类型校验
  if (partial.mainFrontendPort !== undefined && typeof partial.mainFrontendPort !== 'number') {
    res.status(400).json({ error: 'mainFrontendPort 必须为数字' });
    return;
  }
  if (partial.mainBackendPort !== undefined && typeof partial.mainBackendPort !== 'number') {
    res.status(400).json({ error: 'mainBackendPort 必须为数字' });
    return;
  }

  const updated = updateConfig(partial);
  res.json(updated);
});

/** 检查配置有效性 */
settingsRouter.get('/check', async (_req: Request, res: Response) => {
  try {
    const results = await checkConfig();
    res.json(results);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
