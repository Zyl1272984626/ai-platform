/**
 * 全局配置管理
 * 支持文件持久化 + 环境变量 + 默认值三级优先
 * 支持多项目配置
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'platform-config.json');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// ========== 类型定义 ==========

export interface PageConfig {
  id: string;
  name: string;
  url: string;
  path: string;
  description?: string;
  hasDynamicParams?: boolean;                // 路径是否含动态参数（:xxx）
  params?: Record<string, string[]>;         // 动态参数映射，如 { ":appId": ["base_app"] }
}

export interface PageSet {
  id: string;
  name: string;
  description?: string;
  entry?: string;         // 所属子应用入口
  relatedEntries?: string[]; // 关联的子应用入口
  suggestSplit?: boolean; // 建议拆分标记
  pages: PageConfig[];
}

export interface TestProject {
  id: string;
  name: string;
  baseUrl: string;
  apiBaseUrl: string;
  loginUrl: string;
  username: string;
  password: string;
  sourcePath?: string;
  skillPath?: string;
  status: 'active' | 'inactive';
  // 以下字段从独立文件读取，不再内联到主配置
  pageSets?: PageSet[];
  discoveredAt?: string;
  globalParams?: Record<string, string[]>;   // 公共动态参数，如 { ":appId": ["base_app"] }
}

export interface ClaudeConfig {
  authToken: string;      // ANTHROPIC_AUTH_TOKEN（智谱 CodePlan Token）
  baseUrl: string;        // ANTHROPIC_BASE_URL
  model: string;          // ANTHROPIC_MODEL
}

export interface PlatformConfig {
  // 基础配置
  projectRoot: string;          // 兼容旧配置
  aiPlatformRoot: string;
  e2eDataDir: string;           // 已废弃，兼容保留
  testDataDir: string;          // 统一测试数据目录（替代 e2eDataDir）
  mainFrontendPort: number;     // 兼容旧配置
  mainBackendPort: number;      // 兼容旧配置
  apiTestBaseUrl: string;

  // 多项目配置
  projects: TestProject[];
  defaultProjectId: string;

  // Claude 配置（智谱 CodePlan）
  claudeConfig?: ClaudeConfig;
}

// ========== 默认项目 ==========

function createDefaultProject(overrides?: Partial<TestProject>): TestProject {
  return {
    id: 'agent-main',
    name: '主系统(Agent)',
    baseUrl: 'http://localhost:5173',
    apiBaseUrl: 'http://localhost:9998',
    loginUrl: '/web/index.html#/login',
    username: 'fskjadmin',
    password: 'fskj_dst_2023',
    sourcePath: process.env.PROJECT_ROOT || 'C:/FengSuKeJi/agent',
    pageSets: [],
    status: 'active',
    ...overrides,
  };
}

const DEFAULT_CONFIG: PlatformConfig = {
  projectRoot: process.env.PROJECT_ROOT || 'C:/FengSuKeJi/agent',
  aiPlatformRoot: process.env.AI_PLATFORM_ROOT || 'C:/FengSuKeJi/ai-platform',
  e2eDataDir: 'F:/e2e-test-data',
  testDataDir: 'F:/e2e-test-data',
  mainFrontendPort: 5173,
  mainBackendPort: 9998,
  apiTestBaseUrl: 'http://localhost:3100',
  projects: [createDefaultProject()],
  defaultProjectId: 'agent-main',
  claudeConfig: {
    authToken: process.env.ANTHROPIC_AUTH_TOKEN || '',
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://open.bigmodel.cn/api/anthropic',
    model: process.env.ANTHROPIC_MODEL || 'glm-5.1',
  },
};

/** 运行时配置缓存 */
let config: PlatformConfig = { ...DEFAULT_CONFIG, projects: [...DEFAULT_CONFIG.projects] };

// ========== 项目独立文件读写 ==========

/** 获取项目数据目录 */
function getProjectDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId);
}

/** 项目页面数据结构 */
export interface ProjectPageData {
  pageSets: PageSet[];
  discoveredAt?: string;
  totalPages?: number;
  globalParams?: Record<string, string[]>;   // 公共动态参数
}

