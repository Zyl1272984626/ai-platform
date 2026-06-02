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

  // 清理旧文件，避免 Claude Code 多读一轮旧数据
  for (const f of ['frontend-discovery.json', 'discovery-log-frontend.json']) {
    try { fs.unlinkSync(path.join(projectDir, f)); } catch { /* 文件不存在 */ }
  }

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
      if (abortController.signal.aborted) throw new Error('前端发现超时');

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

  onProgress?.({ type: 'stage', stage: 'analyzing', message: '正在解析发现结果...' } as any);

  const discoveryPath = path.join(projectDir, 'frontend-discovery.json');
  let discovery: FrontendDiscoveryResult | undefined;

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

  // 策略1-2：文件不存在时从输出中提取
  if (!discovery) {
    discovery = parseFrontendOutput(fullOutput, projectId, Date.now() - startTime, blocks);
    fs.writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2), 'utf-8');
  }

  // 保存发现日志（只保留最新）
  fs.writeFileSync(path.join(projectDir, 'discovery-log-frontend.json'), JSON.stringify({
    savedAt: new Date().toISOString(),
    blocks,
  }), 'utf-8');

  onProgress?.({
    type: 'done',
    stage: 'done',
    message: `发现完成: ${discovery!.summary.totalModules} 类, ${discovery!.summary.totalTestTargets} 个可测试目标`,
    detail: { foundUtils: discovery!.summary.totalTestTargets },
    parseWarning: discovery!.summary.totalModules === 0,
    rawOutputPreview: discovery!.summary.totalModules === 0 ? fullOutput.slice(0, 2000) : undefined,
  } as any);

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

  const outputDir = path.join(DATA_DIR, 'projects', project.id);

  return content
    .replace(/\{\{projectName\}\}/g, project.name)
    .replace(/\{\{sourcePath\}\}/g, project.sourcePath)
    .replace(/\{\{outputDir\}\}/g, outputDir.replace(/\\/g, '/'));
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

function parseFrontendOutput(
  output: string,
  projectId: string,
  duration: number,
  blocks?: Array<{ type: string; content?: string; name?: string; input?: any }>,
): FrontendDiscoveryResult {
  const result: FrontendDiscoveryResult = {
    projectId,
    discoveredAt: new Date().toISOString(),
    summary: { totalModules: 0, totalTestTargets: 0, scanDuration: duration },
    modules: [],
  };

  // 策略0：从 Write 工具的 input.content 中提取
  if (blocks) {
    for (const block of blocks) {
      if (block.type === 'tool_use' && block.name === 'Write' && block.input?.content) {
        try {
          const parsed = JSON.parse(block.input.content);
          if (parsed.modules && Array.isArray(parsed.modules)) {
            result.modules = parsed.modules;
            result.summary.totalModules = parsed.modules.length;
            result.summary.totalTestTargets = parsed.modules.reduce(
              (sum: number, m: any) => sum + (m.files?.length || 0), 0,
            );
          }
        } catch { /* not valid JSON in Write tool */ }
      }
    }
  }

  const jsonMatch = output.match(/```json\s*\n([\s\S]*?)```/g);
  if (result.summary.totalModules === 0 && jsonMatch) {
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
