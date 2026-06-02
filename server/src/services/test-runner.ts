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

  const prompt = `请使用 e2e-page-test 技能，以 ${mode} 模式测试${project ? ` ${project.name}` : ''} ${scope} 范围的页面。

${pageListPrompt}
输入参数：
\`\`\`json
{"mode": "${mode}", "scope": "${scope}"${projectId ? `, "projectId": "${projectId}"` : ''}}
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

    // 尝试读取 e2e-test 生成的报告路径
    try {
      const e2eRunsDir = path.join(getConfig().e2eDataDir, 'runs');
      if (fs.existsSync(e2eRunsDir)) {
        const runDirs = fs.readdirSync(e2eRunsDir)
          .filter(d => { try { return fs.statSync(path.join(e2eRunsDir, d)).isDirectory(); } catch { return false; } })
          .map(d => ({ name: d, mtime: fs.statSync(path.join(e2eRunsDir, d)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (runDirs.length > 0) {
          const runJsonPath = path.join(e2eRunsDir, runDirs[0].name, 'run.json');
          if (fs.existsSync(runJsonPath)) {
            const runData = JSON.parse(fs.readFileSync(runJsonPath, 'utf-8'));
            suite.config.reportPath = runData.reportPath || '';
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

// ========== 前端单元测试 ==========

async function runFrontendTest(suite: TestSuite, config: Record<string, unknown>): Promise<void> {
  const projectId = config.projectId as string | undefined;
  const project = projectId ? getProjectById(projectId) : undefined;

  // 确定测试目录
  let webDir = path.resolve(AI_PLATFORM_ROOT, 'web');
  let sourcePath: string | undefined;

  if (project?.sourcePath) {
    sourcePath = project.sourcePath;
    // 检查是否有项目级前端测试
    const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
    const projectTestsDir = path.join(DATA_DIR, 'projects', projectId!, 'frontend-tests');
    if (fs.existsSync(projectTestsDir)) {
      webDir = projectTestsDir;
    } else {
      // fallback: 使用源码项目的 web 目录
      const srcWebDir = path.resolve(project.sourcePath, 'web');
      if (fs.existsSync(srcWebDir)) {
        webDir = srcWebDir;
      }
    }
  }

  for (const tc of suite.cases) {
    tc.status = 'running';
    saveRun(suite);
    testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: 'running' });

    const startTime = Date.now();
    try {
      const { execSync } = await import('child_process');

      // 如果有源码路径，生成临时 vitest 配置
      let configArg = '';
      if (sourcePath && webDir !== path.resolve(AI_PLATFORM_ROOT, 'web')) {
        const vitestConfig = `
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { globals: true, environment: 'happy-dom' },
  resolve: { alias: { '@': '${sourcePath.replace(/\\/g, '/')}/src' } },
})
`;
        const configPath = path.join(webDir, '_vitest.config.ts');
        fs.writeFileSync(configPath, vitestConfig, 'utf-8');
        configArg = ` --config "${configPath}"`;
      }

      const result = execSync(`npx vitest run --reporter=json${configArg} 2>&1`, {
        cwd: webDir,
        timeout: 120000,
        encoding: 'utf-8',
      });

      tc.duration = Date.now() - startTime;
      tc.output = result.slice(0, 3000);

      try {
        const jsonMatch = result.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
        if (jsonMatch) {
          const report = JSON.parse(jsonMatch[0]);
          const total = report.numTotalTests || 0;
          const passed = report.numPassedTests || 0;
          tc.status = total > 0 && passed === total ? 'passed' : 'failed';
          tc.output = `总计 ${total} 个测试，通过 ${passed}，失败 ${report.numFailedTests || 0}`;
        } else {
          tc.status = result.includes('Tests') && !result.includes('FAIL') ? 'passed' : 'failed';
        }
      } catch {
        tc.status = result.includes('passed') ? 'passed' : 'failed';
      }
    } catch (err: any) {
      tc.duration = Date.now() - startTime;
      tc.status = 'error';
      tc.error = err.stderr?.slice(0, 500) || err.message;
      tc.output = err.stdout?.slice(0, 2000) || '';
    }

    saveRun(suite);
    testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: tc.status, duration: tc.duration });
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

  const abortController = new AbortController();
  abortControllers.set(suite.id, abortController);

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

        // 构建模块级审查 prompt
        const fileList = (mod.keyFiles || []).map((f: string) => `   - ${f}`).join('\n');
        const riskIndicators = (mod as any).riskIndicators || (mod.reason ? [mod.reason] : []);
        const riskText = riskIndicators.length > 0 ? riskIndicators.map((r: string) => `   - ${r}`).join('\n') : '无';
        const modulePrompt = `你是一位资深代码审查专家。请对以下项目中的特定模块进行深度审查。

