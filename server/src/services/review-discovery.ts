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

// 模块级 AbortController Map，用于中断发现任务
const abortControllers = new Map<string, AbortController>();

/** 中断指定项目的审查发现任务 */
export function abortReviewDiscovery(projectId: string): boolean {
  const controller = abortControllers.get(projectId);
  if (controller) {
    controller.abort();
    abortControllers.delete(projectId);
    return true;
  }
  return false;
}

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

  // 清理旧文件，避免 Claude Code 多读一轮旧数据
  for (const f of ['review-discovery.json', 'review-rules.json', 'discovery-log-review.json']) {
    try { fs.unlinkSync(path.join(projectDir, f)); } catch { /* 文件不存在 */ }
  }

  let fullOutput = '';
  const blocks: Array<{ type: string; content?: string; name?: string; input?: any; toolUseId?: string; result?: string; isError?: boolean }> = [];
  const abortController = new AbortController();
  abortControllers.set(projectId, abortController);
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
      if (abortController.signal.aborted) throw new Error('审查发现已中断');

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
    abortControllers.delete(projectId);
  } catch (err: any) {
    clearTimeout(timer);
    abortControllers.delete(projectId);
    onProgress?.({ type: 'error', message: `发现失败: ${err.message}` } as any);
    throw err;
  }

  onProgress?.({ type: 'stage', stage: 'analyzing', message: '正在解析发现结果...' } as any);

  const discoveryPath = path.join(projectDir, 'review-discovery.json');
  const rulesPath = path.join(projectDir, 'review-rules.json');

  let discovery: ReviewDiscoveryResult | undefined;
  let rules: any;

  // 策略0：检查 Claude 是否已经直接写入了文件（最可靠）
  if (fs.existsSync(discoveryPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
      if (parsed.modules && Array.isArray(parsed.modules)) {
        discovery = parsed;
        discovery!.discoveredAt = discovery!.discoveredAt || new Date().toISOString();
        discovery!.projectId = projectId;
        if (!discovery!.summary) discovery!.summary = { totalFiles: 0, totalModules: 0, keyFiles: 0, scanDuration: Date.now() - startTime };
      }
    } catch { /* JSON 解析失败，走文本解析 */ }
  }

  if (fs.existsSync(rulesPath)) {
    try {
      rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    } catch { /* JSON 解析失败 */ }
  }

  // 策略1-3：文件不存在时，从输出中提取
  if (!discovery || !rules) {
    const parsed = parseReviewOutput(fullOutput, projectId, Date.now() - startTime, blocks);
    discovery = discovery || parsed.discovery;
    rules = rules || parsed.rules;

    // 保存解析结果
    if (!fs.existsSync(discoveryPath)) {
      fs.writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2), 'utf-8');
    }
    if (!fs.existsSync(rulesPath)) {
      fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2), 'utf-8');
    }
  }

  // 保存发现日志（只保留最新）
  fs.writeFileSync(path.join(projectDir, 'discovery-log-review.json'), JSON.stringify({
    savedAt: new Date().toISOString(),
    blocks,
  }), 'utf-8');

  onProgress?.({
    type: 'done',
    stage: 'done',
    message: `发现完成: ${discovery!.summary.totalModules} 模块, ${rules?.dimensions?.length || 0} 审查维度`,
    detail: { foundModules: discovery!.summary.totalModules, generatedRules: rules?.dimensions?.length || 0 },
    parseWarning: discovery!.summary.totalModules === 0,
    rawOutputPreview: discovery!.summary.totalModules === 0 ? fullOutput.slice(0, 2000) : undefined,
  } as any);

  return discovery!;
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
  const outputDir = path.join(DATA_DIR, 'projects', project.id);

  let content = '';
  try {
    content = fs.readFileSync(skillPath, 'utf-8');
    content = content.replace(/^---[\s\S]*?---\n*/, '');
  } catch {
    content = buildReviewDiscoveryPrompt(project);
  }

  return content
    .replace(/\{\{projectName\}\}/g, project.name)
    .replace(/\{\{sourcePath\}\}/g, project.sourcePath)
    .replace(/\{\{outputDir\}\}/g, outputDir.replace(/\\/g, '/'));
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

function parseReviewOutput(
  output: string,
  projectId: string,
  duration: number,
  blocks?: Array<{ type: string; content?: string; name?: string; input?: any }>,
): {
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

  // 策略0：从 Write 工具的 input.content 中提取（Claude 可能用 Write 写文件而非文本输出）
  if (blocks) {
    for (const block of blocks) {
      if (block.type === 'tool_use' && block.name === 'Write' && block.input?.content) {
        try {
          const parsed = JSON.parse(block.input.content);
          if (parsed.modules && Array.isArray(parsed.modules)) {
            discovery.modules = parsed.modules;
            discovery.projectStructure = parsed.projectStructure || discovery.projectStructure;
            discovery.summary.totalModules = parsed.modules.length;
            discovery.summary.keyFiles = parsed.modules.reduce((s: number, m: any) => s + (m.keyFiles?.length || 0), 0);
          } else if (parsed.dimensions) {
            rules.dimensions = parsed.dimensions;
            rules.ignore = parsed.ignore || rules.ignore;
            rules.fileLimits = parsed.fileLimits || rules.fileLimits;
          }
        } catch { /* not valid JSON in Write tool */ }
      }
    }
  }

  // 策略1：从 ```json``` 代码块中提取
  const jsonMatches = output.match(/```json\s*\n([\s\S]*?)```/g);
  if (jsonMatches) {
    for (const block of jsonMatches) {
      const content = block.replace(/```json\s*\n/, '').replace(/\n```$/, '').trim();
      try {
        const parsed = JSON.parse(content);
        if (parsed.modules && !parsed.dimensions) {
          discovery.modules = parsed.modules;
          discovery.projectStructure = parsed.projectStructure || discovery.projectStructure;
          discovery.summary.totalModules = parsed.modules?.length || 0;
          discovery.summary.keyFiles = parsed.modules?.reduce((s: number, m: any) => s + (m.keyFiles?.length || 0), 0) || 0;
        } else if (parsed.dimensions) {
          rules.dimensions = parsed.dimensions;
          rules.ignore = parsed.ignore || rules.ignore;
          rules.fileLimits = parsed.fileLimits || rules.fileLimits;
        }
      } catch { /* not valid JSON */ }
    }
  }

  // 策略2：如果代码块没解析到，尝试从全文找 JSON 对象
  if (discovery.summary.totalModules === 0) {
    // 尝试匹配 { "modules": [...] } 或 {"modules":[...]}
    const moduleMatch = output.match(/\{\s*["']modules["']\s*:\s*\[[\s\S]*?\]\s*\}/);
    if (moduleMatch) {
      try {
        const parsed = JSON.parse(moduleMatch[0]);
        if (parsed.modules?.length) {
          discovery.modules = parsed.modules;
          discovery.summary.totalModules = parsed.modules.length;
          discovery.summary.keyFiles = parsed.modules.reduce((s: number, m: any) => s + (m.keyFiles?.length || 0), 0);
          if (parsed.projectStructure) discovery.projectStructure = parsed.projectStructure;
        }
      } catch { /* fallback failed */ }
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
