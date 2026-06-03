/**
 * 系统设置 API
 */
import { Router, type Request, type Response } from 'express';
import { getConfig, updateConfig, checkConfig, applyClaudeConfig, type PlatformConfig } from '../services/config.js';

export const settingsRouter = Router();

/** 获取当前配置 */
settingsRouter.get('/', (_req: Request, res: Response) => {
  res.json(getConfig());
});

/** 更新配置 */
settingsRouter.post('/', (req: Request, res: Response) => {
  const partial = req.body as Partial<PlatformConfig>;
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

/** 测试 Claude 连接（先保存再测试） */
settingsRouter.post('/test-claude', async (req: Request, res: Response) => {
  try {
    // 先保存传入的 claudeConfig（如果有）
    if (req.body.claudeConfig) {
      updateConfig({ claudeConfig: req.body.claudeConfig });
    }

    const config = getConfig();
    const claudeCfg = config.claudeConfig;
    if (!claudeCfg?.authToken) {
      res.json({ ok: false, msg: '未配置 Token' });
      return;
    }

    const baseUrl = claudeCfg.baseUrl || 'https://open.bigmodel.cn/api/anthropic';
    const model = claudeCfg.model || 'glm-5.1';

    // 发一个最小的 messages 请求来验证 Token
    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeCfg.authToken,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data: any = await resp.json();

    if (resp.ok && data.content) {
      res.json({
        ok: true,
        msg: `连接成功 (model=${model}, response=${(data.content[0]?.text || '').slice(0, 30)})`,
      });
    } else {
      const errMsg = data.error?.message || data.message || JSON.stringify(data);
      res.json({
        ok: false,
        msg: `${resp.status} ${errMsg}`.slice(0, 200),
      });
    }
  } catch (e: any) {
    res.json({ ok: false, msg: '连接失败: ' + (e.message || String(e)) });
  }
});