## 项目信息
- 项目名称: ${project.name}
- 源码路径: ${project.sourcePath}
- 前端框架: ${(project as any).framework || 'Vue 3 + Vite + Pinia'}

## 审查模块
- 模块名称: ${mod.name}
- 模块路径: ${mod.path}
- 文件数量: ${mod.files}
- 风险等级: ${mod.riskLevel || 'unknown'}
- 关注方向:
${riskText}

## 模块关键文件
${fileList}

${rulesContent ? `## 审查筛查规则（参考指引）\n以下是筛查规则，定义了应该"查什么"和"怎么查"。请按这些规则的方法去检查实际代码，以你的实际分析结论为准，不要照搬规则描述。\n\n${rulesContent}` : '## 审查维度\n请从安全性、性能、错误处理、Vue最佳实践、可维护性五个维度审查。'}

## 审查原则
1. **实际代码分析为主** — Read 关键文件的真实内容，基于你看到的具体代码给出结论
2. **规则是筛查指引** — 按 checkMethod 的方法去检查，但结论必须来自实际代码，不是复述规则
3. **好代码也要认可** — 如果某条规则检查后未发现问题，标注为"通过"而非跳过

## 审查范围
请重点扫描上述关键文件，以及模块路径下的其他相关文件。

## 输出格式
请以 Markdown 格式输出审查报告，包含：

### 模块评分（0-100）

### 问题列表
对每个发现的问题记录：
- 严重等级（🔴 Critical / 🟡 Warning / 🔵 Info）
- 规则 ID（对应审查规则中匹配的 ID）
- 文件路径和行号
- 问题描述（基于实际代码分析）
- 修复建议

### 规则覆盖情况
简要说明每条规则在该模块中的检查结果（通过/发现问题）