/** 从独立文件读取项目页面数据 */
export function loadProjectPages(projectId: string): ProjectPageData {
  const filePath = path.join(getProjectDir(projectId), 'project.json');
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e: any) {
    console.warn(`[Config] 读取项目页面数据失败 (${projectId}):`, e.message);
  }
  return { pageSets: [] };
}

/** 将项目页面数据写入独立文件 */
export function saveProjectPages(projectId: string, data: ProjectPageData): void {
  const dir = getProjectDir(projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'project.json'),
    JSON.stringify(data, null, 2),
    'utf-8',
  );
}

/** 读取项目公共参数 */
export function getGlobalParams(projectId: string): Record<string, string[]> {
  const data = loadProjectPages(projectId);
  return data.globalParams || {};
}

/** 保存项目公共参数 */
export function saveGlobalParams(projectId: string, params: Record<string, string[]>): void {
  const data = loadProjectPages(projectId);
  data.globalParams = params;
  saveProjectPages(projectId, data);
}

/** 保存原始发现数据到独立文件 */
export function saveDiscoveryResult(projectId: string, discoveryResult: any): void {
  const dir = getProjectDir(projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'discovery-result.json'),
    JSON.stringify(discoveryResult, null, 2),
    'utf-8',
  );
}

// ========== 旧配置迁移 ==========

function migrateConfig(saved: any): PlatformConfig {
  // 已有 projects 字段 → 新格式，直接用
  if (saved.projects && Array.isArray(saved.projects)) {
    // 迁移 e2eDataDir → testDataDir
    if (saved.e2eDataDir && !saved.testDataDir) {
      saved.testDataDir = saved.e2eDataDir;
    }
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      projects: saved.projects,
      defaultProjectId: saved.defaultProjectId || 'agent-main',
    };
  }

  // 旧格式：从单项目字段迁移
  console.log('[Config] 检测到旧格式配置，正在迁移为多项目格式...');
  const defaultProject = createDefaultProject({
    baseUrl: `http://localhost:${saved.mainFrontendPort || 5173}`,
    apiBaseUrl: `http://localhost:${saved.mainBackendPort || 9998}`,
    sourcePath: saved.projectRoot || DEFAULT_CONFIG.projectRoot,
  });

  // 迁移 e2eDataDir → testDataDir
  if (saved.e2eDataDir && !saved.testDataDir) {
    saved.testDataDir = saved.e2eDataDir;
  }

  return {
    ...DEFAULT_CONFIG,
    ...saved,
    projects: [defaultProject],
    defaultProjectId: defaultProject.id,
  };
}

// ========== Claude 配置注入 ==========

/** 将 claudeConfig 同步到 process.env，让 SDK 和子进程能读取 */
export function applyClaudeConfig(): void {
  const c = config.claudeConfig;
  if (!c) return;
  if (c.authToken) process.env.ANTHROPIC_AUTH_TOKEN = c.authToken;
  if (c.baseUrl) process.env.ANTHROPIC_BASE_URL = c.baseUrl;
  if (c.model) {
    process.env.ANTHROPIC_MODEL = c.model;
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = c.model;
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = c.model;
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = c.model;
    process.env.ANTHROPIC_SMALL_FAST_MODEL = c.model;
  }
  console.log(`[Config] Claude 配置已注入 (model=${c.model}, baseUrl=${c.baseUrl})`);
}

// ========== 配置加载/保存 ==========

