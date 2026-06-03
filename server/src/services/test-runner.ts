/**
 * 测试执行服务
 *
 * 支持 4 种测试类型：
 * - agent: Agent 智能体对话测试（通过 Claude Code SDK）
 * - e2e: Playwright E2E 页面测试（AI 模拟真人操作）
 * - frontend: 前端单元测试（vitest）
 * - api: 后端接口测试（.http 格式）
 */
import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';
import { marked } from 'marked';
import { AI_PLATFORM_ROOT, getConfig, getProjectById, type TestProject, type PageConfig } from './config.js';
import { testBus } from './test-events.js';

// ========== 类型 ==========

export type TestType = 'agent' | 'e2e' | 'frontend' | 'api' | 'codereview';
export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';

export interface StreamBlock {
  type: 'text' | 'tool_use'
  content?: string          // 文本内容
  name?: string             // 工具名
  input?: any               // 工具输入参数
  result?: string           // 工具返回结果（截断到 5000 字符）
  toolUseId?: string        // 工具调用 ID，用于匹配 result
}

export interface TestCase {
  id: string;
  name: string;
  type: TestType;
  status: TestStatus;
  duration?: number; // ms
  error?: string;
  output?: string;
  blocks?: StreamBlock[];   // 结构化事件记录，用于历史回放
}

/** 中断恢复信息（按模块维度记录 session_id） */
export interface ResumeCaseInfo {
  sessionId: string
  status: 'completed' | 'interrupted'
  partialOutput: string
}

export interface ResumeInfo {
  cases: Record<string, ResumeCaseInfo>
}

export interface TestSuite {
  id: string;
  name: string;
  type: TestType;
  status: TestStatus;
  cases: TestCase[];
  startedAt: string;
  finishedAt?: string;
  duration?: number;
  config: Record<string, unknown>;
}

/** 从 suite.config 中获取 resumeInfo */
function getResumeInfo(suite: TestSuite): ResumeInfo {
  return (suite.config.resumeInfo as ResumeInfo) || { cases: {} };
}

/** 设置 suite.config 中的 resumeInfo */
function setResumeInfo(suite: TestSuite, info: ResumeInfo): void {
  suite.config.resumeInfo = info;
}

// ========== 存储 ==========

const runs = new Map<string, TestSuite>();
const abortControllers = new Map<string, AbortController>(); // suiteId -> AbortController

/** 所有测试类型 */
const ALL_TYPES: TestType[] = ['agent', 'e2e', 'frontend', 'api', 'codereview'];

/** 获取指定测试类型的 runs 目录（统一到 testDataDir/{type}/runs/） */
function getRunsDir(type: TestType): string {
  const base = getConfig().testDataDir || getConfig().e2eDataDir;
  const dir = path.resolve(base, type, 'runs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 兼容旧的 runsDir（用于迁移旧数据） */
const legacyRunsDir = path.resolve(AI_PLATFORM_ROOT, 'data', 'test-runs');

// ========== 队列（按测试类型分队列） ==========

type QueueEntry = { suiteId: string; resolve: (v: any) => void; reject: (e: any) => void };

const typeQueues: Record<TestType, QueueEntry[]> = { agent: [], e2e: [], frontend: [], api: [], codereview: [] };
const typeRunning: Record<TestType, number> = { agent: 0, e2e: 0, frontend: 0, api: 0, codereview: 0 };

// 每种类型的最大并发数
const CONCURRENCY: Record<TestType, number> = {
  agent: 3,
  e2e: 2,
  frontend: 1,
  api: 2,
  codereview: 1,
};

function processTypeQueue(type: TestType): void {
  while (typeRunning[type] < CONCURRENCY[type] && typeQueues[type].length > 0) {
    const entry = typeQueues[type].shift()!;
    typeRunning[type]++;
    executeTestRunInternal(entry.suiteId)
      .then(entry.resolve)
      .catch(entry.reject)
      .finally(() => {
        typeRunning[type]--;
        processTypeQueue(type);
      });
  }
}

// ========== 端口预检 ==========

function checkPort(port: number, host = 'localhost'): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(3000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

async function preflightCheck(type: TestType, config?: Record<string, unknown>): Promise<string | null> {
  if (type !== 'e2e') return null;

  const projectId = config?.projectId as string | undefined;
  const project = projectId ? getProjectById(projectId) : undefined;

  if (project) {
    // 检测项目前端可达性（使用 loginUrl 而非根路径，因为根路径可能不返回 200）
    const checkUrl = project.loginUrl
      ? `${project.baseUrl}${project.loginUrl}`
      : project.baseUrl;
    try {
      const resp = await fetch(checkUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
      // SPA 页面通常返回 200，即使路由是 hash 模式
      if (!resp.ok && resp.status !== 200) {
        return `项目 ${project.name} 前端不可达 (${project.baseUrl})`;
      }
    } catch {
      return `项目 ${project.name} 前端不可达 (${project.baseUrl})`;
    }
  }
  return null;
}

function ensureRunsDir() {
  // 确保所有类型的 runs 目录存在
  for (const type of ALL_TYPES) {
    getRunsDir(type);
  }
}

/** 启动时清理残留的"运行中"记录（服务器重启后这些测试已不可能完成） */
function cleanupStaleRuns() {
  ensureRunsDir();
  let cleaned = 0;
  // 遍历所有类型目录
  for (const type of ALL_TYPES) {
    const dir = getRunsDir(type);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const filePath = path.join(dir, f);
        const suite = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (suite.status === 'running' || suite.status === 'pending') {
          suite.status = 'error';
          suite.finishedAt = new Date().toISOString();
          if (!suite.duration) suite.duration = 0;
          for (const tc of suite.cases) {
            if (tc.status === 'running' || tc.status === 'pending') {
              tc.status = 'error';
              tc.error = '服务器重启，测试中断';
            }
          }
          fs.writeFileSync(filePath, JSON.stringify(suite, null, 2));
          cleaned++;
        }
      } catch { /* skip */ }
    }
  }
  // 同时检查旧目录
  if (fs.existsSync(legacyRunsDir)) {
    const legacyFiles = fs.readdirSync(legacyRunsDir).filter(f => f.endsWith('.json'));
    for (const f of legacyFiles) {
      try {
        const filePath = path.join(legacyRunsDir, f);
        const suite = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (suite.status === 'running' || suite.status === 'pending') {
          suite.status = 'error';
          suite.finishedAt = new Date().toISOString();
          if (!suite.duration) suite.duration = 0;
          for (const tc of suite.cases) {
            if (tc.status === 'running' || tc.status === 'pending') {
              tc.status = 'error';
              tc.error = '服务器重启，测试中断';
            }
          }
          fs.writeFileSync(filePath, JSON.stringify(suite, null, 2));
          cleaned++;
        }
      } catch { /* skip */ }
    }
  }
  if (cleaned > 0) console.log(`[test-runner] 清理了 ${cleaned} 个残留的运行中记录`);
}

function saveRun(suite: TestSuite) {
  const dir = getRunsDir(suite.type);
  fs.writeFileSync(path.join(dir, `${suite.id}.json`), JSON.stringify(suite, null, 2));
}

export function listTestRuns(type?: TestType): TestSuite[] {
  // 先从磁盘加载
  cleanupStaleRuns();
  ensureRunsDir();
  // 扫描所有类型目录 + 旧目录
  const dirsToScan = type ? [getRunsDir(type)] : ALL_TYPES.map(t => getRunsDir(t));
  if (!type && fs.existsSync(legacyRunsDir)) {
    dirsToScan.push(legacyRunsDir);
  }
  for (const dir of dirsToScan) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const suite = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        if (!runs.has(suite.id)) runs.set(suite.id, suite);
      } catch { /* skip */ }
    }
  }
  const all = Array.from(runs.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  return type ? all.filter(r => r.type === type) : all;
}

export function getTestRun(id: string): TestSuite | undefined {
  return runs.get(id);
}

// ========== Agent 测试 ==========

async function runAgentTest(
  suite: TestSuite,
  config: { agentId?: string; userXgh?: string }
): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-code');
  const skillPath = path.resolve(AI_PLATFORM_ROOT, 'skills', 'tests', 'agent-test', 'SKILL.md');

  let skillContent = '';
  try {
    skillContent = fs.readFileSync(skillPath, 'utf-8');
    // 去掉 YAML front matter
    skillContent = skillContent.replace(/^---[\s\S]*?---\n*/, '');
  } catch {
    skillContent = '你是 Agent 测试助手。请根据用户提供的 agentId 和 userXgh 进行测试。';
  }

  const agentId = config.agentId || '';
  const userXgh = config.userXgh || '';

  if (!agentId) {
    for (const tc of suite.cases) {
      tc.status = 'failed';
      tc.error = '缺少 agentId 参数';
    }
    return;
  }

  const prompt = `请使用 agent-id-test-workflow 技能，对以下 Agent 进行完整测试：\n\n- agentId: ${agentId}\n- userXgh: ${userXgh || '需要用户提供'}\n\n请按照 SKILL.md 中的完整流程执行：收集 Agent 配置 → 生成测试用例 → 执行测试 → 生成报告 → 产出失败分析。`;

  const abortController = new AbortController();
  abortControllers.set(suite.id, abortController);
  // 无超时限制，让 Claude Code 自然完成
  const timer = setTimeout(() => {}, 0);

  // 创建一个虚拟 case 来追踪整体进度
  const mainCase = suite.cases[0];
  if (mainCase) {
    mainCase.name = 'Agent 全流程测试';
    mainCase.status = 'running';
    saveRun(suite);
  }

  const startTime = Date.now();
  let fullOutput = '';
  const blocks: StreamBlock[] = [];

  try {
    const response = query({
      prompt,
      options: {
        cwd: getConfig().aiPlatformRoot,
        allowedTools: [
          'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Bash',
          'WebSearch', 'WebFetch', 'NotebookEdit',
          'mcp__mcp_server_mysql__mysql_query',
          'mcp__web_reader__webReader',
          'mcp__4_5v_mcp__analyze_image',
        ],
        maxTurns: 9999,
        permissionMode: 'bypassPermissions',
        abortController,
        appendSystemPrompt: skillContent,
      },
    });

    for await (const msg of response) {
      if (abortController.signal.aborted) throw new Error('Agent test timeout');

      switch (msg.type) {
        case 'assistant': {
          if ((msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'text') {
                fullOutput += block.text;
                blocks.push({ type: 'text', content: block.text });
                testBus.emit('agent:stream', {
                  suiteId: suite.id,
                  type: 'text',
                  content: block.text,
                });
              } else if (block.type === 'tool_use') {
                blocks.push({
                  type: 'tool_use',
                  name: block.name,
                  input: block.input,
                  toolUseId: block.id,
                });
                testBus.emit('agent:stream', {
                  suiteId: suite.id,
                  type: 'tool_use',
                  name: block.name,
                  input: block.input,
                  id: block.id,
                });
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
                  ? block.content
                  : JSON.stringify(block.content);
                // 回填 blocks 中对应工具调用的结果
                const existingBlock = blocks.find(
                  b => b.type === 'tool_use' && b.toolUseId === block.tool_use_id
                );
                if (existingBlock) {
                  existingBlock.result = resultContent?.slice(0, 5000);
                }
                testBus.emit('agent:stream', {
                  suiteId: suite.id,
                  type: 'tool_result',
                  toolUseId: block.tool_use_id,
                  content: resultContent?.slice(0, 5000),
                });
              }
            }
          }
          break;
        }
        case 'result': {
          const resultMsg = msg as any;
          if (resultMsg.subtype === 'success' && resultMsg.result && !fullOutput) {
            fullOutput = resultMsg.result;
          }
          break;
        }
      }
    }

    clearTimeout(timer);

    // 测试完成
    if (mainCase) {
      mainCase.duration = Date.now() - startTime;
      mainCase.output = fullOutput;
      mainCase.blocks = blocks;
      mainCase.status = fullOutput.length > 100 ? 'passed' : 'failed';
      if (mainCase.status === 'failed') mainCase.error = '输出内容不足';
    }

    // 其他预设 case 标记为 skipped（主流程已覆盖）
    for (let i = 1; i < suite.cases.length; i++) {
      suite.cases[i].status = 'passed' as any;
      suite.cases[i].output = '(包含在主流程测试中)';
    }

  } catch (err: any) {
    clearTimeout(timer);
    abortControllers.delete(suite.id);
    if (mainCase) {
      mainCase.duration = Date.now() - startTime;
      mainCase.status = 'error';
      mainCase.error = err.message;
    }
  }

  abortControllers.delete(suite.id);
  saveRun(suite);
  testBus.emit('test:update', { suiteId: suite.id, caseId: mainCase?.id, status: mainCase?.status, duration: mainCase?.duration });
}

