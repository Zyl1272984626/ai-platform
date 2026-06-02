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

  const prompt = loadSkillPrompt('review-discovery', project);

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
    content = content.replace(/^---[\s\S]*?---\n*/, '');
  } catch {
    content = buildReviewDiscoveryPrompt(project);
  }

  return content
    .replace(/\{\{projectName\}\}/g, project.name)
    .replace(/\{\{sourcePath\}\}/g, project.sourcePath);
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
