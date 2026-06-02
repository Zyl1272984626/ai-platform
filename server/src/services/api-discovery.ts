/**
 * API 接口发现服务
 * 调用 Claude Code 扫描源码，发现所有 HTTP API 接口并生成可执行测试定义
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig, getProjectById } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

// ========== 类型 ==========

export interface ApiDiscoveryProgress {
  stage: 'scanning' | 'analyzing' | 'generating' | 'fetching_data' | 'done' | 'error';
  message: string;
  detail?: {
    currentFile?: string;
    foundModules?: number;
    foundEndpoints?: number;
  };
}

export interface ApiDiscoveryResult {
  projectId: string;
  discoveredAt: string;
  summary: {
    totalModules: number;
    totalEndpoints: number;
    scanDuration: number;
  };
  modules: {
    id: string;
    name: string;
    description: string;
    sourcePath?: string;
    endpoints: {
      id: string;
      name: string;
      method: string;
      path: string;
      description: string;
      params?: Record<string, string>;
      response?: { code: number; data?: any };
    }[];
  }[];
}

// ========== 核心函数 ==========

/**
 * 发现 API 接口
 * @param projectId 项目 ID
 * @param onProgress SSE 进度回调
 */
export async function discoverApi(
  projectId: string,
  onProgress?: (progress: ApiDiscoveryProgress) => void,
): Promise<ApiDiscoveryResult> {
  const project = getProjectById(projectId);
  if (!project) {
    onProgress?.({ stage: 'error', message: `项目不存在: ${projectId}` });
    throw new Error(`项目不存在: ${projectId}`);
  }

  if (!project.sourcePath) {
    onProgress?.({ stage: 'error', message: '项目未配置源码路径' });
    throw new Error('项目未配置源码路径');
  }

  const startTime = Date.now();
  onProgress?.({ stage: 'scanning', message: '正在启动 Claude Code 扫描源码...' });

  // 动态导入 Claude Code SDK
  const { query } = await import('@anthropic-ai/claude-code');

  // 从 Skill 文件加载 prompt
  const skillPrompt = loadSkillPrompt('api-discovery', project);
  const prompt = skillPrompt;

  const projectDir = path.join(DATA_DIR, 'projects', projectId);
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  // 调用 Claude Code
  let fullOutput = '';
  const abortController = new AbortController();
  const totalTimeout = 10 * 60 * 1000; // 10 分钟
  const timer = setTimeout(() => abortController.abort(), totalTimeout);

  try {
    const response = query({
      prompt,
      options: {
        cwd: project.sourcePath,
        allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write'],
        maxTurns: 80,
        permissionMode: 'bypassPermissions',
        abortController,
      },
    });

    for await (const msg of response) {
      if (abortController.signal.aborted) throw new Error('API 发现超时');

      if (msg.type === 'assistant' && (msg as any).message?.content) {
        for (const block of (msg as any).message.content) {
          if (block.type === 'text') {
            fullOutput += block.text;
            // 检测进度关键词
            detectProgress(fullOutput, onProgress);
          }
        }
      }
    }

    clearTimeout(timer);
  } catch (err: any) {
    clearTimeout(timer);
    onProgress?.({ stage: 'error', message: `发现失败: ${err.message}` });
    throw err;
  }

  // 解析 Claude Code 输出，提取 api-discovery.json 和 api-tests.json
  onProgress?.({ stage: 'generating', message: '正在解析发现结果...' });

  const discovery = parseDiscoveryOutput(fullOutput, projectId, Date.now() - startTime);

  // 保存发现结果
  const discoveryPath = path.join(projectDir, 'api-discovery.json');
  fs.writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2), 'utf-8');

  // 生成测试定义
  onProgress?.({ stage: 'generating', message: '正在生成测试定义...' });
  const testConfig = generateApiTests(project, discovery);
  const testsPath = path.join(projectDir, 'api-tests.json');
  fs.writeFileSync(testsPath, JSON.stringify(testConfig, null, 2), 'utf-8');

  onProgress?.({
    stage: 'done',
    message: `发现完成: ${discovery.summary.totalModules} 个模块, ${discovery.summary.totalEndpoints} 个接口`,
    detail: { foundModules: discovery.summary.totalModules, foundEndpoints: discovery.summary.totalEndpoints },
  });

  return discovery;
}

// ========== 辅助函数 ==========