/** 从文件加载配置 */
export function loadConfig(): PlatformConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      config = migrateConfig(saved);
      console.log('[Config] 从文件加载配置:', CONFIG_FILE);
      console.log(`[Config] 已配置 ${config.projects.length} 个项目`);

      // 自动迁移：将内联的 pageSets/discoveryResult 拆分到独立文件
      let migrated = false;
      for (const project of config.projects) {
        if ((project as any).pageSets && (project as any).pageSets.length > 0) {
          const pageData: ProjectPageData = {
            pageSets: (project as any).pageSets,
            discoveredAt: (project as any).discoveredAt,
            totalPages: (project as any).pageSets.reduce((s: number, ps: PageSet) => s + ps.pages.length, 0),
          };
          saveProjectPages(project.id, pageData);

          if ((project as any).discoveryResult) {
            saveDiscoveryResult(project.id, (project as any).discoveryResult);
          }

          // 从主配置中移除内联数据
          delete (project as any).pageSets;
          delete (project as any).discoveredAt;
          delete (project as any).discoveryResult;
          migrated = true;
        }
      }
      if (migrated) {
        saveConfig();
        console.log('[Config] 已将内联数据迁移到独立文件');
      }
    }
  } catch (e: any) {
    console.warn('[Config] 配置文件读取失败，使用默认值:', e.message);
  }
  applyClaudeConfig();
  return config;
}

/** 获取当前配置 */
export function getConfig(): PlatformConfig {
  return config;
}

/** 更新基础配置（部分更新）并持久化 */
export function updateConfig(partial: Partial<PlatformConfig>): PlatformConfig {
  config = { ...config, ...partial };
  saveConfig();
  return config;
}

/** 保存配置到文件 */
function saveConfig(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    // 同步到 process.env，让子进程也能读到
    if (config.e2eDataDir) {
      process.env.E2E_DATA_DIR = config.e2eDataDir;
    }
    if (config.testDataDir) {
      process.env.TEST_DATA_DIR = config.testDataDir;
    }
    applyClaudeConfig();
    console.log('[Config] 配置已保存');
  } catch (e: any) {
    console.error('[Config] 配置保存失败:', e.message);
  }
}

// ========== 项目管理 ==========

/** 获取所有项目（动态合并页面数据） */
export function getProjects(): TestProject[] {
  return config.projects.map(p => {
    const pageData = loadProjectPages(p.id);
    return {
      ...p,
      pageSets: pageData.pageSets,
      discoveredAt: pageData.discoveredAt || p.discoveredAt,
    };
  });
}

/** 根据 ID 获取项目（动态合并页面数据） */
export function getProjectById(id: string): TestProject | undefined {
  const p = config.projects.find(p => p.id === id);
  if (!p) return undefined;
  const pageData = loadProjectPages(p.id);
  return {
    ...p,
    pageSets: pageData.pageSets,
    discoveredAt: pageData.discoveredAt || p.discoveredAt,
    globalParams: pageData.globalParams,
  };
}

/** 获取默认项目 */
export function getDefaultProject(): TestProject | undefined {
  return config.projects.find(p => p.id === config.defaultProjectId) || config.projects[0];
}

/** 添加项目 */
export function addProject(project: Omit<TestProject, 'id' | 'pageSets'>): TestProject {
  const newProject: TestProject = {
    ...project,
    id: uuidv4().substring(0, 8),
    pageSets: [],
  };
  config.projects.push(newProject);
  saveConfig();
  return newProject;
}

/** 更新项目 */
export function updateProject(id: string, updates: Partial<TestProject>): TestProject | null {
  const idx = config.projects.findIndex(p => p.id === id);
  if (idx === -1) return null;

  // 不允许修改 id
  const { id: _id, ...safeUpdates } = updates;
  config.projects[idx] = { ...config.projects[idx], ...safeUpdates };
  saveConfig();
  return config.projects[idx];
}

/** 删除项目 */
export function deleteProject(id: string): boolean {
  const idx = config.projects.findIndex(p => p.id === id);
  if (idx === -1) return false;
  config.projects.splice(idx, 1);
  // 如果删除的是默认项目，切换到第一个
  if (config.defaultProjectId === id && config.projects.length > 0) {
    config.defaultProjectId = config.projects[0].id;
  }
  saveConfig();

  // 清理项目独立数据目录
  const projectDir = getProjectDir(id);
  try {
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  } catch (e: any) {
    console.warn(`[Config] 清理项目数据目录失败:`, e.message);
  }

  return true;
}

/** 设置默认项目 */
export function setDefaultProject(id: string): boolean {
  const project = config.projects.find(p => p.id === id);
  if (!project) return false;
  config.defaultProjectId = id;
  saveConfig();
  return true;
}

