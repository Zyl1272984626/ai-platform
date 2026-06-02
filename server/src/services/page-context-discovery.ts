/**
 * 页面知识图谱发现服务
 * 调用 Claude Code + Playwright MCP 逐页分析，生成 E2E 测试用的知识图谱
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig, getProjectById } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

// ========== 类型 ==========

export interface PageContextProgress {
  stage: 'loading' | 'logging_in' | 'analyzing' | 'saving' | 'done' | 'error';
  message: string;
  detail?: {
    currentPage?: string;
    totalPages?: number;
    analyzedPages?: number;
  };
}

// ========== 核心函数 ==========

/**
 * 发现页面知识图谱
 * @param projectId 项目 ID
 * @param onProgress SSE 进度回调
 */
export async function discoverPageContext(
  projectId: string,
  onProgress?: (progress: PageContextProgress) => void,
): Promise<any> {
  const project = getProjectById(projectId);
  if (!project) {
    onProgress?.({ stage: 'error', message: `项目不存在: ${projectId}` });
    throw new Error(`项目不存在: ${projectId}`);
  }

  const startTime = Date.now();
  onProgress?.({ stage: 'loading', message: '正在加载项目配置和页面列表...' });

  // 动态导入 Claude Code SDK
  const { query } = await import('@anthropic-ai/claude-code');

  // 加载 Skill prompt
  const prompt = loadSkillPrompt('page-context-discovery', project);

  const projectDir = path.join(DATA_DIR, 'projects', projectId);
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  // 调用 Claude Code
  let fullOutput = '';
  const abortController = new AbortController();
  const totalTimeout = 15 * 60 * 1000; // 15 分钟（页面多时需要更长时间）
  const timer = setTimeout(() => abortController.abort(), totalTimeout);

  onProgress?.({ stage: 'analyzing', message: '正在启动 Claude Code 分析页面...' });

  try {
    const response = query({
      prompt,
      options: {
        cwd: project.sourcePath || getConfig().aiPlatformRoot,
        allowedTools: [
          'Read', 'Write', 'Bash',
          'mcp__playwright__browser_navigate',
          'mcp__playwright__browser_snapshot',
          'mcp__playwright__browser_take_screenshot',
          'mcp__playwright__browser_console_messages',
          'mcp__playwright__browser_network_requests',
          'mcp__playwright__browser_wait_for',
          'mcp__playwright__browser_click',
          'mcp__playwright__browser_close',
        ],
        maxTurns: 200,
        permissionMode: 'bypassPermissions',
        abortController,
        mcpServers: {
          playwright: {
            type: 'stdio' as const,
            command: 'npx',
            args: ['-y', '@executeautomation/playwright-mcp-server'],
          },
        },
      },
    });

    for await (const msg of response) {
      if (abortController.signal.aborted) throw new Error('知识图谱发现超时');

      if (msg.type === 'assistant' && (msg as any).message?.content) {
        for (const block of (msg as any).message.content) {
          if (block.type === 'text') {
            fullOutput += block.text;
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

  // 尝试读取生成的文件（Claude Code 会直接写入）
  onProgress?.({ stage: 'saving', message: '正在保存知识图谱...' });

  const contextPath = path.join(projectDir, 'page-context.json');

  // 检查 Claude Code 是否已经写入了文件
  if (fs.existsSync(contextPath)) {
    const content = fs.readFileSync(contextPath, 'utf-8');
    try {
      const context = JSON.parse(content);
      // 补充 meta 信息
      if (!context._meta) {
        context._meta = {};
      }
      context._meta.generatedAt = new Date().toISOString();
      context._meta.projectId = projectId;
      context._meta.totalPages = Object.keys(context).filter(k => k !== '_meta').length;
      fs.writeFileSync(contextPath, JSON.stringify(context, null, 2), 'utf-8');
    } catch {
      // JSON 解析失败，尝试从输出中提取
      extractAndSaveContext(fullOutput, projectId, contextPath);
    }
  } else {
    // 从输出中提取 JSON
    extractAndSaveContext(fullOutput, projectId, contextPath);
  }

  const duration = Date.now() - startTime;
  const result = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
  const totalPages = result._meta?.totalPages || Object.keys(result).filter(k => k !== '_meta').length;

  onProgress?.({
    stage: 'done',
    message: `知识图谱生成完成: ${totalPages} 个页面, 耗时 ${Math.round(duration / 1000)}s`,
    detail: { totalPages, analyzedPages: totalPages },
  });

  return result;
}

// ========== 辅助函数 ==========

/** 从 Skill 文件加载 prompt，替换模板变量 */
function loadSkillPrompt(skillName: string, project: any): string {
  const config = getConfig();
  const skillPath = path.resolve(config.aiPlatformRoot, 'skills', 'tests', skillName, 'SKILL.md');

  let content = '';
  try {
    content = fs.readFileSync(skillPath, 'utf-8');
    content = content.replace(/^---[\s\S]*?---\n*/, '');
  } catch {
    content = `请分析项目 ${project.name} 的所有页面并生成知识图谱。`;
  }

  // 替换模板变量
  return content
    .replace(/\{\{projectName\}\}/g, project.name)
    .replace(/\{\{projectId\}\}/g, project.id)
    .replace(/\{\{baseUrl\}\}/g, project.baseUrl)
    .replace(/\{\{apiBaseUrl\}\}/g, project.apiBaseUrl)
    .replace(/\{\{loginUrl\}\}/g, project.loginUrl)
    .replace(/\{\{username\}\}/g, project.username)
    .replace(/\{\{password\}\}/g, project.password)
    .replace(/\{\{sourcePath\}\}/g, project.sourcePath || '');
}

function detectProgress(output: string, onProgress?: (p: PageContextProgress) => void) {
  if (output.includes('登录')) {
    onProgress?.({ stage: 'logging_in', message: '正在登录系统...' });
  } else if (output.match(/分析.*页面|导航到|snapshot/i)) {
    onProgress?.({ stage: 'analyzing', message: '正在逐页分析页面结构和元素...' });
  } else if (output.includes('保存') || output.includes('写入')) {
    onProgress?.({ stage: 'saving', message: '正在保存知识图谱...' });
  }
}

/** 从 Claude Code 输出中提取 JSON 并保存 */
function extractAndSaveContext(output: string, projectId: string, savePath: string): void {
  const jsonMatch = output.match(/```json\s*\n([\s\S]*?)```/g);
  if (!jsonMatch) {
    // 没找到 JSON 块，保存空结果
    const emptyResult = {
      _meta: {
        generatedAt: new Date().toISOString(),
        projectId,
        totalPages: 0,
      },
    };
    fs.writeFileSync(savePath, JSON.stringify(emptyResult, null, 2), 'utf-8');
    return;
  }

  // 尝试解析最后一个 JSON 块（通常是最终结果）
  for (let i = jsonMatch.length - 1; i >= 0; i--) {
    try {
      const jsonStr = jsonMatch[i].replace(/```json\s*\n/, '').replace(/```$/, '');
      const parsed = JSON.parse(jsonStr);

      // 验证是知识图谱格式（应该有 pageName 或 _meta 字段）
      const keys = Object.keys(parsed);
      if (keys.length > 0 && (parsed._meta || keys.some(k => parsed[k]?.pageName))) {
        if (!parsed._meta) parsed._meta = {};
        parsed._meta.generatedAt = new Date().toISOString();
        parsed._meta.projectId = projectId;
        parsed._meta.totalPages = keys.filter(k => k !== '_meta').length;

        fs.writeFileSync(savePath, JSON.stringify(parsed, null, 2), 'utf-8');
        return;
      }
    } catch {
      continue;
    }
  }

  // 都没解析成功，保存空结果
  const emptyResult = {
    _meta: { generatedAt: new Date().toISOString(), projectId, totalPages: 0 },
  };
  fs.writeFileSync(savePath, JSON.stringify(emptyResult, null, 2), 'utf-8');
}

/** 获取项目的知识图谱 */
export function getPageContext(projectId: string): any {
  const contextPath = path.join(DATA_DIR, 'projects', projectId, 'page-context.json');
  if (!fs.existsSync(contextPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
  } catch {
    return null;
  }
}