// ========== E2E 页面测试（AI Agent + Playwright MCP） ==========

async function runE2ETest(suite: TestSuite, config: Record<string, unknown>): Promise<void> {
  console.log('[E2E] 开始加载 Claude Code SDK...');
  const { query } = await import('@anthropic-ai/claude-code');
  console.log('[E2E] SDK 加载成功');

  // 获取项目配置
  const projectId = config.projectId as string | undefined;
  const project = projectId ? getProjectById(projectId) : undefined;

  // 解析 Skill 路径
  const skillBasePath = project?.skillPath
    ? path.dirname(project.skillPath)
    : path.resolve(getConfig().aiPlatformRoot, 'skills', 'tests', 'e2e-page-test');
  const skillPath = path.resolve(skillBasePath, 'SKILL.md');

  let skillContent = '';
  try {
    skillContent = fs.readFileSync(skillPath, 'utf-8');
    skillContent = skillContent.replace(/^---[\s\S]*?---\n*/, '');
    console.log('[E2E] Skill 加载成功，长度:', skillContent.length);
  } catch (e: any) {
    skillContent = '你是一个 E2E 页面测试助手，通过 Playwright MCP 控制浏览器测试页面。';
    console.log('[E2E] Skill 加载失败:', e.message);
  }

  const mode = (config.mode as string) || 'standard';
  const scope = (config.scope as string) || 'all';

  // 从项目配置解析页面列表
  let pageListPrompt = '';
  if (project) {
    const pages = resolvePages(project, scope);
    const baseUrl = project.baseUrl;
    const gp = project.globalParams || {};
    const paramsInfo = Object.keys(gp).length > 0
      ? `\n## 动态参数映射\n${Object.entries(gp).map(([k, v]) => `- ${k} → ${v.join(', ')}`).join('\n')}\n`
      : '';
    pageListPrompt = `
## 当前项目信息
- 项目名称: ${project.name}
- 前端地址: ${baseUrl}
- 后端 API: ${project.apiBaseUrl}
- 登录页: ${baseUrl}${project.loginUrl}
- 登录凭据: ${project.username} / ${project.password}
${paramsInfo}
## 待测试页面 (${pages.length}页)
${pages.map(p => `- ${p.name}: ${baseUrl}${p.url}`).join('\n')}
`;
  }

  const projectSlug = project?.name ? project.name.replace(/[<>:"/\\|?*\s]+/g, '_') : '_default';
  const e2eDataDir = getConfig().e2eDataDir || getConfig().testDataDir;

  const prompt = `请使用 e2e-page-test 技能，以 ${mode} 模式测试${project ? ` ${project.name}` : ''} ${scope} 范围的页面。

${pageListPrompt}
输入参数：
\`\`\`json
{"mode": "${mode}", "scope": "${scope}"${projectId ? `, "projectId": "${projectId}"` : ''}, "e2eDataDir": "${e2eDataDir.replace(/\\/g, '/')}", "projectName": "${projectSlug}"}
\`\`\`

请严格按照 SKILL.md 中的流程执行：登录 → 逐页测试（observe → think → act → validate）→ 生成报告。`;

  const mainCase = suite.cases[0];
  mainCase.name = `E2E ${mode} 模式 (${scope})`;
  mainCase.status = 'running';
  saveRun(suite);

  const abortController = new AbortController();
  abortControllers.set(suite.id, abortController);
  // 无超时限制，让 Claude Code 自然完成
  const timer = setTimeout(() => {}, 0);

  const startTime = Date.now();
  let fullOutput = '';
  const blocks: StreamBlock[] = [];

  try {
    console.log('[E2E] 调用 query()...');
    const e2eCwd = project?.sourcePath || getConfig().aiPlatformRoot;
    const response = query({
      prompt,
      options: {
        cwd: e2eCwd,
        allowedTools: [
          'Read', 'Write', 'Bash', 'Glob', 'Grep',
          'mcp__playwright__browser_navigate',
          'mcp__playwright__browser_snapshot',
          'mcp__playwright__browser_take_screenshot',
          'mcp__playwright__browser_click',
          'mcp__playwright__browser_type',
          'mcp__playwright__browser_fill_form',
          'mcp__playwright__browser_press_key',
          'mcp__playwright__browser_console_messages',
          'mcp__playwright__browser_network_requests',
          'mcp__playwright__browser_evaluate',
          'mcp__playwright__browser_wait_for',
          'mcp__playwright__browser_close',
          'mcp__playwright__browser_select_option',
          'mcp__playwright__browser_hover',
          'mcp__playwright__browser_tabs',
          'mcp__4_5v_mcp__analyze_image',
        ],
        maxTurns: 9999,
        permissionMode: 'bypassPermissions',
        abortController,
        appendSystemPrompt: skillContent,
        mcpServers: {
          playwright: {
            type: 'stdio' as const,
            command: 'npx',
            args: ['-y', '@executeautomation/playwright-mcp-server'],
          },
        },
      },
    });

    console.log('[E2E] query() 返回，开始迭代消息...');
    let msgCount = 0;
    for await (const msg of response) {
      if (abortController.signal.aborted) throw new Error('E2E test timeout');
      msgCount++;
      if (msgCount <= 5 || msgCount % 20 === 0) {
        console.log(`[E2E] 消息 #${msgCount}: type=${msg.type}`);
      }

      switch (msg.type) {
        case 'assistant': {
          if ((msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'text') {
                fullOutput += block.text;
                blocks.push({ type: 'text', content: block.text });
                testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: block.text });
              } else if (block.type === 'tool_use') {
                blocks.push({
                  type: 'tool_use',
                  name: block.name,
                  input: block.input,
                  toolUseId: block.id,
                });
                testBus.emit('agent:stream', { suiteId: suite.id, type: 'tool_use', name: block.name, input: block.input, id: block.id });
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
                // 回填 blocks 中对应工具调用的结果
                const existingBlock = blocks.find(
                  b => b.type === 'tool_use' && b.toolUseId === block.tool_use_id
                );
                if (existingBlock) {
                  existingBlock.result = resultContent?.slice(0, 5000);
                }
                testBus.emit('agent:stream', {
                  suiteId: suite.id, type: 'tool_result',
                  toolUseId: block.tool_use_id,
                  content: resultContent?.slice(0, 5000),
                });
              }
            }
          }
          break;
        }
        case 'result': {
          const resultMsg = msg as any;
          if (resultMsg.subtype === 'success' && resultMsg.result && !fullOutput) {
            fullOutput = resultMsg.result;
          }
          break;
        }
      }
    }

    clearTimeout(timer);

    mainCase.duration = Date.now() - startTime;
    mainCase.output = fullOutput;
    mainCase.blocks = blocks;
    mainCase.status = fullOutput.length > 100 ? 'passed' : 'failed';
    if (mainCase.status === 'failed') mainCase.error = '输出内容不足';

    // 尝试读取 e2e-test 生成的报告路径（优先按项目目录查找，兼容旧扁平目录）
    try {
      const searchDirs = [
        path.join(getConfig().e2eDataDir, 'runs', projectSlug),  // 新路径：按项目隔离
        path.join(getConfig().e2eDataDir, 'runs'),               // 旧路径：扁平目录（兼容）
      ];
      for (const e2eRunsBase of searchDirs) {
        if (!fs.existsSync(e2eRunsBase)) continue;
        const runDirs = fs.readdirSync(e2eRunsBase)
          .filter(d => { try { return fs.statSync(path.join(e2eRunsBase, d)).isDirectory(); } catch { return false; } })
          .map(d => ({ name: d, mtime: fs.statSync(path.join(e2eRunsBase, d)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (runDirs.length > 0) {
          const runJsonPath = path.join(e2eRunsBase, runDirs[0].name, 'run.json');
          if (fs.existsSync(runJsonPath)) {
            const runData = JSON.parse(fs.readFileSync(runJsonPath, 'utf-8'));
            if (runData.reportPath) {
              suite.config.reportPath = runData.reportPath;
              break;  // 找到就停止
            }
          }
        }
      }
    } catch { /* ignore */ }

    // 标记其他 case
    for (let i = 1; i < suite.cases.length; i++) {
      suite.cases[i].status = 'passed' as any;
      suite.cases[i].output = '(包含在 AI Agent 主流程测试中)';
    }

  } catch (err: any) {
    clearTimeout(timer);
    abortControllers.delete(suite.id);
    mainCase.duration = Date.now() - startTime;
    mainCase.status = 'error';
    mainCase.error = err.message;
  }

  abortControllers.delete(suite.id);
  saveRun(suite);
  testBus.emit('test:update', { suiteId: suite.id, caseId: mainCase.id, status: mainCase.status, duration: mainCase.duration });
}

/** 根据项目配置和 scope 解析出要测试的页面列表，展开动态参数 */
function resolvePages(project: TestProject, scope: string): PageConfig[] {
  const rawPages = scope === 'all'
    ? (project.pageSets || []).flatMap(ps => ps.pages)
    : (project.pageSets || []).find(ps => ps.id === scope)?.pages || [];

  const globalParams = project.globalParams || {};
  const expanded: PageConfig[] = [];

  for (const page of rawPages) {
    // 从路径提取动态参数名（兼容旧数据没有 params 字段的情况）
    const pathParams = page.path?.match(/:\w+/g) || [];
    const pageParams = page.params || {};

    // 如果 params 为空但有路径参数，自动构造 params
    if (pathParams.length > 0 && Object.keys(pageParams).length === 0) {
      for (const p of pathParams) {
        if (!(p in pageParams)) pageParams[p] = [];
      }
    }

    // 无动态参数，直接使用
    if (Object.keys(pageParams).length === 0) {
      expanded.push(page);
      continue;
    }

    // 合并参数：页面级别覆盖公共级别（页面有值用页面的，否则用公共的）
    const mergedParams: Record<string, string[]> = {};
    for (const [param, pageValues] of Object.entries(pageParams)) {
      mergedParams[param] = pageValues.length > 0 ? pageValues : (globalParams[param] || []);
    }

    // 检查所有参数是否都有值
    const allConfigured = Object.values(mergedParams).every(values => values.length > 0);
    if (!allConfigured) {
      expanded.push({
        ...page,
        name: `${page.name} (参数未配置，已跳过)`,
      });
      continue;
    }

    // 展开参数组合（笛卡尔积）
    const combinations = generateParamCombinations(mergedParams);
    for (const combo of combinations) {
      let resolvedUrl = page.url;
      let resolvedPath = page.path;
      for (const [param, value] of Object.entries(combo)) {
        resolvedUrl = resolvedUrl.replace(param, value);
        resolvedPath = resolvedPath.replace(param, value);
      }
      expanded.push({
        ...page,
        id: `${page.id}-${Object.values(combo).join('-')}`,
        name: `${page.name} (${Object.values(combo).join('/')})`,
        url: resolvedUrl,
        path: resolvedPath,
        hasDynamicParams: false,
        params: undefined,
      });
    }
  }
  return expanded;
}

/** 生成参数的笛卡尔积组合 */
function generateParamCombinations(params: Record<string, string[]>): Record<string, string>[] {
  const entries = Object.entries(params);
  if (entries.length === 0) return [{}];
  const [key, values] = entries[0];
  const rest = generateParamCombinations(Object.fromEntries(entries.slice(1)));
  const result: Record<string, string>[] = [];
  for (const value of values) {
    for (const combo of rest) {
      result.push({ [key]: value, ...combo });
    }
  }
  return result;
}

// ========== 前端单元测试（两阶段：生成 + 执行） ==========

/** 加载 frontend-test Skill 并替换模板变量 */
function loadFrontendTestSkill(variables: Record<string, string>): string {
  const skillPath = path.resolve(AI_PLATFORM_ROOT, 'skills', 'tests', 'frontend-test', 'SKILL.md');
  let content = '';
  try {
    content = fs.readFileSync(skillPath, 'utf-8');
    content = content.replace(/^---[\s\S]*?---\n*/, '');
    console.log('[FrontendTest] Skill 加载成功，长度:', content.length);
  } catch (e: any) {
    content = '你是一位严格的前端测试工程师。请根据发现结果生成 vitest 单元测试。';
    console.log('[FrontendTest] Skill 加载失败:', e.message);
  }
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return content;
}

/** 将发现结果中单个模块的信息格式化为 Skill 能理解的文本 */
function buildFrontendModuleInfo(mod: any): string {
  const files = (mod.files || []).map((f: any) => {
    let info = `- ${f.path}`;
    if (f.exports?.length) info += ` (导出: ${f.exports.join(', ')})`;
    if (f.functions?.length) {
      info += '\n  函数:\n' + f.functions.map((fn: any) =>
        `    - ${fn.name}(${fn.params?.join(', ') || ''}) — ${fn.description}`
      ).join('\n');
    }
    if (f.testableLogic?.length) {
      info += '\n  可测试逻辑:\n' + f.testableLogic.map((l: string) => `    - ${l}`).join('\n');
    }
    return info;
  }).join('\n');

  return `## 当前模块
- 模块ID: ${mod.id}
- 模块名称: ${mod.name}
- 描述: ${mod.description}
- 文件数量: ${mod.files?.length || 0}

## 文件列表
${files}`;
}

/** 递归扫描目录下所有 .test.ts 文件 */
function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.test.ts')) results.push(full);
    }
  }
  walk(dir);
  return results;
}