/** 更新项目的页面集（发现后更新，写入独立文件） */
export function updateProjectPages(id: string, pageSets: PageSet[], discoveryResult?: any): TestProject | null {
  const idx = config.projects.findIndex(p => p.id === id);
  if (idx === -1) return null;

  const now = new Date().toISOString();
  const totalPages = pageSets.reduce((s, ps) => s + ps.pages.length, 0);

  // 写入独立文件（保留已有的 globalParams）
  const existingData = loadProjectPages(id);
  saveProjectPages(id, { pageSets, discoveredAt: now, totalPages, globalParams: existingData.globalParams });
  if (discoveryResult) {
    saveDiscoveryResult(id, discoveryResult);
  }

  // 主配置只记录发现时间（用于列表展示）
  config.projects[idx].discoveredAt = now;
  config.projects[idx].pageSets = pageSets;
  saveConfig();
  return config.projects[idx];
}

/** 仅更新页面集数据（不更新发现结果，用于手动编辑） */
export function saveProjectPageSets(id: string, pageSets: PageSet[]): PageSet[] | null {
  const project = config.projects.find(p => p.id === id);
  if (!project) return null;

  const existing = loadProjectPages(id);
  const totalPages = pageSets.reduce((s, ps) => s + ps.pages.length, 0);
  saveProjectPages(id, {
    pageSets,
    discoveredAt: existing.discoveredAt,
    totalPages,
    globalParams: existing.globalParams,
  });

  return pageSets;
}

// ========== 配置检查 ==========

/** 检查配置项是否有效 */
export async function checkConfig(): Promise<Record<string, { ok: boolean; msg: string }>> {
  const results: Record<string, { ok: boolean; msg: string }> = {};

  // 检查路径是否存在
  for (const [key, dirPath] of [
    ['aiPlatformRoot', config.aiPlatformRoot],
    ['e2eDataDir', config.e2eDataDir],
    ['testDataDir', config.testDataDir || config.e2eDataDir],
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

  // 检查 API 地址
  try {
    const res = await fetch(config.apiTestBaseUrl + '/api/health');
    results['apiTestBaseUrl'] = { ok: res.ok, msg: `API 正常响应 (${res.status})` };
  } catch {
    results['apiTestBaseUrl'] = { ok: false, msg: `API 不可达: ${config.apiTestBaseUrl}` };
  }

  // ---- 环境检测 ----

  // Claude Code CLI
  try {
    const { execSync } = await import('child_process');
    const version = execSync('claude --version 2>&1', { timeout: 5000, encoding: 'utf-8' }).trim();
    results['claudeCode'] = { ok: true, msg: `已安装: ${version}` };
  } catch {
    results['claudeCode'] = { ok: false, msg: '未安装 Claude Code CLI，请运行: npm install -g @anthropic-ai/claude-code' };
  }

  // Claude 配置（CodePlan）
  const claudeCfg = config.claudeConfig;
  results['claudeConfig'] = {
    ok: !!(claudeCfg?.authToken),
    msg: claudeCfg?.authToken
      ? `已配置 (CodePlan, model=${claudeCfg.model || 'glm-5.1'})`
      : '未配置 Claude CodePlan Token',
  };

  // Playwright 浏览器
  try {
    const { execSync } = await import('child_process');
    const pwPath = path.resolve(config.aiPlatformRoot, 'e2e-test', 'node_modules', '.bin', 'playwright');
    const cmd = process.platform === 'win32' ? `"${pwPath}.cmd"` : pwPath;
    execSync(`${cmd} --version 2>&1`, { timeout: 10000, encoding: 'utf-8' });
    results['playwright'] = { ok: true, msg: 'Playwright 已安装' };
  } catch {
    results['playwright'] = { ok: false, msg: '未安装，请运行: cd e2e-test && npx playwright install chromium' };
  }

  return results;
}

// ========== 兼容旧代码 ==========

export const PROJECT_ROOT = config.projectRoot;
export const AI_PLATFORM_ROOT = config.aiPlatformRoot;

// 启动时自动加载
loadConfig();

// 重新导出动态值（保持向后兼容）
export { config as _runtimeConfig };
