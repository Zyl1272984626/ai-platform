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

  // 构建发现 prompt
  const prompt = buildDiscoveryPrompt(project);

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
  return `你是一个 API 接口分析专家。请分析以下项目的源码，找出所有 HTTP API 接口，并生成可直接执行的测试定义。

## 项目信息
- 项目名称: ${project.name}
- 源码路径: ${project.sourcePath}
- 后端 API 地址: ${project.apiBaseUrl}
- 登录页: ${project.apiBaseUrl}${project.loginUrl}
- 登录凭据: ${project.username} / ${project.password}

## 任务
1. 扫描源码中的后端路由定义（如 Express Router、Spring Controller 等）
2. 扫描前端代码中的 API 调用（如 axios.get/post、fetch 等）
3. 综合两端信息，按业务模块分组
4. 对每个接口记录：方法、路径、请求参数、响应结构、描述
5. 【关键】获取真实测试数据：
   - 先调用登录接口获取 Token
   - 调用各模块的列表接口（如 GET /api/users?page=1&size=1）
   - 从返回数据中提取真实 ID（userId、sessionId、knowledgeId 等）
   - 将这些 ID 写入 testData 字段，后续测试用 {{testData.xxx}} 引用
6. 为每个接口生成正向 + 异常测试用例（含断言）

## 测试数据获取策略
不需要人工配置参数，也不需要数据库连接。通过实际调用 API 获取：
- 列表接口 → 提取第一条数据的 ID
- 详情接口 → 用列表获取的 ID
- 创建接口 → 使用合理的测试数据
- 删除/更新接口 → 先创建再操作

## 输出格式
请严格按照以下 JSON 格式输出（用 \`\`\`json 包裹），必须包含两个文件：

### 文件 1: api-discovery.json（接口清单）
\`\`\`json
{
  "modules": [
    {
      "id": "模块ID(英文)",
      "name": "模块名称(中文)",
      "description": "模块描述",
      "endpoints": [
        {
          "id": "接口ID",
          "name": "接口名称",
          "method": "GET/POST",
          "path": "/api/xxx",
          "description": "接口描述",
          "params": {},
          "response": {}
        }
      ]
    }
  ]
}
\`\`\`

### 文件 2: api-tests.json（测试定义）
\`\`\`json
{
  "baseUrl": "${project.apiBaseUrl}",
  "authConfig": {
    "type": "loginFirst",
    "loginEndpoint": "/api/login",
    "loginBody": { "username": "${project.username}", "password": "${project.password}" },
    "tokenPath": "data.token",
    "tokenHeader": "Authorization"
  },
  "testData": {
    "userId": "从列表接口获取的真实ID"
  },
  "testModules": [
    {
      "moduleId": "模块ID",
      "moduleName": "模块名称",
      "tests": [
        {
          "id": "测试ID",
          "name": "测试名称",
          "method": "POST",
          "path": "/api/xxx",
          "body": {},
          "needAuth": true,
          "expect": {
            "status": 200,
            "body": { "code": 200 }
          }
        }
      ]
    }
  ]
}
\`\`\`

请开始分析源码并输出结果。`;
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
