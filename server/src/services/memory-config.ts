/**
 * 冷库配置服务
 *
 * 存储结构：
 *   server/data/memory/config.json
 *
 * 设计参考：config.ts 的"内存缓存 + 同步 fs 读写 + import 即初始化"模式，
 * 独立实现 fs 读写（与 config.ts 路线一致，不复用 memory-store 私有工具）。
 *
 * 暴露：getMemoryConfig / updateMemoryConfig / loadMemoryConfig
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.resolve(__dirname, '../../data/memory');
const CONFIG_FILE = path.join(MEMORY_DIR, 'config.json');

// ========== 类型定义 ==========

export interface MemoryConfig {
  /** 是否在 Chat 发送前自动注入召回记忆 */
  autoInject: boolean;
  /** 服务启动时是否轻量跑一次自动化（扫描 + 生成候选） */
  startupAutomation: boolean;
  /** 召回返回的记忆条数上限 */
  recallLimit: number;
  /** 召回时是否允许 candidate 状态的记忆参与 */
  includeCandidatesInRecall: boolean;
  /** 注入到根 AI 的最大 token 数（粗略按 1 token ≈ 4 字符估算） */
  maxInjectionTokens: number;
}

const DEFAULT_CONFIG: MemoryConfig = {
  autoInject: true,
  startupAutomation: true,
  recallLimit: 10,
  includeCandidatesInRecall: false,
  maxInjectionTokens: 4000,
};

/**
 * 允许通过 updateMemoryConfig 修改的字段白名单。
 * 防止前端传入任意键污染配置。
 */
const ALLOWED_KEYS: ReadonlyArray<keyof MemoryConfig> = [
  'autoInject',
  'startupAutomation',
  'recallLimit',
  'includeCandidatesInRecall',
  'maxInjectionTokens',
];

// ========== 工具方法 ==========

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    /* ignore parse errors */
  }
  return fallback;
}

function writeJsonFile(filePath: string, data: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/** 合并文件配置与默认值，保证新增字段总有兜底；同时剔除非法键 */
function normalize(raw: Partial<MemoryConfig> | null): MemoryConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  const out: MemoryConfig = { ...DEFAULT_CONFIG };
  for (const key of ALLOWED_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === 'recallLimit' || key === 'maxInjectionTokens') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        out[key] = Math.floor(value);
      }
    } else {
      if (typeof value === 'boolean') {
        (out[key] as boolean) = value;
      }
    }
  }
  return out;
}

// ========== 运行时缓存 ==========

let cache: MemoryConfig = { ...DEFAULT_CONFIG };

// ========== 对外 API ==========

export function loadMemoryConfig(): MemoryConfig {
  cache = normalize(readJsonFile<Partial<MemoryConfig> | null>(CONFIG_FILE, null));
  // 首次加载或字段缺失时回写一次，保证文件结构稳定
  writeJsonFile(CONFIG_FILE, cache);
  return cache;
}

export function getMemoryConfig(): MemoryConfig {
  return cache;
}

export function updateMemoryConfig(partial: Partial<MemoryConfig>): MemoryConfig {
  const next = normalize({ ...cache, ...partial });
  cache = next;
  writeJsonFile(CONFIG_FILE, next);
  return next;
}

// ========== 初始化（import 即生效，确保文件存在） ==========

loadMemoryConfig();
