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

  // 清理旧文件，避免 Claude Code 多读一轮旧数据
  for (const f of ['api-discovery.json', 'api-tests.json', 'discovery-log-api.json']) {
    try { fs.unlinkSync(path.join(projectDir, f)); } catch { /* 文件不存在 */ }
  }

  // 调用 Claude Code
  let fullOutput = '';
  const blocks: Array<{ type: string; content?: string; name?: string; input?: any; toolUseId?: string; result?: string; isError?: boolean }> = [];
  const abortController = new AbortController();
  // 无超时限制，让 Claude Code 自然完成
  const timer = setTimeout(() => {}, 0);

  try {
    const response = query({
      prompt,
      options: {
        cwd: project.sourcePath,
        allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
        maxTurns: 9999,
        permissionMode: 'bypassPermissions',
        abortController,
      },
    });

    for await (const msg of response) {
      if (abortController.signal.aborted) throw new Error('API 发现超时');

      switch (msg.type) {
        case 'assistant': {
          if ((msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'text') {
                fullOutput += block.text;
                onProgress?.({ type: 'text', content: block.text } as any);
                const last = blocks[blocks.length - 1];
                if (last?.type === 'text') last.content += block.text;
                else blocks.push({ type: 'text', content: block.text });
              } else if (block.type === 'tool_use') {
                onProgress?.({ type: 'tool_use', name: block.name, input: block.input, toolUseId: block.id } as any);
                blocks.push({ type: 'tool_use', name: block.name, input: block.input, toolUseId: block.id });
              }
            }
          }
          break;
        }
        case 'user': {
          if ('message' in msg && (msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'tool_result') {
                const resultContent = typeof block.content === 'string'
                  ? block.content : JSON.stringify(block.content);
                const truncated = resultContent?.slice(0, 3000);
                onProgress?.({ type: 'tool_result', toolUseId: block.tool_use_id, result: truncated, isError: block.is_error } as any);
                const toolBlock = blocks.find(b => b.type === 'tool_use' && b.toolUseId === block.tool_use_id);
                if (toolBlock) { toolBlock.result = truncated; toolBlock.isError = block.is_error; }
              }
            }
          }
          break;
        }
      }
    }

    clearTimeout(timer);
  } catch (err: any) {
    clearTimeout(timer);
    onProgress?.({ type: 'error', message: `发现失败: ${err.message}` } as any);
    throw err;
  }

  // 解析 Claude Code 输出，提取 api-discovery.json 和 api-tests.json
  onProgress?.({ type: 'stage', stage: 'generating', message: '正在解析发现结果...' } as any);

  const discoveryPath = path.join(projectDir, 'api-discovery.json');
  let discovery: ApiDiscoveryResult | undefined;

  // 策略0：检查 Claude 是否已经直接写入了文件（最可靠）
  if (fs.existsSync(discoveryPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
      if (parsed.modules && Array.isArray(parsed.modules)) {
        discovery = parsed;
        discovery!.projectId = projectId;
        discovery!.discoveredAt = discovery!.discoveredAt || new Date().toISOString();
      }
    } catch { /* 解析失败，走文本解析 */ }
  }

  // 策略1-3：文件不存在时从输出中提取
  if (!discovery) {
    discovery = parseDiscoveryOutput(fullOutput, projectId, Date.now() - startTime, blocks);
    fs.writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2), 'utf-8');
  }

  // 保存发现日志（只保留最新）
  fs.writeFileSync(path.join(projectDir, 'discovery-log-api.json'), JSON.stringify({
    savedAt: new Date().toISOString(),
    blocks,
  }), 'utf-8');

  // 生成测试定义
  onProgress?.({ type: 'stage', stage: 'generating', message: '正在生成测试定义...' } as any);
  const testConfig = generateApiTests(project, discovery!);
  const testsPath = path.join(projectDir, 'api-tests.json');
  fs.writeFileSync(testsPath, JSON.stringify(testConfig, null, 2), 'utf-8');

  onProgress?.({
    type: 'done',
    stage: 'done',
    message: `发现完成: ${discovery.summary.totalModules} 个模块, ${discovery.summary.totalEndpoints} 个接口`,
    detail: { foundModules: discovery.summary.totalModules, foundEndpoints: discovery.summary.totalEndpoints },
    parseWarning: discovery.summary.totalModules === 0,
    rawOutputPreview: discovery.summary.totalModules === 0 ? fullOutput.slice(0, 2000) : undefined,
  } as any);

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

  const outputDir = path.join(DATA_DIR, 'projects', project.id);

  // 替换模板变量
  return content
    .replace(/\{\{projectName\}\}/g, project.name)
    .replace(/\{\{sourcePath\}\}/g, project.sourcePath)
    .replace(/\{\{apiBaseUrl\}\}/g, project.apiBaseUrl)
    .replace(/\{\{loginUrl\}\}/g, project.loginUrl)
    .replace(/\{\{username\}\}/g, project.username)
    .replace(/\{\{password\}\}/g, project.password)
    .replace(/\{\{outputDir\}\}/g, outputDir.replace(/\\/g, '/'));
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

function parseDiscoveryOutput(
  output: string,
  projectId: string,
  duration: number,
  blocks?: Array<{ type: string; content?: string; name?: string; input?: any }>,
): ApiDiscoveryResult {
  // 尝试从输出中提取 api-discovery JSON
  const discovery: ApiDiscoveryResult = {
    projectId,
    discoveredAt: new Date().toISOString(),
    summary: { totalModules: 0, totalEndpoints: 0, scanDuration: duration },
    modules: [],
  };

  // 策略0：从 Write 工具的 input.content 中提取
  if (blocks) {
    for (const block of blocks) {
      if (block.type === 'tool_use' && block.name === 'Write' && block.input?.content) {
        try {
          const parsed = JSON.parse(block.input.content);
          if (parsed.modules && Array.isArray(parsed.modules) && parsed.modules[0]?.endpoints) {
            discovery.modules = parsed.modules;
            discovery.summary.totalModules = parsed.modules.length;
            discovery.summary.totalEndpoints = parsed.modules.reduce(
              (sum: number, m: any) => sum + (m.endpoints?.length || 0), 0,
            );
          }
        } catch { /* not valid JSON in Write tool */ }
      }
    }
  }

  // 策略1：从 ```json``` 代码块中提取
  const jsonMatch = output.match(/```json\s*\n([\s\S]*?)```/g);
  if (discovery.summary.totalModules === 0 && jsonMatch) {
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

  // 策略2：全文查找 JSON 对象
  if (discovery.summary.totalModules === 0) {
    const moduleMatch = output.match(/\{\s*["']modules["']\s*:\s*\[[\s\S]*?\]\s*\}/);
    if (moduleMatch) {
      try {
        const parsed = JSON.parse(moduleMatch[0]);
        if (parsed.modules?.length) {
          discovery.modules = parsed.modules;
          discovery.summary.totalModules = parsed.modules.length;
          discovery.summary.totalEndpoints = parsed.modules.reduce(
            (sum: number, m: any) => sum + (m.endpoints?.length || 0), 0,
          );
        }
      } catch { /* fallback failed */ }
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
