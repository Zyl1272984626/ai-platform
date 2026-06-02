/**
 * 代码审查发现服务
 * 调用 Claude Code 扫描源码，生成审查规则和审查发现
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig, getProjectById } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

// ========== 类型 ==========

export interface ReviewDiscoveryProgress {
  stage: 'scanning' | 'analyzing' | 'generating_rules' | 'done' | 'error';
  message: string;
  detail?: {
    currentModule?: string;
    foundModules?: number;
    generatedRules?: number;
  };
}

export interface ReviewDiscoveryResult {
  projectId: string;
  discoveredAt: string;
  summary: {
    totalFiles: number;
    totalModules: number;
    keyFiles: number;
    scanDuration: number;
  };
  projectStructure: {
    framework: string;
    language: string;
    backendFramework?: string;
    buildTool: string;
  };
  modules: {
    id: string;
    name: string;
    path: string;
    files: number;
    keyFiles: string[];
    riskLevel: string;
    reason: string;
  }[];
}

// ========== 核心函数 ==========

/**
 * 发现代码审查点并生成审查规则
 */
export async function discoverReview(
  projectId: string,
  onProgress?: (progress: ReviewDiscoveryProgress) => void,
): Promise<ReviewDiscoveryResult> {
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

  const { query } = await import('@anthropic-ai/claude-code');

  const prompt = buildReviewDiscoveryPrompt(project);

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
      if (abortController.signal.aborted) throw new Error('审查发现超时');

      if (msg.type === 'assistant' && (msg as any).message?.content) {
        for (const block of (msg as any).message.content) {
          if (block.type === 'text') {
            fullOutput += block.text;
            detectReviewProgress(fullOutput, onProgress);
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

  // 解析输出，提取 review-discovery.json 和 review-rules.json
  const { discovery, rules } = parseReviewOutput(fullOutput, projectId, Date.now() - startTime);

  // 保存
  fs.writeFileSync(
    path.join(projectDir, 'review-discovery.json'),
    JSON.stringify(discovery, null, 2), 'utf-8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'review-rules.json'),
    JSON.stringify(rules, null, 2), 'utf-8',
  );

  onProgress?.({
    stage: 'done',
    message: `发现完成: ${discovery.summary.totalModules} 模块, ${rules.dimensions?.length || 0} 审查维度`,
    detail: { foundModules: discovery.summary.totalModules, generatedRules: rules.dimensions?.length || 0 },
  });

  return discovery;
}

// ========== 辅助函数 ==========

function buildReviewDiscoveryPrompt(project: any): string {
  return `你是一个代码审查专家。请分析以下项目源码，完成两个任务：

## 任务一：发现项目结构
1. 扫描源码目录，了解项目整体架构
2. 按业务模块分组，标注每个模块的风险等级
3. 识别关键文件（核心组件、工具函数、API 层）
4. 记录技术栈（Vue 版本、语言、构建工具）

## 任务二：生成审查规则
基于项目的技术栈和业务特点，生成针对性的审查规则：
1. 安全性规则：根据项目使用的框架定制
2. 性能规则：根据项目规模和复杂度定制
3. 错误处理规则：根据 API 调用模式定制
4. 框架最佳实践：根据 Vue 3 / Pinia 定制
5. 可维护性规则：通用规则

每条规则需要包含：ID、标题、描述、严重等级、检查方式、修复建议

## 项目信息
- 项目名称: ${project.name}
- 源码路径: ${project.sourcePath}
- 前端框架: Vue 3 + Vite + Pinia

## 输出格式
请严格按照以下 JSON 格式输出（用 \`\`\`json 包裹），必须包含两个文件：

### 文件 1: review-discovery.json（项目结构）
\`\`\`json
{
  "modules": [
    {
      "id": "模块ID",
      "name": "模块名称",
      "path": "src/xxx/",
      "files": 24,
      "keyFiles": ["关键文件路径"],
      "riskLevel": "high/medium/low",
      "reason": "风险原因"
    }
  ],
  "projectStructure": {
    "framework": "Vue 3 + Vite + Pinia",
    "language": "TypeScript / JavaScript",
    "buildTool": "Vite"
  }
}
\`\`\`

### 文件 2: review-rules.json（审查规则）
\`\`\`json
{
  "dimensions": [
    {
      "id": "security",
      "name": "安全性",
      "severity": "critical",
      "enabled": true,
      "rules": [
        {
          "id": "SEC001",
          "title": "规则标题",
          "description": "规则描述",
          "suggestion": "修复建议"
        }
      ]
    }
  ],
  "ignore": {
    "patterns": ["**/node_modules/**", "**/dist/**"]
  },
  "fileLimits": {
    "maxFilesPerReview": 30,
    "maxLinesPerFile": 500
  }
}
\`\`\`

请开始分析源码。`;
}

function detectReviewProgress(output: string, onProgress?: (p: ReviewDiscoveryProgress) => void) {
  if (output.includes('扫描') || output.includes('读取')) {
    onProgress?.({ stage: 'scanning', message: '正在扫描源码目录结构...' });
  } else if (output.includes('分析') || output.includes('模块')) {
    onProgress?.({ stage: 'analyzing', message: '正在分析模块结构...' });
  } else if (output.includes('规则') || output.includes('生成')) {
    onProgress?.({ stage: 'generating_rules', message: '正在生成审查规则...' });
  }
}

function parseReviewOutput(output: string, projectId: string, duration: number): {
  discovery: ReviewDiscoveryResult;
  rules: any;
} {
  const discovery: ReviewDiscoveryResult = {
    projectId,
    discoveredAt: new Date().toISOString(),
    summary: { totalFiles: 0, totalModules: 0, keyFiles: 0, scanDuration: duration },
    projectStructure: { framework: 'Unknown', language: 'TypeScript/JavaScript', buildTool: 'Vite' },
    modules: [],
  };

  const rules: any = { dimensions: [], ignore: { patterns: ['**/node_modules/**', '**/dist/**'] }, fileLimits: { maxFilesPerReview: 30, maxLinesPerFile: 500 } };

  const jsonMatches = output.match(/```json\s*\n([\s\S]*?)```/g);
  if (jsonMatches) {
    for (const block of jsonMatches) {
      const content = block.replace(/```json\s*\n/, '').replace(/\n```$/, '').trim();
      try {
        const parsed = JSON.parse(content);
        if (parsed.modules && !parsed.dimensions) {
          // review-discovery
          discovery.modules = parsed.modules;
          discovery.projectStructure = parsed.projectStructure || discovery.projectStructure;
          discovery.summary.totalModules = parsed.modules?.length || 0;
          discovery.summary.keyFiles = parsed.modules?.reduce((s: number, m: any) => s + (m.keyFiles?.length || 0), 0) || 0;
        } else if (parsed.dimensions) {
          // review-rules
          rules.dimensions = parsed.dimensions;
          rules.ignore = parsed.ignore || rules.ignore;
          rules.fileLimits = parsed.fileLimits || rules.fileLimits;
        }
      } catch { /* not valid JSON */ }
    }
  }

  return { discovery, rules };
}

/** 获取审查发现结果 */
export function getReviewDiscovery(projectId: string): ReviewDiscoveryResult | null {
  const filePath = path.join(DATA_DIR, 'projects', projectId, 'review-discovery.json');
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

/** 获取审查规则 */
export function getReviewRules(projectId: string): any | null {
  const filePath = path.join(DATA_DIR, 'projects', projectId, 'review-rules.json');
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}