async function runFrontendTest(suite: TestSuite, config: Record<string, unknown>): Promise<void> {
  console.log('[FrontendTest] 开始前端单元测试...');
  const { query } = await import('@anthropic-ai/claude-code');

  const projectId = config.projectId as string | undefined;
  const project = projectId ? getProjectById(projectId) : undefined;

  if (!project?.sourcePath) {
    for (const tc of suite.cases) {
      tc.status = 'failed';
      tc.error = '请选择项目并配置源码路径';
    }
    return;
  }

  // 读取发现数据
  const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
  const discoveryPath = path.join(DATA_DIR, 'projects', projectId!, 'frontend-discovery.json');
  let discovery: any = null;
  if (fs.existsSync(discoveryPath)) {
    try {
      discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
    } catch { /* ignore */ }
  }

  if (!discovery?.modules) {
    for (const tc of suite.cases) {
      tc.status = 'failed';
      tc.error = '请先在设置页面点击「发现组件」';
    }
    return;
  }

  const selectedModuleIds = (config.modules as string[]) || [];
  const testsOutputDir = path.join(DATA_DIR, 'projects', projectId!, 'frontend-tests');
  if (!fs.existsSync(testsOutputDir)) fs.mkdirSync(testsOutputDir, { recursive: true });

  const abortController = new AbortController();
  abortControllers.set(suite.id, abortController);

  // 初始化 resumeInfo
  if (!getResumeInfo(suite).cases || Object.keys(getResumeInfo(suite).cases).length === 0) {
    setResumeInfo(suite, { cases: {} });
  }
  const resumeInfo = getResumeInfo(suite);

  try {
    // ===== 阶段一：逐模块调用 Claude Code 生成测试文件 =====
    for (let i = 0; i < suite.cases.length; i++) {
      if (abortController.signal.aborted) {
        for (let j = i; j < suite.cases.length; j++) {
          suite.cases[j].status = 'error';
          suite.cases[j].error = '用户手动停止';
        }
        break;
      }

      const tc = suite.cases[i];
      const moduleId = selectedModuleIds[i];
      const mod = discovery.modules.find((m: any) => m.id === moduleId);

      if (!mod) {
        tc.status = 'skipped' as any;
        tc.error = '未找到模块信息';
        continue;
      }

      // 检查 resumeInfo，跳过已完成的模块
      const resumeCase = resumeInfo.cases[tc.id];
      if (resumeCase?.status === 'completed') {
        tc.status = 'passed' as any;
        testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n⏭️ 跳过已生成: ${mod.name}\n\n` });
        continue;
      }

      const resumeSessionId = resumeCase?.status === 'interrupted'
        ? resumeCase.sessionId
        : undefined;

      // 加载 Skill 并替换模板变量
      const skillContent = loadFrontendTestSkill({
        projectName: project.name,
        sourcePath: project.sourcePath!,
        moduleInfoSection: buildFrontendModuleInfo(mod),
        testsOutputDir: testsOutputDir.replace(/\\/g, '/'),
      });

      await runSingleModuleFrontendTest(suite, tc, mod, project.sourcePath!, abortController, skillContent, resumeSessionId);
    }

    // ===== 阶段二：执行 vitest =====
    if (!abortController.signal.aborted) {
      await executeVitestTests(suite, testsOutputDir, project.sourcePath!);
    }
  } catch (err: any) {
    console.error('[FrontendTest] 出错:', err.message);
  }

  abortControllers.delete(suite.id);
  saveRun(suite);
}

/** 执行单个模块的测试文件生成 */
async function runSingleModuleFrontendTest(
  suite: TestSuite,
  tc: TestCase,
  mod: any,
  sourcePath: string,
  suiteAbortController: AbortController,
  skillContent: string,
  resumeSessionId?: string,
): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-code');

  tc.status = 'running';
  const resumePrefix = resumeSessionId ? '🔄 恢复生成: ' : '🧪 开始生成: ';
  testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n---\n## ${resumePrefix}${mod.name}\n\n` });
  saveRun(suite);

  const moduleAbortController = new AbortController();
  const onSuiteAbort = () => moduleAbortController.abort();
  suiteAbortController.signal.addEventListener('abort', onSuiteAbort);

  const startTime = Date.now();
  let fullOutput = '';
  const blocks: StreamBlock[] = [];

  try {
    const queryOptions: Record<string, any> = {
      cwd: sourcePath,
      allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
      maxTurns: 9999,
      permissionMode: 'bypassPermissions',
      abortController: moduleAbortController,
      appendSystemPrompt: skillContent,
    };

    const promptText = resumeSessionId
      ? '请继续之前的测试生成，从中断处继续。保持之前的生成进度。'
      : `请为模块 "${mod.name}" (${mod.id}) 生成完整的 vitest 单元测试文件。`;

    if (resumeSessionId) {
      queryOptions.resume = resumeSessionId;
      queryOptions.forkSession = true;
    }

    const response = query({ prompt: promptText, options: queryOptions });

    let capturedSessionId = '';

    for await (const msg of response) {
      if (moduleAbortController.signal.aborted) throw new Error('测试生成被中断');

      switch (msg.type) {
        case 'system': {
          const sessionId = (msg as any).session_id;
          if (sessionId) capturedSessionId = sessionId;
          break;
        }
        case 'assistant': {
          if ((msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'text') {
                fullOutput += block.text;
                blocks.push({ type: 'text', content: block.text });
                testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: block.text });
              } else if (block.type === 'tool_use') {
                blocks.push({ type: 'tool_use', name: block.name, input: block.input, toolUseId: block.id });
                testBus.emit('agent:stream', { suiteId: suite.id, type: 'tool_use', name: block.name, input: block.input, id: block.id });
              }
            }
          }
          break;
        }
        case 'user': {
          if ('message' in msg && (msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'tool_result') {
                const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                const existingBlock = blocks.find(b => b.type === 'tool_use' && b.toolUseId === block.tool_use_id);
                if (existingBlock) existingBlock.result = resultContent?.slice(0, 5000);
                testBus.emit('agent:stream', { suiteId: suite.id, type: 'tool_result', toolUseId: block.tool_use_id, content: resultContent?.slice(0, 5000) });
              }
            }
          }
          break;
        }
        case 'result': {
          const resultMsg = msg as any;
          if (resultMsg.subtype === 'success' && resultMsg.result && !fullOutput) {
            fullOutput = resultMsg.result;
          }
          break;
        }
      }
    }

    tc.duration = Date.now() - startTime;
    tc.output = fullOutput;
    tc.blocks = blocks;
    tc.status = fullOutput.length > 50 ? 'passed' : 'failed';
    if (tc.status === 'failed') tc.error = '生成输出不足';

    // 保存 resumeInfo
    if (capturedSessionId) {
      const info = getResumeInfo(suite);
      info.cases[tc.id] = { sessionId: capturedSessionId, status: 'completed', partialOutput: fullOutput };
      setResumeInfo(suite, info);
    }

    testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n\n${tc.status === 'passed' ? '✅' : '❌'} 测试生成完成: ${mod.name} (${(tc.duration / 1000).toFixed(1)}s)\n\n` });
  } catch (err: any) {
    tc.duration = Date.now() - startTime;
    tc.status = 'error';
    tc.error = err.message;
    tc.blocks = blocks;

    // 保存 resumeInfo（中断）
    const info = getResumeInfo(suite);
    const existingResume = info.cases[tc.id];
    const sessionIdToSave = existingResume?.sessionId || '';
    if (sessionIdToSave) {
      info.cases[tc.id] = { sessionId: sessionIdToSave, status: 'interrupted', partialOutput: fullOutput };
      setResumeInfo(suite, info);
    }

    testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n\n💥 测试生成中断: ${mod.name} - ${err.message}\n\n` });
  } finally {
    suiteAbortController.signal.removeEventListener('abort', onSuiteAbort);
  }

  saveRun(suite);
  testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: tc.status, duration: tc.duration });
}

