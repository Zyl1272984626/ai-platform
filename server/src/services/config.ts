/**
 * 全局配置管理
 * 支持文件持久化 + 环境变量 + 默认值三级优先
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'platform-config.json');

export interface PlatformConfig {
  projectRoot: string;
  aiPlatformRoot: string;
  e2eDataDir: string;
  mainFrontendPort: number;
  mainBackendPort: number;
  apiTestBaseUrl: string;
}

const DEFAULT_CONFIG: PlatformConfig = {
  projectRoot: process.env.PROJECT_ROOT || 'C:/FengSuKeJi/agent',
  aiPlatformRoot: process.env.AI_PLATFORM_ROOT || 'C:/FengSuKeJi/ai-platform',
  e2eDataDir: 'F:/e2e-test-data',
  mainFrontendPort: 5173,
  mainBackendPort: 9998,
  apiTestBaseUrl: 'http://localhost:3100',
};

/** 运行时配置缓存 */
let config: PlatformConfig = { ...DEFAULT_CONFIG };

/** 从文件加载配置 */
export function loadConfig(): PlatformConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      // 合并：文件值 > 环境变量 > 默认值
      config = {
        projectRoot: process.env.PROJECT_ROOT || saved.projectRoot || DEFAULT_CONFIG.projectRoot,
        aiPlatformRoot: process.env.AI_PLATFORM_ROOT || saved.aiPlatformRoot || DEFAULT_CONFIG.aiPlatformRoot,
        e2eDataDir: saved.e2eDataDir || DEFAULT_CONFIG.e2eDataDir,
        mainFrontendPort: saved.mainFrontendPort ?? DEFAULT_CONFIG.mainFrontendPort,
        mainBackendPort: saved.mainBackendPort ?? DEFAULT_CONFIG.mainBackendPort,
        apiTestBaseUrl: saved.apiTestBaseUrl || DEFAULT_CONFIG.apiTestBaseUrl,
      };
      console.log('[Config] 从文件加载配置:', CONFIG_FILE);
    }
  } catch (e: any) {
    console.warn('[Config] 配置文件读取失败，使用默认值:', e.message);
  }
  return config;
}

/** 获取当前配置 */
export function getConfig(): PlatformConfig {
  return config;
}

/** 更新配置（部分更新）并持久化 */
export function updateConfig(partial: Partial<PlatformConfig>): PlatformConfig {
  config = { ...config, ...partial };
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[Config] 配置已保存');
  } catch (e: any) {
    console.error('[Config] 配置保存失败:', e.message);
  }
  return config;
}

/** 检查配置项是否有效 */
export async function checkConfig(): Promise<Record<string, { ok: boolean; msg: string }>> {
  const results: Record<string, { ok: boolean; msg: string }> = {};

  // 检查路径是否存在
  for (const [key, dirPath] of [
    ['projectRoot', config.projectRoot],
    ['aiPlatformRoot', config.aiPlatformRoot],
    ['e2eDataDir', config.e2eDataDir],
  ] as [string, string][]) {
    try {
      results[key] = {
        ok: fs.existsSync(dirPath),
        msg: fs.existsSync(dirPath) ? `路径存在: ${dirPath}` : `路径不存在: ${dirPath}`,
      };
    } catch {
      results[key] = { ok: false, msg: `无法访问: ${dirPath}` };
    }
  }

  // 检查 Skill 文件
  const skillPath = path.resolve(config.projectRoot, '.claude', 'skills', 'e2e-page-test', 'SKILL.md');
  results['e2eSkill'] = {
    ok: fs.existsSync(skillPath),
    msg: fs.existsSync(skillPath) ? 'Skill 文件存在' : `未找到: ${skillPath}`,
  };

  // 检查端口（异步）
  const { default: net } = await import('net');
  for (const [key, port] of [
    ['mainFrontendPort', config.mainFrontendPort],
    ['mainBackendPort', config.mainBackendPort],
  ] as [string, number][]) {
    results[key] = await new Promise(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      socket.on('connect', () => { socket.destroy(); resolve({ ok: true, msg: `端口 ${port} 可达` }); });
      socket.on('error', () => resolve({ ok: false, msg: `端口 ${port} 未响应` }));
      socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, msg: `端口 ${port} 超时` }); });
      socket.connect(port, 'localhost');
    });
  }

  // 检查 API 地址
  try {
    const res = await fetch(config.apiTestBaseUrl + '/api/health');
    results['apiTestBaseUrl'] = { ok: res.ok, msg: `API 正常响应 (${res.status})` };
  } catch {
    results['apiTestBaseUrl'] = { ok: false, msg: `API 不可达: ${config.apiTestBaseUrl}` };
  }

  return results;
}

// 兼容旧代码的导出（从配置中读取）
export const PROJECT_ROOT = config.projectRoot;
export const AI_PLATFORM_ROOT = config.aiPlatformRoot;

// 启动时自动加载
loadConfig();

// 重新导出动态值（保持向后兼容）
export { config as _runtimeConfig };
