/**
 * 前端单元测试发现服务
 * 调用 Claude Code 扫描源码中的 Vue 组件/工具函数/Store，发现可测试单元
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig, getProjectById } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

// ========== 类型 ==========

export interface FrontendDiscoveryProgress {
  stage: 'scanning' | 'analyzing' | 'generating' | 'done' | 'error';
  message: string;
  detail?: {
    currentFile?: string;
    foundUtils?: number;
    foundComponents?: number;
    foundStores?: number;
  };
}

export interface FrontendDiscoveryResult {
  projectId: string;
  discoveredAt: string;
  summary: {
    totalModules: number;
    totalTestTargets: number;
    scanDuration: number;
  };
  modules: {
    id: string;
    name: string;
    description: string;
    files: {
      path: string;
      exports: string[];
      description: string;
      complexity: string;
      functions?: { name: string; params: string[]; description: string }[];
      testableLogic?: string[];
    }[];
  }[];
}

// ========== 核心函数 ==========

/**
 * 发现前端可测试单元
 */
export async function discoverFrontend(
  projectId: string,
  onProgress?: (progress: FrontendDiscoveryProgress) => void,
): Promise<FrontendDiscoveryResult> {
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
  onProgress?.({ stage: 'scanning', message: '正在启动 Claude Code 扫描前端源码...' });

  const { query } = await import('@anthropic-ai/claude-code');

  const prompt = buildFrontendDiscoveryPrompt(project);

  const projectDir = path.join(DATA_DIR, 'projects', projectId);
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  let fullOutput = '';
  const abortController = new AbortController();
  const totalTimeout = 10 * 60 * 1000;
  const timer = setTimeout(() => abortController.abort(), totalTimeout);

  try {
    const response = query({
      prompt,
      options: {
        cwd: project.sourcePath,
        allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
        maxTurns: 80,
        permissionMode: 'bypassPermissions',
        abortController,
      },
    });

    for await (const msg of response) {
      if (abortController.signal.aborted) throw new Error('前端发现超时');

      if (msg.type === 'assistant' && (msg as any).message?.content) {
        for (const block of (msg as any).message.content) {
          if (block.type === 'text') {
            fullOutput += block.text;
            detectFrontendProgress(fullOutput, onProgress);
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

  onProgress?.({ stage: 'analyzing', message: '正在解析发现结果...' });

  const discovery = parseFrontendOutput(fullOutput, projectId, Date.now() - startTime);

  const discoveryPath = path.join(projectDir, 'frontend-discovery.json');
  fs.writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2), 'utf-8');

  onProgress?.({
    stage: 'done',
    message: `发现完成: ${discovery.summary.totalModules} 类, ${discovery.summary.totalTestTargets} 个可测试目标`,
    detail: { foundUtils: discovery.summary.totalTestTargets },
  });

  return discovery;
}

// ========== 辅助函数 ==========

function buildFrontendDiscoveryPrompt(project: any): string {
  return `你是一个前端代码分析专家。请分析以下项目的前端源码，找出所有可测试的单元。

## 项目信息
- 项目名称: ${project.name}
- 源码路径: ${project.sourcePath}
- 前端框架: Vue 3 + Vite + Pinia

## 任务
1. 扫描 src/ 目录下的 .vue/.ts/.js 文件
2. 按 4 个类别分组：
   - utils: 纯工具函数（无 DOM 依赖，最易测试）
   - components: Vue 组件中的计算属性、事件处理逻辑
   - stores: Pinia/Vuex Store 的 actions/getters
   - pages: 页面级交互逻辑
3. 对每个文件记录：导出函数/组件、可测试逻辑、复杂度

## 注意
- 优先选择有明确输入输出的函数（最容易写单元测试）
- 跳过纯 UI 展示组件（无逻辑，不适合单元测试）
- 标注复杂度：low（纯函数）/ medium（有状态）/ high（有副作用）

## 输出格式
请严格按照以下 JSON 格式输出（用 \`\`\`json 包裹）：

\`\`\`json
{
  "modules": [
    {
      "id": "utils",
      "name": "工具函数",
      "description": "纯逻辑函数，无 DOM 依赖，适合单元测试",
      "files": [
        {
          "path": "src/utils/xxx.ts",
          "exports": ["functionName"],
          "description": "函数描述",
          "complexity": "low",
          "functions": [
            { "name": "functionName", "params": ["param1"], "description": "功能描述" }
          ]
        }
      ]
    },
    {
      "id": "components",
      "name": "Vue 组件",
      "description": "含计算属性、事件处理的 Vue 组件",
      "files": [
        {
          "path": "src/components/Xxx.vue",
          "exports": ["default"],
          "description": "组件描述",
          "complexity": "medium",
          "testableLogic": ["逻辑1", "逻辑2"]
        }
      ]
    },
    {
      "id": "stores",
      "name": "状态管理",
      "description": "Pinia/Vuex Store",
      "files": []
    },
    {
      "id": "pages",
      "name": "页面交互逻辑",
      "description": "多组件协同的页面级逻辑",
      "files": []
    }
  ]
}
\`\`\`

请开始分析源码。`;
}

function detectFrontendProgress(output: string, onProgress?: (p: FrontendDiscoveryProgress) => void) {
  if (output.includes('扫描') || output.includes('读取')) {
    onProgress?.({ stage: 'scanning', message: '正在扫描 .vue/.ts/.js 文件...' });
  } else if (output.includes('分析') || output.includes('分组')) {
    onProgress?.({ stage: 'analyzing', message: '正在分析可测试性...' });
  } else if (output.includes('生成')) {
    onProgress?.({ stage: 'generating', message: '正在生成发现结果...' });
  }
}

function parseFrontendOutput(output: string, projectId: string, duration: number): FrontendDiscoveryResult {
  const result: FrontendDiscoveryResult = {
    projectId,
    discoveredAt: new Date().toISOString(),
    summary: { totalModules: 0, totalTestTargets: 0, scanDuration: duration },
    modules: [],
  };

  const jsonMatch = output.match(/```json\s*\n([\s\S]*?)```/g);
  if (jsonMatch) {
    for (const block of jsonMatch) {
      const content = block.replace(/```json\s*\n/, '').replace(/\n```$/, '').trim();
      try {
        const parsed = JSON.parse(content);
        if (parsed.modules && Array.isArray(parsed.modules)) {
          result.modules = parsed.modules;
          result.summary.totalModules = parsed.modules.length;
          result.summary.totalTestTargets = parsed.modules.reduce(
            (sum: number, m: any) => sum + (m.files?.length || 0), 0,
          );
          break;
        }
      } catch { /* not valid JSON */ }
    }
  }

  return result;
}

/** 获取已保存的前端发现结果 */
export function getFrontendDiscovery(projectId: string): FrontendDiscoveryResult | null {
  const filePath = path.join(DATA_DIR, 'projects', projectId, 'frontend-discovery.json');
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}