/** 阶段二：执行 vitest 测试 */
async function executeVitestTests(suite: TestSuite, testsDir: string, sourcePath: string): Promise<void> {
  const testFiles = findTestFiles(testsDir);
  if (testFiles.length === 0) {
    testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n---\n## ⚠️ 未找到生成的测试文件\n\n` });
    return;
  }

  testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n---\n## 执行 vitest (${testFiles.length} 个测试文件)...\n\n` });

  // 生成临时 vitest 配置
  const vitestConfig = `
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { globals: true, environment: 'happy-dom' },
  resolve: { alias: { '@': '${sourcePath.replace(/\\/g, '/')}/src' } },
})
`;
  const configPath = path.join(testsDir, '_vitest.config.ts');
  fs.writeFileSync(configPath, vitestConfig, 'utf-8');

  try {
    const { execSync } = await import('child_process');
    const result = execSync(`npx vitest run --reporter=json --config "${configPath}" 2>&1`, {
      cwd: testsDir,
      timeout: 300000, // 5 分钟
      encoding: 'utf-8',
    });

    // 解析 JSON 报告
    const jsonMatch = result.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const report = JSON.parse(jsonMatch[0]);
        const total = report.numTotalTests || 0;
        const passed = report.numPassedTests || 0;
        const failed = report.numFailedTests || 0;
        suite.config.vitestSummary = { total, passed, failed };
        testBus.emit('agent:stream', {
          suiteId: suite.id,
          type: 'text',
          content: `\n\n✅ vitest 执行完成: 总计 ${total}，通过 ${passed}，失败 ${failed}\n`,
        });
      } catch { /* ignore parse */ }
    }
  } catch (err: any) {
    // vitest 可能返回非零退出码（有失败测试），但仍输出 JSON
    const stdout = err.stdout || '';
    const jsonMatch = stdout.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const report = JSON.parse(jsonMatch[0]);
        const total = report.numTotalTests || 0;
        const passed = report.numPassedTests || 0;
        const failed = report.numFailedTests || 0;
        suite.config.vitestSummary = { total, passed, failed };
        testBus.emit('agent:stream', {
          suiteId: suite.id,
          type: 'text',
          content: `\n\n⚠️ vitest 执行完成(有失败): 总计 ${total}，通过 ${passed}，失败 ${failed}\n`,
        });
      } catch { /* ignore */ }
    } else {
      testBus.emit('agent:stream', {
        suiteId: suite.id,
        type: 'text',
        content: `\n\n❌ vitest 执行出错: ${(err.stderr || err.message).slice(0, 500)}\n`,
      });
    }
  }
}

// ========== API 接口测试 ==========

async function runApiTest(suite: TestSuite, config: Record<string, unknown>): Promise<void> {
  const projectId = config.projectId as string | undefined;
  const project = projectId ? getProjectById(projectId) : undefined;
  const baseUrl = project?.apiBaseUrl || (config.baseUrl as string) || getConfig().apiTestBaseUrl;

  // 尝试从发现的 api-tests.json 读取
  let testConfig: any = null;
  if (projectId) {
    const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
    const testsPath = path.join(DATA_DIR, 'projects', projectId, 'api-tests.json');
    if (fs.existsSync(testsPath)) {
      try {
        testConfig = JSON.parse(fs.readFileSync(testsPath, 'utf-8'));
      } catch { /* ignore */ }
    }
  }

  // 登录获取 Token
  let authToken = '';
  if (testConfig?.authConfig) {
    try {
      const loginRes = await fetch(baseUrl + testConfig.authConfig.loginEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testConfig.authConfig.loginBody),
        signal: AbortSignal.timeout(10000),
      });
      const loginData = await loginRes.json();
      authToken = getNestedValue(loginData, testConfig.authConfig.tokenPath) || '';
    } catch { /* ignore login failure */ }
  }

  // 构建 API 测试定义列表
  interface ApiTestDef { name: string; method: string; url: string; expect: number; body?: any; headers?: Record<string, string>; needAuth?: boolean; path?: string; }
  let apiTests: ApiTestDef[];

  if (testConfig?.testModules) {
    // 从发现的测试定义中读取
    const selectedModules = (config.modules as string[]) || testConfig.testModules.map((m: any) => m.moduleId);
    apiTests = [];
    const testData = testConfig.testData || {};
    for (const mod of testConfig.testModules) {
      if (!selectedModules.includes(mod.moduleId)) continue;
      for (const test of mod.tests) {
        // 替换路径中的 {{testData.xxx}}
        let testPath = test.path || '';
        for (const [key, value] of Object.entries(testData)) {
          testPath = testPath.replace(`{{testData.${key}}}`, String(value));
        }
        apiTests.push({
          name: `[${mod.moduleName}] ${test.name}`,
          method: test.method,
          url: testPath,
          expect: test.expect?.status || 200,
          body: test.body,
          headers: test.headers,
          needAuth: test.needAuth,
        });
      }
    }
  } else {
    // fallback 硬编码
    apiTests = [
      { name: 'Health API', method: 'GET', url: '/api/health', expect: 200 },
      { name: 'Skills 列表', method: 'GET', url: '/api/skills', expect: 200 },
      { name: 'Schools 列表', method: 'GET', url: '/api/schools', expect: 200 },
      { name: 'Workflows 列表', method: 'GET', url: '/api/workflows', expect: 200 },
      { name: 'Sessions 列表', method: 'GET', url: '/api/sessions', expect: 200 },
    ];
  }

  for (const tc of suite.cases) {
    const testDef = apiTests.find(t => t.name === tc.name);
    if (!testDef) {
      tc.status = 'skipped' as any;
      continue;
    }

    tc.status = 'running';
    saveRun(suite);
    testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: 'running' });

    const startTime = Date.now();
    try {
      const headers: Record<string, string> = { ...testDef.headers, 'Content-Type': 'application/json' };
      if (testDef.needAuth && authToken && testConfig?.authConfig) {
        headers[testConfig.authConfig.tokenHeader] = `Bearer ${authToken}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${baseUrl}${testDef.url}`, {
        method: testDef.method,
        headers,
        body: testDef.body ? JSON.stringify(testDef.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      tc.duration = Date.now() - startTime;
      const statusCode = res.status;

      // 尝试解析响应体
      let bodyText = '';
      try { bodyText = await res.text(); } catch { /* ignore */ }

      tc.output = `${testDef.method} ${testDef.url} -> HTTP ${statusCode}\n${bodyText.slice(0, 500)}`;

      // 简单校验
      tc.status = statusCode === testDef.expect ? 'passed' : 'failed';
      if (tc.status === 'failed') tc.error = `期望 HTTP ${testDef.expect}，实际 HTTP ${statusCode}`;

      // 如果有 body 断言，额外校验
      if (testConfig && tc.status === 'passed') {
        try {
          const body = JSON.parse(bodyText);
          const expectBody = apiTests.find(t => t.name === tc.name);
          // 这里简化处理：主要看 HTTP 状态码
        } catch { /* ignore */ }
      }
    } catch (err: any) {
      tc.duration = Date.now() - startTime;
      tc.status = 'error';
      tc.error = err.message;
    }

    saveRun(suite);
    testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: tc.status, duration: tc.duration });
  }
}

/** 按 dot-path 获取嵌套值 */
function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

/** 加载 code-review Skill 并替换模板变量 */
function loadCodeReviewSkill(variables: Record<string, string>): string {
  const skillPath = path.resolve(AI_PLATFORM_ROOT, 'skills', 'tests', 'code-review', 'SKILL.md');
  let content = '';
  try {
    content = fs.readFileSync(skillPath, 'utf-8');
    content = content.replace(/^---[\s\S]*?---\n*/, '');
    console.log('[CodeReview] Skill 加载成功，长度:', content.length);
  } catch (e: any) {
    content = '你是一位资深代码审查专家。请对项目源码进行审查。';
    console.log('[CodeReview] Skill 加载失败:', e.message);
  }
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return content;
}

// ========== 代码审查 ==========

