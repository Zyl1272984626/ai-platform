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

  const prompt = loadSkillPrompt('frontend-discovery', project);

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
    content = buildFrontendDiscoveryPrompt(project);
  }

  return content
    .replace(/\{\{projectName\}\}/g, project.name)
    .replace(/\{\{sourcePath\}\}/g, project.sourcePath);
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
