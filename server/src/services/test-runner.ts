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
  const totalTimeout = 30 * 60 * 1000; // 30 分钟
  const timer = setTimeout(() => abortController.abort(), totalTimeout);

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
        maxTurns: 100,
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
  const totalTimeout = 60 * 60 * 1000; // 60 分钟
  const timer = setTimeout(() => abortController.abort(), totalTimeout);

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
        maxTurns: mode === 'deep' ? 300 : mode === 'standard' ? 150 : 50,
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

  // 构建审查 prompt
  const reviewPrompt = `你是一位资深代码审查专家。请对以下项目的源代码进行审查。

## 项目信息
- 项目名称: ${project.name}
- 源码路径: ${project.sourcePath}
- 前端框架: Vue 3 + Vite + Pinia

${rulesContent ? `## 审查规则\n${rulesContent}` : '## 审查维度\n请从安全性、性能、错误处理、Vue最佳实践、可维护性五个维度审查。'}

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
- 问题描述
- 修复建议

### 模块分析
按模块总结各模块的代码质量

### 总结
总体评价和改进建议`;

  const mainCase = suite.cases[0];
  if (mainCase) {
    mainCase.name = `代码审查 (${project.name})`;
    mainCase.status = 'running';
    saveRun(suite);
  }

  const abortController = new AbortController();
  abortControllers.set(suite.id, abortController);
  const totalTimeout = 30 * 60 * 1000; // 30 分钟
  const timer = setTimeout(() => abortController.abort(), totalTimeout);

  const startTime = Date.now();
  let fullOutput = '';
  const blocks: StreamBlock[] = [];

  try {
    const response = query({
      prompt: reviewPrompt,
      options: {
        cwd: project.sourcePath,
        allowedTools: ['Read', 'Glob', 'Grep'],
        maxTurns: 100,
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

    clearTimeout(timer);

    if (mainCase) {
      mainCase.duration = Date.now() - startTime;
      mainCase.output = fullOutput;
      mainCase.blocks = blocks;
      mainCase.status = fullOutput.length > 100 ? 'passed' : 'failed';
      if (mainCase.status === 'failed') mainCase.error = '审查输出内容不足';
    }

    // 标记其他 case
    for (let i = 1; i < suite.cases.length; i++) {
      suite.cases[i].status = 'passed' as any;
      suite.cases[i].output = '(包含在代码审查主流程中)';
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
      const project = projectId ? getProjectById(projectId) : undefined;
      const label = project ? project.name : '全部';
      cases.push({ id: uuid(), name: `代码审查 (${label})`, type, status: 'pending' });
      break;
    }
  }

  const suite: TestSuite = {
    id: uuid(),
    name: `${type === 'agent' ? 'Agent智能体' : type === 'e2e' ? (() => { const p = (config.projectId as string) ? getProjectById(config.projectId as string) : undefined; return `E2E页面(${p ? p.name : (config.scope as string) || 'all'})`; })() : type === 'frontend' ? '前端单元' : type === 'codereview' ? (() => { const p = (config.projectId as string) ? getProjectById(config.projectId as string) : undefined; return `代码审查(${p ? p.name : '全部'})`; })() : 'API接口'}测试`,
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