async function runCodeReview(suite: TestSuite, config: Record<string, unknown>): Promise<void> {
  console.log('[CodeReview] 开始代码审查...');
  const { query } = await import('@anthropic-ai/claude-code');

  const projectId = config.projectId as string | undefined;
  const project = projectId ? getProjectById(projectId) : undefined;

  if (!project?.sourcePath) {
    for (const tc of suite.cases) {
      tc.status = 'failed';
      tc.error = '请选择项目并配置源码路径';
    }
    return;
  }

  // 读取审查规则
  const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
  const rulesPath = path.join(DATA_DIR, 'projects', projectId!, 'review-rules.json');
  let rulesContent = '';
  if (fs.existsSync(rulesPath)) {
    try {
      const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
      rulesContent = JSON.stringify(rules, null, 2);
    } catch { /* ignore */ }
  }

  // 读取发现数据中的模块信息
  const discoveryPath = path.join(DATA_DIR, 'projects', projectId!, 'review-discovery.json');
  let modules: any[] = [];
  if (fs.existsSync(discoveryPath)) {
    try {
      const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
      modules = discovery.modules || [];
    } catch { /* ignore */ }
  }

  const selectedModuleIds = (config.modules as string[]) || [];

  // 判断是否按模块审查
  const isPerModule = suite.cases.length > 1 || (selectedModuleIds.length > 0 && modules.length > 0);

  // 准备报告输出目录（按项目隔离）
  const projectSlug = project.name.replace(/[<>:"/\\|?*\s]+/g, '_');
  const reportsDir = path.join(getConfig().testDataDir || getConfig().e2eDataDir, 'codereview', 'reports', projectSlug);
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const abortController = new AbortController();
  abortControllers.set(suite.id, abortController);

  // 初始化 resumeInfo（如果不存在）
  if (!getResumeInfo(suite).cases || Object.keys(getResumeInfo(suite).cases).length === 0) {
    setResumeInfo(suite, { cases: {} });
  }
  const resumeInfo = getResumeInfo(suite);

  // 发出恢复提示事件
  const resumedCases: string[] = [];
  const skippedCases: string[] = [];
  for (let i = 0; i < suite.cases.length; i++) {
    const tc = suite.cases[i];
    const resumeCase = resumeInfo.cases[tc.id];
    if (resumeCase?.status === 'completed') {
      skippedCases.push(tc.id);
    } else if (resumeCase?.status === 'interrupted') {
      resumedCases.push(tc.id);
    }
  }
  if (skippedCases.length > 0 || resumedCases.length > 0) {
    testBus.emit('test:resumed', {
      suiteId: suite.id,
      resumedCases,
      skippedCases,
    });
  }

  try {
    if (isPerModule) {
      // ====== 按模块逐个审查 ======
      for (let i = 0; i < suite.cases.length; i++) {
        if (abortController.signal.aborted) {
          // 标记剩余 case 为中断
          for (let j = i; j < suite.cases.length; j++) {
            suite.cases[j].status = 'error';
            suite.cases[j].error = '用户手动停止';
          }
          break;
        }

        const tc = suite.cases[i];
        const moduleId = selectedModuleIds[i];
        const mod = modules.find((m: any) => m.id === moduleId);

        if (!mod) {
          tc.status = 'skipped' as any;
          tc.error = '未找到模块信息';
          continue;
        }

        // 检查 resumeInfo，跳过已完成的模块
        const resumeCase = resumeInfo.cases[tc.id];
        if (resumeCase?.status === 'completed') {
          tc.status = 'passed' as any;
          testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n⏭️ 跳过已完成: ${mod.name}\n\n` });
          continue;
        }

        const resumeSessionId = resumeCase?.status === 'interrupted'
          ? resumeCase.sessionId
          : undefined;

        // 构建模块级审查 Skill 变量
        const fileList = (mod.keyFiles || []).map((f: string) => `   - ${f}`).join('\n');
        const riskIndicators = (mod as any).riskIndicators || (mod.reason ? [mod.reason] : []);
        const riskText = riskIndicators.length > 0 ? riskIndicators.map((r: string) => `   - ${r}`).join('\n') : '无';

        const moduleInfoSection = `## 审查模块
- 模块名称: ${mod.name}
- 模块路径: ${mod.path}
- 文件数量: ${mod.files}
- 风险等级: ${mod.riskLevel || 'unknown'}
- 关注方向:
${riskText}

## 模块关键文件
${fileList}`;

        const skillContent = loadCodeReviewSkill({
          projectName: project.name,
          sourcePath: project.sourcePath!,
          framework: (project as any).framework || 'Vue 3 + Vite + Pinia',
          moduleInfoSection,
          rulesSection: rulesContent
            ? `## 审查筛查规则（参考指引）\n以下是筛查规则，定义了应该"查什么"和"怎么查"。请按这些规则的方法去检查实际代码，以你的实际分析结论为准，不要照搬规则描述。\n\n${rulesContent}`
            : '## 审查维度\n请从安全性、性能、错误处理、Vue最佳实践、可维护性五个维度审查。',
          reviewScope: '请重点扫描上述关键文件，以及模块路径下的其他相关文件。',
          scoreTitle: '模块评分',
          summaryTitle: '该模块的整体评价和改进建议',
          reportPath: path.join(reportsDir, `module-${tc.id}.md`).replace(/\\/g, '/'),
        });

        const modulePrompt = `请对项目 ${project.name} 的模块 "${mod.name}" 进行深度代码审查。`;

        await runSingleModuleReview(suite, tc, modulePrompt, project.sourcePath!, abortController, mod.name, resumeSessionId, skillContent);
      }

      // 从 AI 写入的模块报告文件合并生成 HTML 报告
      const moduleMdFiles: string[] = [];
      for (const c of suite.cases) {
        const moduleMdPath = path.join(reportsDir, `module-${c.id}.md`);
        if (fs.existsSync(moduleMdPath)) {
          moduleMdFiles.push(moduleMdPath);
        }
      }

      if (moduleMdFiles.length > 0) {
        try {
          const allOutputs = moduleMdFiles
            .map(f => fs.readFileSync(f, 'utf-8'))
            .filter(content => content.length > 50)
            .map((content, i) => {
              const c = suite.cases[i];
              return `---\n## ${c.name}\n\n${content}`;
            })
            .join('\n\n');
          if (allOutputs.length > 100) {
            const reportFile = path.join(reportsDir, `review-${suite.id}.html`);
            const totalDuration = suite.cases.reduce((s, c) => s + (c.duration || 0), 0);
            fs.writeFileSync(reportFile, buildReviewHtml(project.name, allOutputs, totalDuration), 'utf-8');
            suite.config.reportPath = reportFile;
          }
        } catch (err: any) {
          console.error('[CodeReview] 生成HTML报告失败:', err.message);
        }
      }

    } else {
      // ====== 全量审查（单 case，兼容旧逻辑） ======
      const mainCase = suite.cases[0];
      if (mainCase) {
        mainCase.name = `代码审查 (${project.name})`;
        mainCase.status = 'running';
        saveRun(suite);
      }

      const fullReportPath = mainCase
        ? path.join(reportsDir, `module-${mainCase.id}.md`).replace(/\\/g, '/')
        : '';

      const fullSkillContent = loadCodeReviewSkill({
        projectName: project.name,
        sourcePath: project.sourcePath!,
        framework: 'Vue 3 + Vite + Pinia',
        moduleInfoSection: '',
        rulesSection: rulesContent
          ? `## 审查筛查规则（参考指引）\n以下是筛查规则，定义了应该"查什么"和"怎么查"。请按这些规则的方法去检查实际代码，以你的实际分析结论为准，不要照搬规则描述。\n\n${rulesContent}`
          : '## 审查维度\n请从安全性、性能、错误处理、Vue最佳实践、可维护性五个维度审查。',
        reviewScope: `请扫描项目源码，重点关注以下文件：
1. src/pages/ 下的页面组件
2. src/components/ 下的通用组件
3. src/utils/ 和 src/api/ 下的工具和接口
4. 后端路由和控制器（如果有）`,
        scoreTitle: '总体评分',
        summaryTitle: '总体评价和改进建议',
        reportPath: fullReportPath,
      });

      const reviewPrompt = `请对项目 ${project.name} 的源代码进行全面审查。`;

      const startTime = Date.now();
      let fullOutput = '';
      const blocks: StreamBlock[] = [];

      const response = query({
        prompt: reviewPrompt,
        options: {
          cwd: project.sourcePath,
          allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
          maxTurns: 9999,
          permissionMode: 'bypassPermissions',
          abortController,
          appendSystemPrompt: fullSkillContent,
        },
      });

      for await (const msg of response) {
        if (abortController.signal.aborted) throw new Error('代码审查超时');

        switch (msg.type) {
          case 'assistant': {
            if ((msg as any).message?.content) {
              for (const block of (msg as any).message.content) {
                if (block.type === 'text') {
                  fullOutput += block.text;
                  blocks.push({ type: 'text', content: block.text });
                  testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: block.text });
                } else if (block.type === 'tool_use') {
                  blocks.push({ type: 'tool_use', name: block.name, input: block.input, toolUseId: block.id });
                  testBus.emit('agent:stream', { suiteId: suite.id, type: 'tool_use', name: block.name, input: block.input, id: block.id });
                }
              }
            }
            break;
          }
          case 'user': {
            if ('message' in msg && (msg as any).message?.content) {
              for (const block of (msg as any).message.content) {
                if (block.type === 'tool_result') {
                  const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                  const existingBlock = blocks.find(b => b.type === 'tool_use' && b.toolUseId === block.tool_use_id);
                  if (existingBlock) existingBlock.result = resultContent?.slice(0, 5000);
                  testBus.emit('agent:stream', { suiteId: suite.id, type: 'tool_result', toolUseId: block.tool_use_id, content: resultContent?.slice(0, 5000) });
                }
              }
            }
            break;
          }
          case 'result': {
            const resultMsg = msg as any;
            if (resultMsg.subtype === 'success' && resultMsg.result && !fullOutput) {
              fullOutput = resultMsg.result;
            }
            break;
          }
        }
      }

      if (mainCase) {
        mainCase.duration = Date.now() - startTime;
        mainCase.output = fullOutput;
        mainCase.blocks = blocks;
        mainCase.status = fullOutput.length > 100 ? 'passed' : 'failed';
        if (mainCase.status === 'failed') mainCase.error = '审查输出内容不足';
      }

      // 从 AI 写入的报告文件生成 HTML
      if (mainCase) {
        const moduleMdPath = path.join(reportsDir, `module-${mainCase.id}.md`);
        if (fs.existsSync(moduleMdPath)) {
          try {
            const mdContent = fs.readFileSync(moduleMdPath, 'utf-8');
            if (mdContent.length > 100) {
              const reportFile = path.join(reportsDir, `review-${suite.id}.html`);
              fs.writeFileSync(reportFile, buildReviewHtml(project.name, mdContent, mainCase.duration || 0), 'utf-8');
              suite.config.reportPath = reportFile;
            }
          } catch (err: any) {
            console.error('[CodeReview] 生成HTML报告失败:', err.message);
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[CodeReview] 审查出错:', err.message);
  }

  abortControllers.delete(suite.id);
  saveRun(suite);
}

/** 执行单个模块的审查 */
async function runSingleModuleReview(
  suite: TestSuite,
  tc: TestCase,
  modulePrompt: string,
  cwd: string,
  suiteAbortController: AbortController,
  moduleName: string,
  resumeSessionId?: string,
  skillContent?: string,
): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-code');

  tc.status = 'running';
  // 发出 case 级进度事件，让前端知道当前在审查哪个模块
  const resumePrefix = resumeSessionId ? '🔄 恢复审查: ' : '🔍 开始审查: ';
  testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n---\n## ${resumePrefix}${moduleName}\n\n` });
  saveRun(suite);

  const moduleAbortController = new AbortController();

  // 如果 suite 被中断，也中断当前模块
  const onSuiteAbort = () => moduleAbortController.abort();
  suiteAbortController.signal.addEventListener('abort', onSuiteAbort);

  const startTime = Date.now();
  let fullOutput = '';
  const blocks: StreamBlock[] = [];

  // 确保 resumeInfo 存在
  const currentResumeInfo = getResumeInfo(suite);
  if (!currentResumeInfo.cases) {
    setResumeInfo(suite, { cases: {} });
  }

  try {
    // 构建 query 选项：支持 resume 模式
    const queryOptions: Record<string, any> = {
      cwd,
      allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
      maxTurns: 9999,
      permissionMode: 'bypassPermissions',
      abortController: moduleAbortController,
      ...(skillContent ? { appendSystemPrompt: skillContent } : {}),
    };

    const promptText = resumeSessionId
      ? '请继续之前的代码审查，从中断处继续分析。保持之前的审查进度和结论。'
      : modulePrompt;

    if (resumeSessionId) {
      queryOptions.resume = resumeSessionId;
      queryOptions.forkSession = true;
    }

    const response = query({
      prompt: promptText,
      options: queryOptions,
    });

    let capturedSessionId = '';

    for await (const msg of response) {
      if (moduleAbortController.signal.aborted) throw new Error('审查被中断');

      switch (msg.type) {
        case 'system': {
          // 捕获 session_id
          const sessionId = (msg as any).session_id;
          if (sessionId) {
            capturedSessionId = sessionId;
          }
          break;
        }
        case 'assistant': {
          if ((msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'text') {
                fullOutput += block.text;
                blocks.push({ type: 'text', content: block.text });
                testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: block.text });
              } else if (block.type === 'tool_use') {
                blocks.push({ type: 'tool_use', name: block.name, input: block.input, toolUseId: block.id });
                testBus.emit('agent:stream', { suiteId: suite.id, type: 'tool_use', name: block.name, input: block.input, id: block.id });
              }
            }
          }
          break;
        }
        case 'user': {
          if ('message' in msg && (msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'tool_result') {
                const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                const existingBlock = blocks.find(b => b.type === 'tool_use' && b.toolUseId === block.tool_use_id);
                if (existingBlock) existingBlock.result = resultContent?.slice(0, 5000);
                testBus.emit('agent:stream', { suiteId: suite.id, type: 'tool_result', toolUseId: block.tool_use_id, content: resultContent?.slice(0, 5000) });
              }
            }
          }
          break;
        }
        case 'result': {
          const resultMsg = msg as any;
          if (resultMsg.subtype === 'success' && resultMsg.result && !fullOutput) {
            fullOutput = resultMsg.result;
          }
          break;
        }
      }
    }

    tc.duration = Date.now() - startTime;
    tc.output = fullOutput;
    tc.blocks = blocks;
    tc.status = fullOutput.length > 100 ? 'passed' : 'failed';
    if (tc.status === 'failed') tc.error = '审查输出内容不足';

    // 保存 resumeInfo：模块完成
    if (capturedSessionId) {
      const info = getResumeInfo(suite);
      info.cases[tc.id] = {
        sessionId: capturedSessionId,
        status: 'completed',
        partialOutput: fullOutput,
      };
      setResumeInfo(suite, info);
    }

    // 模块完成事件
    testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n\n${tc.status === 'passed' ? '✅' : '❌'} 模块审查完成: ${moduleName} (${(tc.duration / 1000).toFixed(1)}s)\n\n` });

  } catch (err: any) {
    tc.duration = Date.now() - startTime;
    tc.status = 'error';
    tc.error = err.message;
    tc.blocks = blocks;

    // 保存 resumeInfo：模块中断
    // 尝试找到已有的 sessionId（来自 resume 或首次运行的 system 消息）
    const info = getResumeInfo(suite);
    const existingResume = info.cases[tc.id];
    const sessionIdToSave = existingResume?.sessionId || '';
    if (sessionIdToSave) {
      info.cases[tc.id] = {
        sessionId: sessionIdToSave,
        status: 'interrupted',
        partialOutput: fullOutput,
      };
      setResumeInfo(suite, info);
    }

    testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n\n💥 模块审查中断: ${moduleName} - ${err.message}\n\n` });
  } finally {
    suiteAbortController.signal.removeEventListener('abort', onSuiteAbort);
  }

  // 每个 case 完成后保存，确保中断时已完成的 case 不丢失
  saveRun(suite);
  testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: tc.status, duration: tc.duration });
}