function buildDiscoveryPrompt(project: any): string {
  // 已废弃，保留空实现
  return '';
}

/** 从 Skill 文件加载 prompt，替换模板变量 */
function loadSkillPrompt(skillName: string, project: any): string {
  const config = getConfig();
  const skillPath = path.resolve(config.aiPlatformRoot, 'skills', 'tests', skillName, 'SKILL.md');

  let content = '';
  try {
    content = fs.readFileSync(skillPath, 'utf-8');
    // 去掉 frontmatter
    content = content.replace(/^---[\s\S]*?---\n*/, '');
  } catch {
    content = buildDiscoveryPrompt(project);
  }

  // 替换模板变量
  return content
    .replace(/\{\{projectName\}\}/g, project.name)
    .replace(/\{\{sourcePath\}\}/g, project.sourcePath)
    .replace(/\{\{apiBaseUrl\}\}/g, project.apiBaseUrl)
    .replace(/\{\{loginUrl\}\}/g, project.loginUrl)
    .replace(/\{\{username\}\}/g, project.username)
    .replace(/\{\{password\}\}/g, project.password);
}

function detectProgress(output: string, onProgress?: (p: ApiDiscoveryProgress) => void) {
  if (output.includes('扫描') || output.includes('读取')) {
    onProgress?.({ stage: 'scanning', message: '正在扫描源码中的路由定义...' });
  } else if (output.includes('分组') || output.includes('模块')) {
    onProgress?.({ stage: 'analyzing', message: '正在分析接口模块结构...' });
  } else if (output.includes('测试') && output.includes('生成')) {
    onProgress?.({ stage: 'generating', message: '正在生成测试定义...' });
  } else if (output.includes('调用') || output.includes('获取')) {
    onProgress?.({ stage: 'fetching_data', message: '正在获取真实测试数据...' });
  }
}

function parseDiscoveryOutput(output: string, projectId: string, duration: number): ApiDiscoveryResult {
  // 尝试从输出中提取 api-discovery JSON
  const jsonMatch = output.match(/```json\s*\n([\s\S]*?)```/g);
  const discovery: ApiDiscoveryResult = {
    projectId,
    discoveredAt: new Date().toISOString(),
    summary: { totalModules: 0, totalEndpoints: 0, scanDuration: duration },
    modules: [],
  };

  if (jsonMatch) {
    for (const block of jsonMatch) {
      const content = block.replace(/```json\s*\n/, '').replace(/\n```$/, '').trim();
      try {
        const parsed = JSON.parse(content);
        if (parsed.modules && Array.isArray(parsed.modules)) {
          discovery.modules = parsed.modules;
          discovery.summary.totalModules = parsed.modules.length;
          discovery.summary.totalEndpoints = parsed.modules.reduce(
            (sum: number, m: any) => sum + (m.endpoints?.length || 0), 0,
          );
          break;
        }
      } catch { /* not valid JSON for discovery */ }
    }
  }

  // 如果没有解析到任何模块，返回空结果
  return discovery;
}

function generateApiTests(project: any, discovery: ApiDiscoveryResult): any {
  const testConfig: any = {
    projectId: discovery.projectId,
    generatedAt: new Date().toISOString(),
    baseUrl: project.apiBaseUrl,
    authConfig: {
      type: 'loginFirst',
      loginEndpoint: '/api/login',
      loginBody: { username: project.username, password: project.password },
      tokenPath: 'data.token',
      tokenHeader: 'Authorization',
    },
    testData: {},
    testModules: [],
  };

  for (const mod of discovery.modules) {
    const testModule: any = {
      moduleId: mod.id,
      moduleName: mod.name,
      tests: [],
    };

    for (const ep of mod.endpoints) {
      testModule.tests.push({
        id: ep.id,
        name: `${ep.name} - 正常请求`,
        method: ep.method,
        path: ep.path,
        needAuth: true,
        expect: {
          status: 200,
          body: { code: 200 },
        },
      });
    }

    testConfig.testModules.push(testModule);
  }

  return testConfig;
}

/** 获取已保存的 API 发现结果 */
export function getApiDiscovery(projectId: string): ApiDiscoveryResult | null {
  const filePath = path.join(DATA_DIR, 'projects', projectId, 'api-discovery.json');
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

/** 获取已保存的 API 测试定义 */
export function getApiTests(projectId: string): any | null {
  const filePath = path.join(DATA_DIR, 'projects', projectId, 'api-tests.json');
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}