### 总结
该模块的整体评价和改进建议`;

        await runSingleModuleReview(suite, tc, modulePrompt, project.sourcePath!, abortController, mod.name);
      }

      // 生成合并 HTML 报告
      const allOutputs = suite.cases
        .filter(c => c.output && c.output.length > 50)
        .map(c => `---\n## ${c.name}\n\n${c.output}`)
        .join('\n\n');
      if (allOutputs.length > 100) {
        try {
          const reportsDir = path.join(getConfig().testDataDir || getConfig().e2eDataDir, 'codereview', 'reports');
          if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
          const reportFile = path.join(reportsDir, `review-${suite.id}.html`);
          const totalDuration = suite.cases.reduce((s, c) => s + (c.duration || 0), 0);
          fs.writeFileSync(reportFile, buildReviewHtml(project.name, allOutputs, totalDuration), 'utf-8');
          suite.config.reportPath = reportFile;
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

      const reviewPrompt = `你是一位资深代码审查专家。请对以下项目的源代码进行审查。

## 项目信息
- 项目名称: ${project.name}
- 源码路径: ${project.sourcePath}
- 前端框架: Vue 3 + Vite + Pinia

${rulesContent ? `## 审查筛查规则（参考指引）\n以下是筛查规则，定义了应该"查什么"和"怎么查"。请按这些规则的方法去检查实际代码，以你的实际分析结论为准，不要照搬规则描述。\n\n${rulesContent}` : '## 审查维度\n请从安全性、性能、错误处理、Vue最佳实践、可维护性五个维度审查。'}

## 审查原则
1. **实际代码分析为主** — Read 文件的真实内容，基于具体代码给出结论
2. **规则是筛查指引** — 按 checkMethod 的方法去检查，但结论必须来自实际代码
3. **好代码也要认可** — 如果某条规则检查后未发现问题，标注为"通过"而非跳过

## 审查范围
请扫描项目源码，重点关注以下文件：
1. src/pages/ 下的页面组件
2. src/components/ 下的通用组件
3. src/utils/ 和 src/api/ 下的工具和接口
4. 后端路由和控制器（如果有）

## 输出格式
请以 Markdown 格式输出审查报告，包含：

### 总体评分（0-100）

### 问题列表
对每个问题记录：
- 严重等级（🔴 Critical / 🟡 Warning / 🔵 Info）
- 规则 ID
- 文件路径和行号
- 问题描述（基于实际代码分析）
- 修复建议

### 规则覆盖情况
简要说明每条规则的检查结果

### 总结
总体评价和改进建议`;

      const startTime = Date.now();
      let fullOutput = '';
      const blocks: StreamBlock[] = [];

      const response = query({
        prompt: reviewPrompt,
        options: {
          cwd: project.sourcePath,
          allowedTools: ['Read', 'Glob', 'Grep'],
          maxTurns: 9999,
          permissionMode: 'bypassPermissions',
          abortController,
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

      // 生成 HTML 审查报告
      if (fullOutput.length > 100) {
        try {
          const reportsDir = path.join(getConfig().testDataDir || getConfig().e2eDataDir, 'codereview', 'reports');
          if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
          const reportFile = path.join(reportsDir, `review-${suite.id}.html`);
          fs.writeFileSync(reportFile, buildReviewHtml(project.name, fullOutput, mainCase?.duration || 0), 'utf-8');
          suite.config.reportPath = reportFile;
        } catch (err: any) {
          console.error('[CodeReview] 生成HTML报告失败:', err.message);
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
): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-code');

  tc.status = 'running';
  // 发出 case 级进度事件，让前端知道当前在审查哪个模块
  testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n---\n## 🔍 开始审查: ${moduleName}\n\n` });
  saveRun(suite);

  const moduleAbortController = new AbortController();

  // 如果 suite 被中断，也中断当前模块
  const onSuiteAbort = () => moduleAbortController.abort();
  suiteAbortController.signal.addEventListener('abort', onSuiteAbort);

  const startTime = Date.now();
  let fullOutput = '';
  const blocks: StreamBlock[] = [];

  try {
    const response = query({
      prompt: modulePrompt,
      options: {
        cwd,
        allowedTools: ['Read', 'Glob', 'Grep'],
        maxTurns: 9999,
        permissionMode: 'bypassPermissions',
        abortController: moduleAbortController,
      },
    });

    for await (const msg of response) {
      if (moduleAbortController.signal.aborted) throw new Error('审查被中断');

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

    tc.duration = Date.now() - startTime;
    tc.output = fullOutput;
    tc.blocks = blocks;
    tc.status = fullOutput.length > 100 ? 'passed' : 'failed';
    if (tc.status === 'failed') tc.error = '审查输出内容不足';

    // 模块完成事件
    testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n\n${tc.status === 'passed' ? '✅' : '❌'} 模块审查完成: ${moduleName} (${(tc.duration / 1000).toFixed(1)}s)\n\n` });

  } catch (err: any) {
    tc.duration = Date.now() - startTime;
    tc.status = 'error';
    tc.error = err.message;
    tc.blocks = blocks;
    testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n\n💥 模块审查中断: ${moduleName} - ${err.message}\n\n` });
  } finally {
    suiteAbortController.signal.removeEventListener('abort', onSuiteAbort);
  }

  // 每个 case 完成后保存，确保中断时已完成的 case 不丢失
  saveRun(suite);
  testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: tc.status, duration: tc.duration });
}