/** 将 Markdown 审查结果转为独立 HTML 报告（服务端渲染，无 CDN 依赖） */
function buildReviewHtml(projectName: string, markdown: string, duration: number): string {
  const durationSec = (duration / 1000).toFixed(1);

  // 服务端完成 Markdown 解析，按模块分割并渲染为 HTML
  const moduleRegex = /^---\s*\n##\s+(.+)$/gm;
  const modules: { title: string; content: string; html: string }[] = [];
  let match: RegExpExecArray | null;
  const splits: { title: string; index: number; end: number }[] = [];
  while ((match = moduleRegex.exec(markdown)) !== null) {
    splits.push({ title: match[1].trim(), index: match.index, end: match.index + match[0].length });
  }

  if (splits.length === 0) {
    modules.push({ title: '完整审查报告', content: markdown, html: marked.parse(markdown) as string });
  } else {
    for (let i = 0; i < splits.length; i++) {
      const start = splits[i].end;
      const end = i + 1 < splits.length ? splits[i + 1].index : markdown.length;
      const content = markdown.substring(start, end).trim();
      modules.push({ title: splits[i].title, content, html: marked.parse(content) as string });
    }
  }

  // 统计严重等级
  let criticalCount = 0, warningCount = 0, infoCount = 0;
  for (const m of modules) {
    criticalCount += (m.content.match(/🔴/g) || []).length;
    warningCount += (m.content.match(/🟡/g) || []).length;
    infoCount += (m.content.match(/🔵/g) || []).length;
  }

  // 提取评分
  function extractScore(content: string): number | null {
    const scoreMatch = content.match(/模块评分[：:]\s*(\d+)/);
    if (scoreMatch) return parseInt(scoreMatch[1]);
    const ratingMatch = content.match(/总体评分[：:]\s*(\d+)/);
    if (ratingMatch) return parseInt(ratingMatch[1]);
    return null;
  }

  function extractRisk(title: string): string {
    if (/高风险/.test(title)) return 'high';
    if (/中风险/.test(title)) return 'medium';
    if (/低风险/.test(title)) return 'low';
    return '';
  }

  // 构建侧边栏 HTML
  let sidebarHtml = '';
  modules.forEach((m, i) => {
    const score = extractScore(m.content);
    const risk = extractRisk(m.title);
    const riskTag = risk ? `<span class="risk ${risk}">${risk === 'high' ? '高' : risk === 'medium' ? '中' : '低'}</span>` : '';
    const scoreTag = score !== null ? `<span class="score">${score}</span>` : '';
    sidebarHtml += `<div class="sidebar-item${i === 0 ? ' active' : ''}" data-idx="${i}">${riskTag}<span class="name">${m.title}</span>${scoreTag}</div>`;
  });

  // 构建内容区 HTML
  let contentHtml = '';
  modules.forEach((m, i) => {
    contentHtml += `<div class="module-section${i === 0 ? ' active' : ''}" id="module-${i}"><h1>${m.title}</h1><div>${m.html}</div></div>`;
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>代码审查报告 - ${projectName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; color: #333; }
  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 24px 32px; }
  .header h1 { font-size: 24px; margin-bottom: 4px; }
  .header .meta { font-size: 14px; opacity: 0.8; }
  .header .engine-tag { display: inline-block; background: #667eea; color: white; padding: 2px 10px; border-radius: 4px; font-size: 12px; margin-left: 8px; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 24px 32px; background: white; border-bottom: 1px solid #e8e8e8; }
  .summary-card { text-align: center; padding: 16px; border-radius: 8px; background: #f9fafb; }
  .summary-card .value { font-size: 32px; font-weight: 700; }
  .summary-card .label { font-size: 13px; color: #666; margin-top: 4px; }
  .pass { color: #52c41a; } .warn { color: #faad14; } .fail { color: #ff4d4f; } .info { color: #3182ce; }
  .container { display: flex; min-height: calc(100vh - 260px); }
  .sidebar { width: 280px; background: white; border-right: 1px solid #e8e8e8; overflow-y: auto; }
  .sidebar-item { padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .sidebar-item:hover { background: #f5f5f5; }
  .sidebar-item.active { background: #e6f7ff; border-left: 3px solid #1890ff; }
  .sidebar-item .score { font-size: 12px; color: #999; margin-left: auto; font-weight: 600; }
  .sidebar-item .risk { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 500; }
  .sidebar-item .risk.high { background: #fff1f0; color: #cf1322; }
  .sidebar-item .risk.medium { background: #fffbe6; color: #d48806; }
  .sidebar-item .risk.low { background: #e6f7ff; color: #1890ff; }
  .content { flex: 1; padding: 24px 32px; overflow-y: auto; }
  .module-section { display: none; }
  .module-section.active { display: block; }
  .module-section h1 { font-size: 20px; color: #1a1a2e; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #667eea; }
  .module-section h2 { font-size: 17px; color: #2d3748; margin: 20px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
  .module-section h3 { font-size: 15px; color: #4a5568; margin: 16px 0 8px; }
  .module-section p { margin: 6px 0; line-height: 1.8; font-size: 14px; }
  .module-section ul, .module-section ol { padding-left: 20px; margin: 6px 0; }
  .module-section li { margin: 3px 0; font-size: 14px; line-height: 1.7; }
  .module-section code { background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 13px; color: #e53e3e; }
  .module-section pre { background: #1e1e2e; color: #cdd6f4; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 12px 0; font-size: 13px; line-height: 1.5; }
  .module-section pre code { background: none; color: #cdd6f4; padding: 0; }
  .module-section strong { color: #2d3748; }
  .module-section table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  .module-section th { background: #f7f8fc; padding: 8px 12px; text-align: left; border: 1px solid #e8e8e8; font-weight: 600; }
  .module-section td { padding: 8px 12px; border: 1px solid #e8e8e8; }
  .module-section blockquote { border-left: 4px solid #667eea; padding: 8px 16px; background: #f0f0ff; margin: 12px 0; border-radius: 0 6px 6px 0; }
  .module-section hr { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0; }
  .footer { text-align: center; padding: 16px; font-size: 12px; color: #a0aec0; background: white; border-top: 1px solid #e8e8e8; }
</style>
</head>
<body>

<div class="header">
  <h1>代码审查报告 <span class="engine-tag">Claude Code AI</span></h1>
  <div class="meta">项目: ${projectName} | 耗时: ${durationSec}s | 生成时间: ${new Date().toLocaleString('zh-CN')}</div>
</div>

<div class="summary">
  <div class="summary-card">
    <div class="value">${modules.length}</div>
    <div class="label">审查模块</div>
  </div>
  <div class="summary-card">
    <div class="value fail">${criticalCount}</div>
    <div class="label">严重问题</div>
  </div>
  <div class="summary-card">
    <div class="value warn">${warningCount}</div>
    <div class="label">警告问题</div>
  </div>
  <div class="summary-card">
    <div class="value info">${infoCount}</div>
    <div class="label">建议改进</div>
  </div>
</div>

<div class="container">
  <div class="sidebar" id="sidebar">${sidebarHtml}</div>
  <div class="content">${contentHtml}</div>
</div>

<div class="footer">由 AI Platform 自动生成</div>

<script>
document.querySelectorAll('.sidebar-item').forEach(function(item) {
  item.addEventListener('click', function() {
    document.querySelectorAll('.sidebar-item').forEach(function(el) { el.classList.remove('active'); });
    item.classList.add('active');
    document.querySelectorAll('.module-section').forEach(function(el) { el.classList.remove('active'); });
    document.getElementById('module-' + item.getAttribute('data-idx')).classList.add('active');
  });
});
</script>
</body>
</html>`;
}

// ========== 主入口 ==========

export function createTestSuite(type: TestType, config: Record<string, unknown> = {}): TestSuite {
  const cases: TestCase[] = [];

  switch (type) {
    case 'agent':
      cases.push(
        { id: uuid(), name: '基础对话响应', type, status: 'pending' },
        { id: uuid(), name: '工具调用测试', type, status: 'pending' },
        { id: uuid(), name: '代码理解测试', type, status: 'pending' },
      );
      break;
    case 'e2e': {
      const mode = (config.mode as string) || 'standard';
      const scope = (config.scope as string) || 'all';
      const projectId = config.projectId as string | undefined;
      const project = projectId ? getProjectById(projectId) : undefined;
      const label = project ? `${project.name} ${scope}` : scope;
      cases.push({ id: uuid(), name: `E2E ${mode} 测试 (${label})`, type, status: 'pending' });
      break;
    }
    case 'frontend': {
      const projectId = config.projectId as string | undefined;
      if (projectId) {
        const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
        const discoveryPath = path.join(DATA_DIR, 'projects', projectId, 'frontend-discovery.json');
        if (fs.existsSync(discoveryPath)) {
          try {
            const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
            const allModules = discovery.modules || [];
            const selectedIds = (config.modules as string[]) || allModules.map((m: any) => m.id);
            for (const mod of allModules) {
              if (!selectedIds.includes(mod.id)) continue;
              const fileCount = mod.files?.length || 0;
              if (fileCount === 0) continue; // 跳过空模块
              cases.push({
                id: uuid(),
                name: `${mod.name} (${fileCount} 文件)`,
                type,
                status: 'pending',
              });
            }
          } catch { /* fallback below */ }
        }
      }
      if (cases.length === 0) {
        cases.push({ id: uuid(), name: 'Vitest 前端单元测试', type, status: 'pending' });
      }
      break;
    }
    case 'api': {
      // 尝试从发现的 api-tests.json 动态生成 cases
      const projectId = config.projectId as string | undefined;
      if (projectId) {
        const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
        const testsPath = path.join(DATA_DIR, 'projects', projectId, 'api-tests.json');
        if (fs.existsSync(testsPath)) {
          try {
            const testConfig = JSON.parse(fs.readFileSync(testsPath, 'utf-8'));
            const selectedModules = (config.modules as string[]) || testConfig.testModules?.map((m: any) => m.moduleId) || [];
            for (const mod of (testConfig.testModules || [])) {
              if (!selectedModules.includes(mod.moduleId)) continue;
              for (const test of (mod.tests || [])) {
                cases.push({ id: uuid(), name: `[${mod.moduleName}] ${test.name}`, type, status: 'pending' });
              }
            }
          } catch { /* fallback below */ }
        }
      }
      // fallback 硬编码
      if (cases.length === 0) {
        cases.push(
          { id: uuid(), name: 'Health API', type, status: 'pending' },
          { id: uuid(), name: 'Skills 列表', type, status: 'pending' },
          { id: uuid(), name: 'Schools 列表', type, status: 'pending' },
          { id: uuid(), name: 'Workflows 列表', type, status: 'pending' },
          { id: uuid(), name: 'Sessions 列表', type, status: 'pending' },
        );
      }
      break;
    }
    case 'codereview': {
      const projectId = config.projectId as string | undefined;
      if (projectId) {
        const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
        const discoveryPath = path.join(DATA_DIR, 'projects', projectId, 'review-discovery.json');
        if (fs.existsSync(discoveryPath)) {
          try {
            const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
            const allModules = discovery.modules || [];
            const selectedIds = (config.modules as string[]) || allModules.map((m: any) => m.id);
            for (const mod of allModules) {
              if (!selectedIds.includes(mod.id)) continue;
              const riskLabel = mod.riskLevel === 'high' ? '高风险' : mod.riskLevel === 'medium' ? '中风险' : mod.riskLevel === 'low' ? '低风险' : '';
              cases.push({
                id: uuid(),
                name: `${mod.name} (${mod.files} 文件${riskLabel ? ', ' + riskLabel : ''})`,
                type,
                status: 'pending',
              });
            }
          } catch { /* fallback below */ }
        }
      }
      if (cases.length === 0) {
        const project = projectId ? getProjectById(projectId) : undefined;
        cases.push({ id: uuid(), name: `代码审查 (${project ? project.name : '全部'})`, type, status: 'pending' });
      }
      break;
    }
  }

  const suite: TestSuite = {
    id: uuid(),
    name: `${type === 'agent' ? 'Agent智能体' : type === 'e2e' ? (() => { const p = (config.projectId as string) ? getProjectById(config.projectId as string) : undefined; return `E2E页面(${p ? p.name : (config.scope as string) || 'all'})`; })() : type === 'frontend' ? (() => { const p = (config.projectId as string) ? getProjectById(config.projectId as string) : undefined; const mc = cases.length; return `前端单元(${p ? p.name : '全部'}${mc > 1 ? `, ${mc}模块` : ''})`; })() : type === 'codereview' ? (() => { const p = (config.projectId as string) ? getProjectById(config.projectId as string) : undefined; const mc = cases.length; return `代码审查(${p ? p.name : '全部'}${mc > 1 ? `, ${mc}模块` : ''})`; })() : 'API接口'}测试`,
    type,
    status: 'pending',
    cases,
    startedAt: new Date().toISOString(),
    config,
  };

  runs.set(suite.id, suite);
  saveRun(suite);
  return suite;
}

/** 恢复中断的代码审查 */
export async function resumeTestRun(originalSuiteId: string): Promise<string> {
  const original = getTestRun(originalSuiteId);
  if (!original) throw new Error('未找到原始测试记录');
  if (original.type !== 'codereview') throw new Error('仅支持代码审查类型的恢复');

  // 检查是否有中断的 case
  const resumeInfo = getResumeInfo(original) as ResumeInfo | null;
  const hasInterrupted = resumeInfo?.cases && Object.values(resumeInfo.cases).some((c: ResumeCaseInfo) => c.status === 'interrupted');
  const hasPending = original.cases.some(c => c.status === 'error' || c.status === 'pending');

  if (!hasInterrupted && !hasPending) {
    throw new Error('没有需要恢复的模块');
  }

  // 创建新 suite，复制配置和 resumeInfo
  const suite = createTestSuite(original.type, {
    ...original.config,
    resumeInfo: resumeInfo || { cases: {} },
  });

  return suite.id;
}

/** 人工对话（基于审查上下文） */
export async function chatWithReview(suiteId: string, message: string): Promise<string> {
  const suite = getTestRun(suiteId);
  if (!suite) throw new Error('未找到测试记录');

  const projectId = suite.config.projectId as string;
  const project = projectId ? getProjectById(projectId) : undefined;
  if (!project?.sourcePath) throw new Error('项目源码路径未配置');

  // 找到最近有 sessionId 的 case
  const resumeInfo = getResumeInfo(suite);
  let sessionId = '';

  if (resumeInfo?.cases && Object.keys(resumeInfo.cases).length > 0) {
    // 优先找 completed 的（有完整上下文），其次找 interrupted 的
    const caseEntries = Object.entries(resumeInfo.cases);
    const completedCase = caseEntries.find(([_, info]) => info.status === 'completed');
    const interruptedCase = caseEntries.find(([_, info]) => info.status === 'interrupted');
    const targetCase = completedCase || interruptedCase;
    if (targetCase) {
      sessionId = targetCase[1].sessionId;
    }
  }

  if (!sessionId) throw new Error('无可用的会话上下文');

  // 创建一个虚拟的 chat case
  const { query } = await import('@anthropic-ai/claude-code');
  const chatCaseId = uuid();
  const chatCase: TestCase = {
    id: chatCaseId,
    name: `💬 ${message.slice(0, 30)}`,
    type: 'codereview',
    status: 'running',
  };

  // 如果原 suite 已完成，需要重新打开；如果正在运行，追加到原 suite
  const targetSuite = suite;
  if (targetSuite.status !== 'running') {
    targetSuite.status = 'running';
    targetSuite.finishedAt = undefined;
  }
  targetSuite.cases.push(chatCase);
  saveRun(targetSuite);

  const abortController = new AbortController();
  abortControllers.set(`chat-${chatCaseId}`, abortController);

  const startTime = Date.now();
  let fullOutput = '';
  const blocks: StreamBlock[] = [];
  let newSessionId = '';

  try {
    testBus.emit('agent:chat', {
      suiteId: targetSuite.id,
      caseId: chatCaseId,
      type: 'text',
      content: `\n💬 你: ${message}\n\n`,
    });

    const response = query({
      prompt: message,
      options: {
        resume: sessionId,
        forkSession: true,
        cwd: project.sourcePath,
        allowedTools: ['Read', 'Glob', 'Grep'],
        maxTurns: 9999,
        permissionMode: 'bypassPermissions',
        abortController,
      },
    });

    for await (const msg of response) {
      if (abortController.signal.aborted) throw new Error('对话被中断');

      switch (msg.type) {
        case 'system': {
          const sid = (msg as any).session_id;
          if (sid) newSessionId = sid;
          break;
        }
        case 'assistant': {
          if ((msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'text') {
                fullOutput += block.text;
                blocks.push({ type: 'text', content: block.text });
                testBus.emit('agent:chat', {
                  suiteId: targetSuite.id,
                  caseId: chatCaseId,
                  type: 'text',
                  content: block.text,
                });
              } else if (block.type === 'tool_use') {
                blocks.push({ type: 'tool_use', name: block.name, input: block.input, toolUseId: block.id });
                testBus.emit('agent:chat', {
                  suiteId: targetSuite.id,
                  caseId: chatCaseId,
                  type: 'tool_use',
                  name: block.name,
                  input: block.input,
                  id: block.id,
                });
              }
            }
          }
          break;
        }
        case 'user': {
          if ('message' in msg && (msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'tool_result') {
                const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                const existingBlock = blocks.find(b => b.type === 'tool_use' && b.toolUseId === block.tool_use_id);
                if (existingBlock) existingBlock.result = resultContent?.slice(0, 5000);
                testBus.emit('agent:chat', {
                  suiteId: targetSuite.id,
                  caseId: chatCaseId,
                  type: 'tool_result',
                  toolUseId: block.tool_use_id,
                  content: resultContent?.slice(0, 5000),
                });
              }
            }
          }
          break;
        }
        case 'result': {
          const resultMsg = msg as any;
          if (resultMsg.subtype === 'success' && resultMsg.result && !fullOutput) {
            fullOutput = resultMsg.result;
          }
          break;
        }
      }
    }

    chatCase.duration = Date.now() - startTime;
    chatCase.output = fullOutput;
    chatCase.blocks = blocks;
    chatCase.status = 'passed';

    // 更新 resumeInfo 中的 sessionId（供下次对话使用）
    if (newSessionId) {
      const info = getResumeInfo(targetSuite);
      info.cases[chatCaseId] = {
        sessionId: newSessionId,
        status: 'completed',
        partialOutput: fullOutput,
      };
      setResumeInfo(targetSuite, info);
    }

  } catch (err: any) {
    chatCase.duration = Date.now() - startTime;
    chatCase.status = 'error';
    chatCase.error = err.message;
    chatCase.blocks = blocks;
  }

  abortControllers.delete(`chat-${chatCaseId}`);
  saveRun(targetSuite);
  testBus.emit('test:update', { suiteId: targetSuite.id, caseId: chatCaseId, caseName: chatCase.name, status: chatCase.status, duration: chatCase.duration });

  return targetSuite.id;
}

export async function executeTestRun(suiteId: string): Promise<TestSuite> {
  const suite = runs.get(suiteId);
  if (!suite) throw new Error('Test run not found');

  // 端口预检
  const checkError = await preflightCheck(suite.type, suite.config);
  if (checkError) {
    suite.status = 'error';
    for (const tc of suite.cases) {
      tc.status = 'error';
      tc.error = checkError;
    }
    suite.finishedAt = new Date().toISOString();
    suite.duration = 0;
    saveRun(suite);
    testBus.emit('test:start', { suiteId: suite.id });
    testBus.emit('test:done', { suiteId: suite.id, status: 'error', error: checkError });
    return suite;
  }

  // 入队执行（按类型分队列）
  return new Promise<TestSuite>((resolve, reject) => {
    typeQueues[suite.type].push({ suiteId, resolve, reject });
    processTypeQueue(suite.type);
  });
}

async function executeTestRunInternal(suiteId: string): Promise<TestSuite> {
  const suite = runs.get(suiteId);
  if (!suite) throw new Error('Test run not found');

  suite.status = 'running';
  saveRun(suite);
  testBus.emit('test:start', { suiteId: suite.id });

  try {
    switch (suite.type) {
      case 'agent':      await runAgentTest(suite, suite.config); break;
      case 'e2e':        await runE2ETest(suite, suite.config); break;
      case 'frontend':   await runFrontendTest(suite, suite.config); break;
      case 'api':        await runApiTest(suite, suite.config); break;
      case 'codereview': await runCodeReview(suite, suite.config); break;
    }

    const allPassed = suite.cases.every(c => c.status === 'passed');
    const anyFailed = suite.cases.some(c => c.status === 'failed' || c.status === 'error');
    suite.status = allPassed ? 'passed' : anyFailed ? 'failed' : 'passed';
  } catch (err: any) {
    suite.status = 'error';
  }

  suite.finishedAt = new Date().toISOString();
  suite.duration = new Date(suite.finishedAt).getTime() - new Date(suite.startedAt).getTime();
  saveRun(suite);
  testBus.emit('test:done', { suiteId: suite.id, status: suite.status });

  return suite;
}

export function abortTestRun(id: string): boolean {
  const ac = abortControllers.get(id);
  if (!ac) return false;
  ac.abort();
  abortControllers.delete(id);
  return true;
}

export function deleteTestRun(id: string): boolean {
  const suite = runs.get(id);
  const existed = runs.delete(id);
  if (existed) {
    // 根据类型找对应的 runs 目录
    const type = suite?.type;
    if (type) {
      const f = path.join(getRunsDir(type), `${id}.json`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } else {
      // 不知道类型，在所有目录中找
      for (const t of ALL_TYPES) {
        const f = path.join(getRunsDir(t), `${id}.json`);
        if (fs.existsSync(f)) { fs.unlinkSync(f); break; }
      }
      const f = path.join(legacyRunsDir, `${id}.json`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
  return existed;
}

/** 获取当前运行中的测试列表 */
export function listRunningSuites(): TestSuite[] {
  return Array.from(runs.values()).filter(s => s.status === 'running');
}

/** 获取/设置并发配置 */
export function getConcurrency(): Record<TestType, number> {
  return { ...CONCURRENCY };
}

export function setConcurrency(type: TestType, val: number): void {
  if (val >= 1 && val <= 5) {
    CONCURRENCY[type] = val;
    processTypeQueue(type); // 可能立即启动排队的测试
  }
}

// ========== 生成提示词（供前端复制到 Claude Code 手动执行） ==========

export interface GeneratedPrompt {
  prompt: string;
  cwd: string;
}

export function generateTestPrompt(type: TestType, config: Record<string, unknown>): GeneratedPrompt {
  const base = getConfig().aiPlatformRoot;
  const projectId = config.projectId as string | undefined;
  const project = projectId ? getProjectById(projectId) : undefined;

  if (type === 'codereview') {
    if (!project?.sourcePath) throw new Error('请选择项目并配置源码路径');
    const skillFile = path.resolve(base, 'skills', 'tests', 'code-review', 'SKILL.md');
    const projectSlug = project.name.replace(/[<>:"/\\|?*\s]+/g, '_');
    const reportsDir = path.join(getConfig().testDataDir || getConfig().e2eDataDir, 'codereview', 'reports', projectSlug);
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
    const selectedModuleIds = (config.modules as string[]) || [];

    // 读取审查规则
    const rulesPath = path.join(DATA_DIR, 'projects', projectId!, 'review-rules.json');
    let rulesSection = '## 审查维度\n请从安全性、性能、错误处理、Vue最佳实践、可维护性五个维度审查。';
    if (fs.existsSync(rulesPath)) {
      try {
        const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
        rulesSection = `## 审查筛查规则（参考指引）\n以下是筛查规则，定义了应该"查什么"和"怎么查"。请按这些规则的方法去检查实际代码，以你的实际分析结论为准，不要照搬规则描述。\n\n${JSON.stringify(rules, null, 2)}`;
      } catch { /* ignore */ }
    }

    // 读取模块信息并筛选选中的
    const discoveryPath = path.join(DATA_DIR, 'projects', projectId!, 'review-discovery.json');
    let allModules: any[] = [];
    if (fs.existsSync(discoveryPath)) {
      try {
        const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
        allModules = discovery.modules || [];
      } catch { /* ignore */ }
    }

    const selectedModules = allModules.filter((m: any) => selectedModuleIds.includes(m.id));
    const framework = (project as any).framework || 'Vue 3 + Vite + Pinia';

    // 按模块逐个生成审查指令
    if (selectedModules.length > 0) {
      const moduleParts = selectedModules.map((mod: any, idx: number) => {
        const fileList = (mod.keyFiles || []).map((f: string) => `   - ${f}`).join('\n');
        const riskIndicators = (mod as any).riskIndicators || (mod.reason ? [mod.reason] : []);
        const riskText = riskIndicators.length > 0 ? riskIndicators.map((r: string) => `   - ${r}`).join('\n') : '无';
        const reportPath = path.join(reportsDir, `manual-module-${idx + 1}.md`).replace(/\\/g, '/');

        return `### 模块 ${idx + 1}: ${mod.name}
- 模块路径: ${mod.path}
- 文件数量: ${mod.files}
- 风险等级: ${mod.riskLevel || 'unknown'}
- 关注方向:
${riskText}
- 关键文件:
${fileList}
- 报告输出路径: ${reportPath}`;
      }).join('\n\n');

      const prompt = `请先 Read 以下 Skill 文件理解审查流程，然后对指定模块逐个执行代码审查。

Skill 文件: ${skillFile.replace(/\\/g, '/')}

## 项目信息
- 项目名称: ${project.name}
- 源码路径: ${project.sourcePath}
- 前端框架: ${framework}

${rulesSection}

## 待审查模块 (${selectedModules.length}个)
${moduleParts}

## 执行方式
对每个模块分别审查，按 Skill 中定义的格式生成报告，用 Write 工具写入各模块对应的「报告输出路径」。
全部模块审查完成后，汇总所有模块报告生成一份 HTML 报告。`;

      return { prompt, cwd: project.sourcePath };
    }

    // 全量审查
    const reportPath = path.join(reportsDir, `review-full-manual-${Date.now()}.md`).replace(/\\/g, '/');
    const prompt = `请先 Read 以下 Skill 文件理解审查流程，然后对项目进行全面代码审查。

Skill 文件: ${skillFile.replace(/\\/g, '/')}

## 项目信息
- 项目名称: ${project.name}
- 源码路径: ${project.sourcePath}
- 前端框架: ${framework}

${rulesSection}

## 审查范围
请扫描项目源码全面审查，重点关注 src/pages/、src/components/、src/utils/、src/api/ 等目录。

## 执行方式
按 Skill 中定义的格式生成报告，用 Write 工具写入: ${reportPath}`;

    return { prompt, cwd: project.sourcePath };
  }

  if (type === 'e2e') {
    if (!project) throw new Error('请选择项目');
    const skillFile = path.resolve(base, 'skills', 'tests', 'e2e-page-test', 'SKILL.md');
    const mode = (config.mode as string) || 'standard';
    const scope = (config.scope as string) || 'all';
    const projectSlug = project.name.replace(/[<>:"/\\|?*\s]+/g, '_');
    const e2eDataDir = (getConfig().testDataDir || getConfig().e2eDataDir).replace(/\\/g, '/');

    // 构建页面列表
    const pages = resolvePages(project, scope);
    const pageList = pages.map(p => `- ${p.name}: ${project.baseUrl}${p.url}`).join('\n');

    // 构建参数映射
    const paramsInfo = project.globalParams && Object.keys(project.globalParams).length > 0
      ? `动态参数映射：\n${Object.entries(project.globalParams).map(([k, v]) => `  - ${k}: ${(v as string[]).join(', ')}`).join('\n')}`
      : '';

    const prompt = `请先 Read 以下 Skill 文件，理解测试流程，然后执行 E2E 页面测试。

Skill 文件: ${skillFile.replace(/\\/g, '/')}
工作目录: ${project.sourcePath || base}

## 项目信息
- 项目名称: ${project.name}
- 前端地址: ${project.baseUrl}
- 后端 API: ${project.apiBaseUrl || project.baseUrl}
- 登录页: ${project.baseUrl}${project.loginUrl || ''}
- 登录凭据: ${project.username} / ${project.password}
${paramsInfo ? `\n${paramsInfo}\n` : ''}
## 测试配置
- 模式: ${mode}
- 范围: ${scope}
- e2eDataDir: ${e2eDataDir}
- projectName: ${projectSlug}

## 待测试页面 (${pages.length}页)
${pageList}

请严格按照 Skill 文件中的流程执行：登录 → 逐页测试（observe → think → act → validate）→ 生成报告。

输入参数（Skill 中引用的变量）：
\`\`\`json
{"mode": "${mode}", "scope": "${scope}"${projectId ? `, "projectId": "${projectId}"` : ''}, "e2eDataDir": "${e2eDataDir}", "projectName": "${projectSlug}"}
\`\`\`

注意：测试产物请写入 e2eDataDir 对应的目录结构中，路径中包含项目名 ${projectSlug}。`;

    return { prompt, cwd: project.sourcePath || base };
  }

  throw new Error(`类型 ${type} 暂不支持生成提示词`);
}