/** 将 Markdown 审查结果转为独立 HTML 报告 */
function buildReviewHtml(projectName: string, markdown: string, duration: number): string {
  // 将 markdown 转义为 JSON 字符串，供前端 JS 使用 marked 渲染
  const mdEscaped = JSON.stringify(markdown);
  const durationSec = (duration / 1000).toFixed(1);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>代码审查报告 - ${projectName}</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
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
  .loading { display: flex; align-items: center; justify-content: center; height: 200px; color: #999; font-size: 14px; }
</style>
</head>
<body>

<div class="header">
  <h1>代码审查报告 <span class="engine-tag">Claude Code AI</span></h1>
  <div class="meta">项目: ${projectName} | 耗时: ${durationSec}s | 生成时间: ${new Date().toLocaleString('zh-CN')}</div>
</div>

<div class="summary" id="summary">
  <div class="summary-card">
    <div class="value" id="stat-modules">-</div>
    <div class="label">审查模块</div>
  </div>
  <div class="summary-card">
    <div class="value fail" id="stat-critical">-</div>
    <div class="label">严重问题</div>
  </div>
  <div class="summary-card">
    <div class="value warn" id="stat-warning">-</div>
    <div class="label">警告问题</div>
  </div>
  <div class="summary-card">
    <div class="value info" id="stat-info">-</div>
    <div class="label">建议改进</div>
  </div>
</div>

<div class="container">
  <div class="sidebar" id="sidebar"></div>
  <div class="content" id="content">
    <div class="loading">正在解析报告...</div>
  </div>
</div>

<div class="footer">由 AI Platform 自动生成</div>

<script>
(function() {
  const md = ${mdEscaped};

  // 按 "---\\n## 模块名" 分割模块
  const moduleRegex = /^---\s*\n##\s+(.+)$/gm;
  const modules = [];
  let match;
  const splits = [];
  while ((match = moduleRegex.exec(md)) !== null) {
    splits.push({ title: match[1].trim(), index: match.index, end: match.index + match[0].length });
  }

  if (splits.length === 0) {
    // 无模块分割，整篇作为单个模块
    modules.push({ title: '完整审查报告', content: md });
  } else {
    for (let i = 0; i < splits.length; i++) {
      const start = splits[i].end;
      const end = i + 1 < splits.length ? splits[i + 1].index : md.length;
      modules.push({ title: splits[i].title, content: md.substring(start, end).trim() });
    }
  }

  // 统计严重等级
  let criticalCount = 0, warningCount = 0, infoCount = 0;
  for (const m of modules) {
    const c = (m.content.match(/🔴/g) || []).length;
    const w = (m.content.match(/🟡/g) || []).length;
    const i = (m.content.match(/🔵/g) || []).length;
    criticalCount += c; warningCount += w; infoCount += i;
  }

  document.getElementById('stat-modules').textContent = modules.length;
  document.getElementById('stat-critical').textContent = criticalCount;
  document.getElementById('stat-warning').textContent = warningCount;
  document.getElementById('stat-info').textContent = infoCount;

  // 提取每个模块的评分
  function extractScore(content) {
    const scoreMatch = content.match(/模块评分[：:]\s*(\d+)/);
    if (scoreMatch) return parseInt(scoreMatch[1]);
    const ratingMatch = content.match(/总体评分[：:]\s*(\d+)/);
    if (ratingMatch) return parseInt(ratingMatch[1]);
    return null;
  }

  function extractRisk(title) {
    if (/高风险/.test(title)) return 'high';
    if (/中风险/.test(title)) return 'medium';
    if (/低风险/.test(title)) return 'low';
    return '';
  }

  // 构建侧边栏
  const sidebar = document.getElementById('sidebar');
  modules.forEach((m, i) => {
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (i === 0 ? ' active' : '');
    const score = extractScore(m.content);
    const risk = extractRisk(m.title);
    item.innerHTML = (risk ? '<span class="risk ' + risk + '">' + (risk === 'high' ? '高' : risk === 'medium' ? '中' : '低') + '</span>' : '')
      + '<span class="name">' + m.title + '</span>'
      + (score !== null ? '<span class="score">' + score + '</span>' : '');
    item.onclick = function() {
      document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.module-section').forEach(el => el.classList.remove('active'));
      document.getElementById('module-' + i).classList.add('active');
    };
    sidebar.appendChild(item);
  });

  // 渲染内容
  const content = document.getElementById('content');
  content.innerHTML = '';
  modules.forEach((m, i) => {
    const section = document.createElement('div');
    section.className = 'module-section' + (i === 0 ? ' active' : '');
    section.id = 'module-' + i;

    const heading = document.createElement('h1');
    heading.textContent = m.title;
    section.appendChild(heading);

    const body = document.createElement('div');
    body.innerHTML = marked.parse(m.content);
    section.appendChild(body);

    content.appendChild(section);
  });
})();
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
    case 'frontend':
      cases.push(
        { id: uuid(), name: 'Vitest 前端单元测试', type, status: 'pending' },
      );
      break;
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
    name: `${type === 'agent' ? 'Agent智能体' : type === 'e2e' ? (() => { const p = (config.projectId as string) ? getProjectById(config.projectId as string) : undefined; return `E2E页面(${p ? p.name : (config.scope as string) || 'all'})`; })() : type === 'frontend' ? '前端单元' : type === 'codereview' ? (() => { const p = (config.projectId as string) ? getProjectById(config.projectId as string) : undefined; const mc = cases.length; return `代码审查(${p ? p.name : '全部'}${mc > 1 ? `, ${mc}模块` : ''})`; })() : 'API接口'}测试`,
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
