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

  const projectId = config.projectId as string | undefined;
  const project = projectId ? getProjectById(projectId) : undefined;

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

  const mode = 'deep';
  const scope = (config.scope as string) || 'all';
  const projectSlug = project?.name ? project.name.replace(/[<>:"/\\|?*\s]+/g, '_') : '_default';
  const e2eDataDir = getConfig().e2eDataDir || getConfig().testDataDir;
  const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
  const knowledgeGraphPath = projectId
    ? path.join(DATA_DIR, 'projects', projectId, 'page-context.json').replace(/\\/g, '/')
    : '';

  // 初始化 resumeInfo
  if (!getResumeInfo(suite).cases || Object.keys(getResumeInfo(suite).cases).length === 0) {
    setResumeInfo(suite, { cases: {} });
  }
  const resumeInfo = getResumeInfo(suite);

  const pageSets = project?.pageSets || [];
  const targetSets = scope === 'all'
    ? pageSets
    : pageSets.filter(ps => ps.id === scope);

  // 如果只有一个 case 且没有对应的 pageSet（旧模式或无项目），走单会话模式
  if (suite.cases.length === 1 && targetSets.length === 0) {
    await runE2ESingleSession(suite, suite.cases[0], config, query, skillContent, project, mode, scope, projectSlug, e2eDataDir);
    return;
  }

  // 按 PageSet 逐个执行
  const suiteAbortController = new AbortController();
  abortControllers.set(suite.id, suiteAbortController);

  const totalCases = suite.cases.length;
  let completedCount = 0;

  testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `# E2E 深度测试\n共 ${totalCases} 个页面集，开始逐集执行...\n\n` });

  for (let i = 0; i < suite.cases.length; i++) {
    if (suiteAbortController.signal.aborted) {
      for (let j = i; j < suite.cases.length; j++) {
        suite.cases[j].status = 'error';
        suite.cases[j].error = '用户手动停止';
      }
      break;
    }

    const tc = suite.cases[i];
    const pageSet = targetSets[i];

    // 检查 resumeInfo，跳过已完成的 PageSet
    const resumeCase = resumeInfo.cases[tc.id];
    if (resumeCase?.status === 'completed') {
      tc.status = 'passed' as any;
      completedCount++;
      testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `⏭️ 跳过已完成: ${tc.name}\n\n` });
      continue;
    }

    const resumeSessionId = resumeCase?.status === 'interrupted'
      ? resumeCase.sessionId
      : undefined;

    // 解析该 PageSet 的页面
    const pages = pageSet ? resolvePageSetPages(project!, pageSet) : [];
    const baseUrl = project?.baseUrl || '';
    const gp = project?.globalParams || {};
    const paramsInfo = Object.keys(gp).length > 0
      ? `\n## 动态参数映射\n${Object.entries(gp).map(([k, v]) => `- ${k} → ${v.join(', ')}`).join('\n')}\n`
      : '';

    const pageListPrompt = pageSet ? `
## 当前页面集信息
- 页面集: ${pageSet.name}
- 待测试页面 (${pages.length}页)

| 序号 | 页面名称 | URL | 备注 |
|------|----------|-----|------|
${pages.map((p, i) => `| ${i + 1} | ${p.name} | ${p.url.includes(':') ? '需从上级页面进入' : baseUrl + p.url} | ${p.url.includes(':') ? '不能直接URL访问' : ''} |`).join('\n')}
` : '';

    const prompt = resumeSessionId
      ? '请继续之前的 E2E 页面测试，从上次中断处继续。保持之前的测试进度。'
      : `我需要你执行 E2E 页面深度测试。请严格按照 Skill 文件的规范执行。

## 当前项目信息
- 项目名称: ${project?.name}
- 前端地址: ${baseUrl}
- 后端 API: ${project?.apiBaseUrl}
- 登录页: ${baseUrl}${project?.loginUrl}
- 登录账号: ${project?.username} / ${project?.password}
${paramsInfo}
${pageListPrompt}
## 特别注意

1. **每个页面必须满足硬性最低标准**：CRUD页至少6个checks和6张截图，只读页至少4个checks和3张截图
2. **URL含动态参数的页面**：必须从上级列表页点击进入
3. **CRUD管理页**：必须走完 新增→验证→编辑→验证→删除→验证
4. **遇到异常不要放弃**：页面重定向时尝试从正确入口进入
5. **每步必截**：截图命名格式 \`{pageId}-{操作描述}.png\`

${knowledgeGraphPath ? `知识图谱文件路径：\`${knowledgeGraphPath}\`（请使用 Read 工具读取）\n` : ''}
请严格按照 SKILL.md 中的流程执行：登录 → 加载知识图谱 → 逐页测试（observe → think → act → validate）→ 保存结果。`;

    // 执行单个 PageSet 的测试
    await runE2ESinglePageSet(
      suite, tc, prompt, query, skillContent, project,
      suiteAbortController, resumeSessionId,
      projectSlug, e2eDataDir, mode,
    );

    completedCount++;
    testBus.emit('agent:stream', {
      suiteId: suite.id,
      type: 'text',
      content: `\n---\n📊 进度: ${completedCount}/${totalCases} 页面集完成\n\n`,
    });
  }

  // 尝试读取报告路径
  tryReadE2EReportPath(suite, projectSlug);

  abortControllers.delete(suite.id);
  saveRun(suite);
}

/** 解析 PageSet 中的页面（展开动态参数） */
function resolvePageSetPages(project: TestProject, pageSet: { pages?: PageConfig[] }): PageConfig[] {
  return resolvePagesFromList(project, pageSet.pages || []);
}

/** 从页面列表解析（展开动态参数） */
function resolvePagesFromList(project: TestProject, rawPages: PageConfig[]): PageConfig[] {
  const globalParams = project.globalParams || {};
  const expanded: PageConfig[] = [];

  for (const page of rawPages) {
    const pathParams = page.path?.match(/:\w+/g) || [];
    const pageParams = page.params || {};

    if (pathParams.length > 0 && Object.keys(pageParams).length === 0) {
      for (const p of pathParams) {
        if (!(p in pageParams)) pageParams[p] = [];
      }
    }

    if (Object.keys(pageParams).length === 0) {
      expanded.push(page);
      continue;
    }

    const mergedParams: Record<string, string[]> = {};
    for (const [param, pageValues] of Object.entries(pageParams)) {
      mergedParams[param] = pageValues.length > 0 ? pageValues : (globalParams[param] || []);
    }

    const allConfigured = Object.values(mergedParams).every(values => values.length > 0);
    if (!allConfigured) {
      expanded.push({ ...page, name: `${page.name} (参数未配置，已跳过)` });
      continue;
    }

    const combinations = generateParamCombinations(mergedParams);
    for (const combo of combinations) {
      let resolvedUrl = page.url;
      let resolvedPath = page.path;
      for (const [param, value] of Object.entries(combo)) {
        resolvedUrl = resolvedUrl!.replace(param, value);
        resolvedPath = resolvedPath!.replace(param, value);
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

/** 执行单个 PageSet 的 E2E 测试 */
async function runE2ESinglePageSet(
  suite: TestSuite,
  tc: TestCase,
  prompt: string,
  query: any,
  skillContent: string,
  project: TestProject | undefined,
  suiteAbortController: AbortController,
  resumeSessionId?: string,
  projectSlug?: string,
  e2eDataDir?: string,
  mode?: string,
): Promise<void> {
  const moduleAbortController = new AbortController();
  const onSuiteAbort = () => moduleAbortController.abort();
  suiteAbortController.signal.addEventListener('abort', onSuiteAbort);

  tc.status = 'running';
  const prefix = resumeSessionId ? '🔄 恢复测试: ' : '🧪 开始测试: ';
  testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n---\n## ${prefix}${tc.name}\n\n` });
  saveRun(suite);

  const startTime = Date.now();
  let fullOutput = '';
  const blocks: StreamBlock[] = [];

  try {
    const e2eCwd = project?.sourcePath || getConfig().aiPlatformRoot;
    const queryOptions: Record<string, any> = {
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
      abortController: moduleAbortController,
      appendSystemPrompt: skillContent,
      mcpServers: {
        playwright: {
          type: 'stdio' as const,
          command: 'npx',
          args: ['-y', '@executeautomation/playwright-mcp-server'],
        },
      },
    };

    if (resumeSessionId) {
      queryOptions.resume = resumeSessionId;
      queryOptions.forkSession = true;
    }

    console.log(`[E2E] 调用 query() for case: ${tc.name}...`);
    const response = query({ prompt, options: queryOptions });

    let capturedSessionId = '';
    let msgCount = 0;

    for await (const msg of response) {
      if (moduleAbortController.signal.aborted) throw new Error('E2E 测试被中断');
      msgCount++;
      if (msgCount <= 3 || msgCount % 20 === 0) {
        console.log(`[E2E] case=${tc.name} 消息 #${msgCount}: type=${msg.type}`);
      }

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
    if (tc.status === 'failed') tc.error = '输出内容不足';

    // 保存 resumeInfo：完成
    if (capturedSessionId) {
      const info = getResumeInfo(suite);
      info.cases[tc.id] = { sessionId: capturedSessionId, status: 'completed', partialOutput: fullOutput };
      setResumeInfo(suite, info);
    }

    testBus.emit('agent:stream', {
      suiteId: suite.id, type: 'text',
      content: `\n\n${tc.status === 'passed' ? '✅' : '❌'} 页面集测试完成: ${tc.name} (${(tc.duration / 1000).toFixed(1)}s)\n\n`,
    });

  } catch (err: any) {
    tc.duration = Date.now() - startTime;
    tc.status = 'error';
    tc.error = err.message;
    tc.blocks = blocks;

    // 保存 resumeInfo：中断
    const info = getResumeInfo(suite);
    const existingResume = info.cases[tc.id];
    const sessionIdToSave = existingResume?.sessionId || '';
    if (sessionIdToSave) {
      info.cases[tc.id] = { sessionId: sessionIdToSave, status: 'interrupted', partialOutput: fullOutput };
      setResumeInfo(suite, info);
    }

    testBus.emit('agent:stream', {
      suiteId: suite.id, type: 'text',
      content: `\n\n💥 页面集测试中断: ${tc.name} - ${err.message}\n\n`,
    });
  } finally {
    suiteAbortController.signal.removeEventListener('abort', onSuiteAbort);
    saveRun(suite);
  }
}

/** E2E 单会话模式（兼容无项目或单 case 场景） */
async function runE2ESingleSession(
  suite: TestSuite,
  mainCase: TestCase,
  config: Record<string, unknown>,
  query: any,
  skillContent: string,
  project: TestProject | undefined,
  mode: string,
  scope: string,
  projectSlug: string,
  e2eDataDir: string,
): Promise<void> {
  const projectId = config.projectId as string | undefined;

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
- 登录账号: ${project.username} / ${project.password}
${paramsInfo}
## 待测试页面 (${pages.length}页)

| 序号 | 页面名称 | URL | 备注 |
|------|----------|-----|------|
${pages.map((p, i) => `| ${i + 1} | ${p.name} | ${p.url.includes(':') ? '需从上级页面进入' : baseUrl + p.url} | ${p.url.includes(':') ? '不能直接URL访问' : ''} |`).join('\n')}
`;
  }

  const kgPath = projectId
    ? path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data'), 'projects', projectId, 'page-context.json').replace(/\\/g, '/')
    : '';

  const prompt = `我需要你执行 E2E 页面深度测试。请严格按照 Skill 文件的规范执行。

${pageListPrompt}
## 特别注意

1. **每个页面必须满足硬性最低标准**：CRUD页至少6个checks和6张截图，只读页至少4个checks和3张截图
2. **URL含动态参数的页面**（标注"不能直接URL访问"）：必须从上级列表页点击进入
3. **CRUD管理页**：必须走完 新增→验证→编辑→验证→删除→验证
4. **遇到异常不要放弃**：页面重定向时尝试从正确入口进入
5. **每步必截**：截图命名格式 \`{pageId}-{操作描述}.png\`

${kgPath ? `知识图谱文件路径：\`${kgPath}\`（请使用 Read 工具读取）\n` : ''}
请严格按照 SKILL.md 中的流程执行：登录 → 加载知识图谱 → 逐页测试（observe → think → act → validate）→ 保存结果。`;

  mainCase.name = `E2E 深度测试 (${scope})`;
  mainCase.status = 'running';
  saveRun(suite);

  const abortController = new AbortController();
  abortControllers.set(suite.id, abortController);

  const startTime = Date.now();
  let fullOutput = '';
  const blocks: StreamBlock[] = [];

  try {
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

    for await (const msg of response) {
      if (abortController.signal.aborted) throw new Error('E2E test timeout');
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

    mainCase.duration = Date.now() - startTime;
    mainCase.output = fullOutput;
    mainCase.blocks = blocks;
    mainCase.status = fullOutput.length > 100 ? 'passed' : 'failed';
    if (mainCase.status === 'failed') mainCase.error = '输出内容不足';

    tryReadE2EReportPath(suite, projectSlug);

  } catch (err: any) {
    abortControllers.delete(suite.id);
    mainCase.duration = Date.now() - startTime;
    mainCase.status = 'error';
    mainCase.error = err.message;
  }

  abortControllers.delete(suite.id);
  saveRun(suite);
  testBus.emit('test:update', { suiteId: suite.id, caseId: mainCase.id, status: mainCase.status, duration: mainCase.duration });
}

/** 尝试读取 E2E 测试生成的报告路径 */
function tryReadE2EReportPath(suite: TestSuite, projectSlug: string): void {
  try {
    const searchDirs = [
      path.join(getConfig().e2eDataDir, 'runs', projectSlug),
      path.join(getConfig().e2eDataDir, 'runs'),
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
            break;
          }
        }
      }
    }
  } catch { /* ignore */ }
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

/** 从发现数据中自动检测前端源码目录（相对于项目根目录） */
function detectFrontendSrcDir(discovery: any): string {
  if (!discovery?.modules) return 'src';
  for (const mod of discovery.modules) {
    for (const file of mod.files || []) {
      const p: string = file.path || '';
      // 匹配 frontend/src、src、web/src 等常见前端源码目录
      const match = p.match(/^(.+?)\/(utils|components|stores?|pages|hooks|composables|views|api|flow)\//);
      if (match) return match[1];
    }
  }
  return 'src';
}

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
function buildFrontendModuleInfo(mod: any, fileAnalysisMap?: Map<string, any>): string {
  const files = (mod.files || []).map((f: any) => {
    let info = `- ${f.path}`;
    if (f.exports?.length) info += ` (导出: ${f.exports.join(', ')})`;

    // 优先使用 frontend-discovery 自身的 exportType/mockDeps 字段
    const exportType = f.exportType;
    const exportName = f.exportName;
    const mockDeps = f.mockDeps;
    if (exportType) info += `\n  导出类型: ${exportType}`;
    if (exportName) info += ` | 导出名: ${exportName}`;
    if (mockDeps?.length) {
      info += '\n  需要 mock: ' + mockDeps.join(', ');
    }

    // 兜底：附加 review-discovery 的文件分析信息（如有）
    const analysis = fileAnalysisMap?.get(f.path);
    if (analysis && !exportType) {
      info += `\n  导出类型: ${analysis.exportType || 'unknown'}`;
      if (analysis.exportName) info += ` | 导出名: ${analysis.exportName}`;
      if (analysis.testCategory) info += ` | 测试分类: ${analysis.testCategory}`;
      if (analysis.dependencies?.length) {
        info += '\n  需要 mock:\n' + analysis.dependencies.map((d: any) =>
          `    - ${d.name} from ${d.module}${d.mockStrategy ? ` — ${d.mockStrategy}` : ''}`
        ).join('\n');
      }
      if (analysis.testHints) info += `\n  测试提示: ${analysis.testHints}`;
    } else if (analysis && analysis.testHints) {
      info += `\n  测试提示: ${analysis.testHints}`;
    }

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

/** 根据模块匹配知识图谱中的页面，构建辅助上下文 */
function buildPageContextSection(mod: any, pageContext: any[] | null): string {
  if (!pageContext || pageContext.length === 0) {
    return '暂无知识图谱数据。请仅基于源码分析生成测试。';
  }

  const matchedPages: any[] = [];

  for (const page of pageContext) {
    const apis = page.apiEndpoints || [];
    const interactions = page.interactions || [];
    const issues = page.commonIssues || [];
    const pageName = page.pageName || '';
    const modId = mod.id || '';
    const modName = mod.name || '';

    const isRelevant =
      (modId === 'pages' && (pageName.includes(modName) || modName.includes(pageName))) ||
      (modId === 'stores' && apis.length > 0) ||
      (modId === 'components' && interactions.length > 0);

    if (isRelevant || apis.length > 0) {
      matchedPages.push({
        pageName,
        pageId: page.pageId || '',
        description: page.description || '',
        apiEndpoints: apis.slice(0, 5),
        interactions: interactions.slice(0, 5),
        commonIssues: issues.slice(0, 3),
      });
    }

    if (matchedPages.length >= 5) break;
  }

  if (matchedPages.length === 0) {
    return '暂无与当前模块直接相关的知识图谱数据。请仅基于源码分析生成测试。';
  }

  return matchedPages.map((p, i) => {
    let text = `### 页面 ${i + 1}: ${p.pageName} (${p.pageId})\n`;
    if (p.description) text += `- 功能: ${p.description}\n`;
    if (p.apiEndpoints.length > 0) {
      text += `- API 接口:\n`;
      for (const api of p.apiEndpoints) {
        text += `  - ${api.method} ${api.path} — ${api.description || ''}\n`;
      }
    }
    if (p.interactions.length > 0) {
      text += `- 交互操作:\n`;
      for (const inter of p.interactions) {
        text += `  - ${inter.action || ''} → ${inter.expected || ''}\n`;
      }
    }
    if (p.commonIssues.length > 0) {
      text += `- 常见问题:\n`;
      for (const issue of p.commonIssues) {
        text += `  - ${issue}\n`;
      }
    }
    return text;
  }).join('\n');
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

  // 读取 review-discovery 的文件分析数据（如有）
  const reviewDiscoveryPath = path.join(DATA_DIR, 'projects', projectId!, 'review-discovery.json');
  let fileAnalysisMap = new Map<string, any>();
  try {
    const reviewData = JSON.parse(fs.readFileSync(reviewDiscoveryPath, 'utf-8'));
    const fa = reviewData?.fileAnalysis?.files;
    if (Array.isArray(fa)) {
      for (const item of fa) {
        if (item.path) fileAnalysisMap.set(item.path, item);
      }
    }
  } catch { /* review-discovery 可选，不存在不影响 */ }

  const selectedModuleIds = (config.modules as string[]) || [];
  const projectSlug = project.name.replace(/[<>:"/\\|?*\s]+/g, '_');
  const testsOutputDir = path.join(getConfig().testDataDir || getConfig().e2eDataDir, 'frontend', projectSlug);
  if (!fs.existsSync(testsOutputDir)) fs.mkdirSync(testsOutputDir, { recursive: true });

  // 读取 page-context 数据（修复 Path A 缺少 pageContextSection 的 bug）
  let pageContextSection = '暂无知识图谱数据。请仅基于源码分析生成测试。';
  try {
    const pageContextPath = path.join(DATA_DIR, 'projects', projectId!, 'page-context.json');
    const pageContext = JSON.parse(fs.readFileSync(pageContextPath, 'utf-8'));
    pageContextSection = buildPageContextSection(null, pageContext);
  } catch { /* ignore */ }

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
      const frontendSrcDir = detectFrontendSrcDir(discovery);
      const frontendSrcPath = path.join(project.sourcePath!, frontendSrcDir).replace(/\\/g, '/');
      const skillContent = loadFrontendTestSkill({
        projectName: project.name,
        sourcePath: project.sourcePath!,
        moduleInfoSection: buildFrontendModuleInfo(mod, fileAnalysisMap),
        testsOutputDir: testsOutputDir.replace(/\\/g, '/'),
        frontendSrcDir,
        frontendSrcPath,
        pageContextSection,
      });

      await runSingleModuleFrontendTest(suite, tc, mod, project.sourcePath!, abortController, skillContent, resumeSessionId);
    }

    // ===== 阶段二：执行 vitest =====
    if (!abortController.signal.aborted) {
      const frontendSrcDir = detectFrontendSrcDir(discovery);
      const frontendSrcPath = path.join(project.sourcePath!, frontendSrcDir).replace(/\\/g, '/');
      await executeVitestTests(suite, testsOutputDir, project.sourcePath!, frontendSrcPath);
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
async function executeVitestTests(suite: TestSuite, testsDir: string, sourcePath: string, frontendSrcPath?: string): Promise<void> {
  const testFiles = findTestFiles(testsDir);
  if (testFiles.length === 0) {
    testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n---\n## ⚠️ 未找到生成的测试文件\n\n` });
    return;
  }

  testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: `\n---\n## 执行 vitest (${testFiles.length} 个测试文件)...\n\n` });

  // 生成临时 vitest 配置
  const aliasTarget = frontendSrcPath || `${sourcePath.replace(/\\/g, '/')}/src`;
  const vitestConfig = `
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'
export default defineConfig({
  plugins: [vue()],
  test: { globals: true, environment: 'happy-dom', testTimeout: 30000, hookTimeout: 30000 },
  resolve: { alias: {
    '@': '${aliasTarget}',
    '${aliasTarget}': '${aliasTarget}',
  } },
  server: { fs: { allow: ['${testsDir.replace(/\\/g, '/')}', '${sourcePath.replace(/\\/g, '/')}'] } },
})
`;
  const configPath = path.join(testsDir, '_vitest.config.ts');
  fs.writeFileSync(configPath, vitestConfig, 'utf-8');

  let rawJson = '';
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
      rawJson = jsonMatch[0];
      try {
        const report = JSON.parse(rawJson);
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
      rawJson = jsonMatch[0];
      try {
        const report = JSON.parse(rawJson);
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

  // 阶段三：生成 HTML 报告
  if (rawJson) {
    try {
      const report = JSON.parse(rawJson);
      const projectSlug = (suite.config.projectName as string || 'project').replace(/[<>:"/\\|?*\s]+/g, '_');
      const html = buildFrontendTestHtml(report, projectSlug);
      const reportsDir = path.resolve(getConfig().testDataDir || getConfig().e2eDataDir, 'frontend', 'reports', projectSlug);
      if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const htmlPath = path.join(reportsDir, `frontend-test-${ts}.html`);
      fs.writeFileSync(htmlPath, html, 'utf-8');
      suite.config.reportPath = htmlPath;
      // 同时保存 JSON 原始数据
      const jsonPath = path.join(reportsDir, `frontend-test-${ts}.json`);
      fs.writeFileSync(jsonPath, rawJson, 'utf-8');
      testBus.emit('agent:stream', {
        suiteId: suite.id,
        type: 'text',
        content: `\n\n📊 HTML 报告已生成: ${htmlPath}\n`,
      });
    } catch (e: any) {
      console.error('[FrontendTest] HTML报告生成失败:', e.message);
    }
  }
}

/** 将 vitest JSON 报告转为独立 HTML 报告（固定模板，与代码审查报告风格统一） */
export function buildFrontendTestHtml(vitestReport: any, projectSlug: string): string {
  const totalTests = vitestReport.numTotalTests || 0;
  const totalPassed = vitestReport.numPassedTests || 0;
  const totalFailed = vitestReport.numFailedTests || 0;
  const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0';
  const rateClass = Number(passRate) >= 90 ? 'score-good' : Number(passRate) >= 70 ? 'score-warn' : 'score-bad';
  const now = new Date().toISOString().slice(0, 10);

  // 按模块分类
  const modMap: Record<string, { name: string; files: any[]; passed: number; failed: number }> = {
    utils: { name: 'utils — API 接口层', files: [], passed: 0, failed: 0 },
    components: { name: 'components — Vue 组件', files: [], passed: 0, failed: 0 },
    pages: { name: 'pages — 页面 & Composable', files: [], passed: 0, failed: 0 },
  };

  const sourceMap: Record<string, string> = {
    'client.test.ts': 'api/client.ts', 'projects.test.ts': 'api/projects.ts',
    'schools.test.ts': 'api/schools.ts', 'sessions.test.ts': 'api/sessions.ts',
    'settings.test.ts': 'api/settings.ts', 'skills.test.ts': 'api/skills.ts',
    'tests.test.ts': 'api/tests.ts', 'workflows.test.ts': 'api/workflows.ts',
    'ChatInput.test.ts': 'components/chat/ChatInput.vue', 'MessageBubble.test.ts': 'components/chat/MessageBubble.vue',
    'SessionList.test.ts': 'components/chat/SessionList.vue', 'ToolCallBlock.test.ts': 'components/chat/ToolCallBlock.vue',
    'EmptyState.test.ts': 'components/common/EmptyState.vue', 'StatusBadge.test.ts': 'components/common/StatusBadge.vue',
    'AppSidebar.test.ts': 'components/layout/AppSidebar.vue', 'SchoolForm.test.ts': 'components/school/SchoolForm.vue',
    'StepPipeline.test.ts': 'components/workflow/StepPipeline.vue', 'WorkflowParamsForm.test.ts': 'components/workflow/WorkflowParamsForm.vue',
    'useSSE.test.ts': 'composables/useSSE.ts', 'ChatView.test.ts': 'views/ChatView.vue',
    'DashboardView.test.ts': 'views/DashboardView.vue', 'SchoolView.test.ts': 'views/SchoolView.vue',
    'SchoolDetailView.test.ts': 'views/SchoolDetailView.vue', 'SchoolDeployView.test.ts': 'views/SchoolDeployView.vue',
    'SettingsView.test.ts': 'views/SettingsView.vue', 'SkillView.test.ts': 'views/SkillView.vue',
    'TestView.test.ts': 'views/TestView.vue', 'WorkflowView.test.ts': 'views/WorkflowView.vue',
  };

  const allFailed: { fname: string; title: string; error: string }[] = [];

  for (const tr of vitestReport.testResults || []) {
    const raw = tr.name || '';
    const parts = raw.split(/[/\\]/);
    const fname = parts.slice(-2).join('/');
    const mod = fname.startsWith('utils') ? 'utils' : fname.startsWith('components') ? 'components' : 'pages';
    const cases = (tr.assertionResults || []).map((a: any) => {
      if (a.status === 'failed') {
        allFailed.push({ fname, title: a.title || '', error: (a.failureMessages?.[0] || '').split('\n')[0].substring(0, 200) });
      }
      return a;
    });
    const passed = cases.filter((a: any) => a.status === 'passed').length;
    const failed = cases.filter((a: any) => a.status === 'failed').length;
    modMap[mod].passed += passed;
    modMap[mod].failed += failed;
    modMap[mod].files.push({ fname, source: sourceMap[fname.split('/').pop() || ''] || fname, passed, failed, cases });
  }

  // 构建 HTML 片段
  function esc(s: string) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  const modColors: Record<string, [string, string]> = {
    utils: ['stat-blue', 'risk-utils'], components: ['stat-green', 'risk-components'], pages: ['stat-purple', 'risk-pages'],
  };
  const modIcons: Record<string, string> = { utils: '🔌', components: '🧩', pages: '📄' };

  let scoreCards = '';
  let sections = '';
  let summaryRows = '';
  let idx = 0;

  for (const [key, mod] of Object.entries(modMap)) {
    if (mod.files.length === 0) continue;
    const rate = mod.passed + mod.failed > 0 ? ((mod.passed / (mod.passed + mod.failed)) * 100).toFixed(0) : '100';
    const rc = Number(rate) >= 90 ? 'score-good' : Number(rate) >= 70 ? 'score-warn' : 'score-bad';
    scoreCards += `<div class="score-card"><div class="module-name">${esc(mod.name)}</div><div class="score ${rc}">${rate}%</div><div class="score-label">通过率 · ${mod.passed}/${mod.passed + mod.failed}</div><span class="risk-badge ${modColors[key][1]}">${mod.files.length} 个文件 · ${mod.failed} 个失败</span></div>`;

    sections += `<div class="section"><h2>${modIcons[key]} ${esc(mod.name)}（${mod.files.length} 个文件 · ${mod.passed + mod.failed} 个用例 · ${mod.failed} 个失败）</h2>`;
    for (const f of mod.files) {
      const icon = f.failed === 0 ? '✅' : '⚠️';
      const tagCls = f.failed === 0 ? 'tag-render' : 'tag-edge';
      sections += `<div class="module-header" onclick="toggleModule(this)"><h3>${icon} ${esc(f.fname.replace('.test.ts', ''))} <span class="test-tag ${tagCls}">${f.cases.length} 个用例 · ${f.passed} 通过 · ${f.failed} 失败</span></h3><span class="toggle">▸</span></div><div class="module-content"><div class="file-info"><span class="file-path">源码: web/src/${esc(f.source)}</span></div>`;
      for (const c of f.cases) {
        const ci = c.status === 'passed' ? '✅' : '❌';
        const cc = c.status === 'passed' ? '' : ' test-failed';
        const dur = c.duration != null ? (c.duration < 1000 ? c.duration.toFixed(0) + 'ms' : (c.duration / 1000).toFixed(1) + 's') : '';
        sections += `<div class="test-case${cc}"><span class="test-icon">${ci}</span><span class="test-name">${esc(c.title)}</span><span class="test-duration">${dur}</span></div>`;
        if (c.status === 'failed') {
          const err = (c.failureMessages?.[0] || '').split('\n')[0].substring(0, 200);
          sections += `<div class="error-detail"><span class="error-icon">⚠</span><code>${esc(err)}</code></div>`;
        }
      }
      sections += `</div>`;
    }
    sections += `</div>`;

    for (const f of mod.files) {
      idx++;
      const pr = f.cases.length > 0 ? ((f.passed / f.cases.length) * 100).toFixed(0) : '100';
      summaryRows += `<tr><td class="count">${idx}</td><td class="file-name">${esc(f.fname)}</td><td>web/src/${esc(f.source)}</td><td><span class="module-tag ${modColors[key][1]}">${key === 'utils' ? 'utils' : key === 'components' ? '组件' : '页面'}</span></td><td class="count">${f.cases.length}</td><td class="count pass-count">${f.passed}</td><td class="count ${f.failed > 0 ? 'fail-count' : ''}">${f.failed}</td><td class="count">${pr}%</td></tr>`;
    }
  }

  let failedSection = '';
  if (allFailed.length > 0) {
    failedSection = `<div class="section" style="border-left: 4px solid #ff4d4f;"><h2>❌ 失败用例汇总（${allFailed.length} 个）</h2>`;
    for (const ft of allFailed) {
      failedSection += `<div class="test-case test-failed"><span class="test-icon">❌</span><span class="test-name">${esc(ft.fname)} → ${esc(ft.title)}</span><span class="file-path" style="margin-left:auto">${esc(ft.fname)}</span></div><div class="error-detail"><span class="error-icon">⚠</span><code>${esc(ft.error)}</code></div>`;
    }
    failedSection += `</div>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>前端单元测试报告 — ${esc(projectSlug)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f7fa;color:#2c3e50;line-height:1.6}.container{max-width:1200px;margin:0 auto;padding:20px}h1{text-align:center;font-size:28px;margin-bottom:8px;color:#1a1a2e}.subtitle{text-align:center;color:#7f8c8d;margin-bottom:30px;font-size:14px}
.score-overview{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:30px}.score-card{background:#fff;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.08);transition:transform .2s}.score-card:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(0,0,0,.12)}.score-card .module-name{font-size:14px;color:#7f8c8d;margin-bottom:8px}.score-card .score{font-size:48px;font-weight:700}.score-card .score-label{font-size:12px;color:#95a5a6;margin-top:4px}.score-card .risk-badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;margin-top:8px;font-weight:600}.risk-utils{background:#e6f7ff;color:#1890ff}.risk-components{background:#f0fff4;color:#52c41a}.risk-pages{background:#f9f0ff;color:#722ed1}.score-good{color:#27ae60}.score-warn{color:#fa8c16}.score-bad{color:#ff4d4f}
.stats-bar{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:30px}.stat-item{background:#fff;border-radius:8px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)}.stat-item .stat-num{font-size:28px;font-weight:700}.stat-item .stat-label{font-size:12px;color:#95a5a6;margin-top:4px}.stat-blue .stat-num{color:#1890ff}.stat-green .stat-num{color:#52c41a}.stat-red .stat-num{color:#ff4d4f}.stat-purple .stat-num{color:#722ed1}.stat-orange .stat-num{color:#fa8c16}
.pass-rate-bar{height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden;margin-top:20px}.pass-rate-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#52c41a ${passRate}%,#ff4d4f ${passRate}%)}
.section{background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,.06)}.section h2{font-size:18px;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #f0f0f0;display:flex;align-items:center;gap:8px}
.module-header{display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:12px 16px;background:#f8f9fa;border-radius:8px;margin-bottom:4px;transition:background .15s}.module-header:hover{background:#eef1f5}.module-header h3{margin:0;font-size:15px;display:flex;align-items:center;gap:8px}.module-header .toggle{font-size:14px;color:#95a5a6;transition:transform .2s}.module-content{display:none;padding:8px 16px 16px}.module-content.open{display:block}
.test-case{padding:8px 14px;margin-bottom:2px;border-radius:6px;font-size:13px;display:flex;align-items:center;gap:8px;transition:background .1s}.test-case:hover{background:#f5f5f7}.test-case.test-failed{background:#fff2f0}.test-icon{font-size:14px;flex-shrink:0}.test-name{flex:1;color:#444}.test-tag{font-size:11px;padding:1px 8px;border-radius:10px;font-weight:500;white-space:nowrap}.tag-api{background:#e6f7ff;color:#1890ff}.tag-render{background:#f6ffed;color:#52c41a}.tag-event{background:#fff7e6;color:#fa8c16}.tag-state{background:#f9f0ff;color:#722ed1}.tag-edge{background:#fff2f0;color:#ff4d4f}.test-duration{font-size:11px;color:#bbb;white-space:nowrap}
.error-detail{margin:0 0 6px 38px;padding:6px 12px;background:#fff7e6;border-left:3px solid #fa8c16;border-radius:0 4px 4px 0;font-size:12px;display:flex;align-items:flex-start;gap:6px}.error-detail code{color:#d4380d;word-break:break-all;font-size:11px;line-height:1.5}.error-icon{color:#fa8c16;flex-shrink:0;font-size:14px}
.file-info{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12px;color:#999;border-bottom:1px solid #f5f5f5;margin-bottom:8px}.file-path{font-family:monospace;color:#888;font-size:12px}
.summary-table{width:100%;border-collapse:collapse;font-size:13px}.summary-table th{background:#f8f9fa;padding:10px 12px;text-align:left;border-bottom:2px solid #dee2e6;font-weight:600}.summary-table td{padding:8px 12px;border-bottom:1px solid #f0f0f0}.summary-table tr:hover{background:#f8f9fa}.summary-table .file-name{font-family:monospace;color:#333;font-weight:500}.summary-table .count{text-align:center;font-weight:600}.pass-count{color:#52c41a}.fail-count{color:#ff4d4f}.module-tag{display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:500}
.note{background:#fffbe6;border:1px solid #ffe58f;border-radius:8px;padding:12px 16px;margin-top:20px;font-size:13px;color:#ad6800;display:flex;align-items:flex-start;gap:8px}.note-icon{font-size:16px;flex-shrink:0}
@media(max-width:768px){.score-overview{grid-template-columns:1fr}.stats-bar{grid-template-columns:repeat(3,1fr)}.summary-table{font-size:11px}}
</style></head><body><div class="container">
<h1>前端单元测试报告</h1>
<p class="subtitle">${esc(projectSlug)} — Vue 3 + Vite | 执行日期: ${now} | 测试框架: Vitest + @vue/test-utils + happy-dom</p>
<div class="score-overview">${scoreCards}</div>
<div class="stats-bar">
<div class="stat-item stat-blue"><div class="stat-num">${totalTests}</div><div class="stat-label">总用例数</div></div>
<div class="stat-item stat-green"><div class="stat-num">${totalPassed}</div><div class="stat-label">通过</div></div>
<div class="stat-item stat-red"><div class="stat-num">${totalFailed}</div><div class="stat-label">失败</div></div>
<div class="stat-item stat-purple"><div class="stat-num">${passRate}%</div><div class="stat-label">通过率</div></div>
<div class="stat-item stat-orange"><div class="stat-num">${vitestReport.numTotalTestSuites || 0}</div><div class="stat-label">测试文件</div></div>
<div class="stat-item"><div class="stat-num">${(vitestReport.numPassedTestSuites || 0)}</div><div class="stat-label">全通过文件</div></div>
</div>
<div class="pass-rate-bar"><div class="pass-rate-fill"></div></div>
${failedSection}
${sections}
<div class="section"><h2>📊 文件汇总表</h2>
<table class="summary-table"><thead><tr><th>#</th><th>测试文件</th><th>源文件</th><th>分类</th><th>用例数</th><th>通过</th><th>失败</th><th>通过率</th></tr></thead>
<tbody>${summaryRows}</tbody>
<tfoot><tr style="background:#f8f9fa;font-weight:600"><td></td><td colspan="3">合计</td><td class="count">${totalTests}</td><td class="count pass-count">${totalPassed}</td><td class="count ${totalFailed > 0 ? 'fail-count' : ''}">${totalFailed}</td><td class="count">${passRate}%</td></tr></tfoot>
</table></div>
</div>
<script>function toggleModule(h){const c=h.nextElementSibling,t=h.querySelector('.toggle'),o=c.classList.contains('open');if(o){c.classList.remove('open');t.style.transform='rotate(0deg)'}else{c.classList.add('open');t.style.transform='rotate(90deg)'}}</script>
</body></html>`;
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

/**
 * 根据模块层级（frontend/backend）过滤出对应的审查规则
 * 如果 rulesContent 为空，返回通用兜底文本
 */
function buildLayerRulesSection(rulesContent: string, layer: string): string {
  if (!rulesContent) {
    return layer === 'backend'
      ? '## 审查维度\n请从后端安全性（SQL注入、鉴权）、性能（缓存、连接池）、错误处理（异常捕获、事务回滚）、框架最佳实践、可维护性五个维度审查。'
      : '## 审查维度\n请从安全性、性能、错误处理、框架最佳实践、可维护性五个维度审查。';
  }

  try {
    const rules = JSON.parse(rulesContent);
    if (!rules.dimensions || !Array.isArray(rules.dimensions)) {
      return `## 审查筛查规则（参考指引）\n${rulesContent}`;
    }

    // 过滤出与当前层级匹配的维度
    const filteredDimensions = rules.dimensions.filter((dim: any) => {
      const dimLayer = (dim as any).layer;
      if (!dimLayer) return true; // 没有标记 layer 的维度（通用维度）保留
      return dimLayer === layer;
    });

    const filteredRules = { ...rules, dimensions: filteredDimensions };
    return `## 审查筛查规则（参考指引）\n以下是筛查规则，定义了应该"查什么"和"怎么查"。请按这些规则的方法去检查实际代码，以你的实际分析结论为准，不要照搬规则描述。\n\n${JSON.stringify(filteredRules, null, 2)}`;
  } catch {
    return `## 审查筛查规则（参考指引）\n${rulesContent}`;
  }
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

  // 读取发现数据中的模块信息和技术栈
  const discoveryPath = path.join(DATA_DIR, 'projects', projectId!, 'review-discovery.json');
  let modules: any[] = [];
  let discoveryData: any = null;
  if (fs.existsSync(discoveryPath)) {
    try {
      const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
      modules = discovery.modules || [];
      discoveryData = discovery;
    } catch { /* ignore */ }
  }

  // 从 discovery 结果提取技术栈信息
  const projectStructure = discoveryData?.projectStructure || {};
  const feInfo = projectStructure.frontend || {};
  const beInfo = projectStructure.backend || {};
  const feFramework = feInfo.framework || '';
  const beFramework = beInfo.framework || '';
  const feSourceRoot = feInfo.sourceRoot || '';
  const beSourceRoot = beInfo.sourceRoot || '';

  // 构建技术栈描述
  const techStackParts: string[] = [];
  if (feFramework && feFramework !== '无') techStackParts.push(`前端: ${feFramework} (${feInfo.language || 'JavaScript'}, ${feInfo.buildTool || ''})`);
  if (beFramework && beFramework !== '无') techStackParts.push(`后端: ${beFramework} (${beInfo.language || ''}, ${beInfo.buildTool || ''})`);
  const techStackSection = techStackParts.length > 0
    ? `- 技术栈: ${techStackParts.join(' + ')}`
    : '';

  // 构建全量审查的 reviewScope（基于实际目录结构）
  const fullReviewScopeParts: string[] = ['请扫描项目源码，重点关注以下目录：'];
  let scopeIdx = 1;
  if (feSourceRoot) {
    fullReviewScopeParts.push(`${scopeIdx}. ${feSourceRoot} 下的前端源码（页面、组件、工具、接口等）`);
    scopeIdx++;
  }
  if (beSourceRoot) {
    fullReviewScopeParts.push(`${scopeIdx}. ${beSourceRoot} 下的后端源码（控制器、服务、数据访问、配置等）`);
    scopeIdx++;
  }
  if (scopeIdx === 1) {
    // 没有探测到具体路径时兜底
    fullReviewScopeParts.push('1. src/ 下的所有源码文件');
  }
  const fullReviewScope = fullReviewScopeParts.join('\n');

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
        const layer = (mod as any).layer || 'frontend';
        const layerLabel = layer === 'backend' ? '后端' : '前端';
        const layerFramework = layer === 'backend'
          ? (beFramework || '未知')
          : (feFramework || '未知');

        const moduleInfoSection = `## 审查模块
- 模块名称: ${mod.name}
- 模块路径: ${mod.path}
- 层级: ${layerLabel} (${layerFramework})
- 文件数量: ${mod.files}
- 风险等级: ${mod.riskLevel || 'unknown'}
- 关注方向:
${riskText}

## 模块关键文件
${fileList}`;

        // 根据 layer 过滤出相关规则维度
        const rulesSectionForModule = buildLayerRulesSection(rulesContent, layer);

        const skillContent = loadCodeReviewSkill({
          projectName: project.name,
          sourcePath: project.sourcePath!,
          techStackSection,
          moduleInfoSection,
          rulesSection: rulesSectionForModule,
          reviewScope: `请重点扫描上述关键文件，以及模块路径 ${mod.path} 下的其他相关文件。该模块属于${layerLabel}，请使用${layerLabel}相关的审查标准。`,
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
        techStackSection,
        moduleInfoSection: '',
        rulesSection: rulesContent
          ? `## 审查筛查规则（参考指引）\n以下是筛查规则，定义了应该"查什么"和"怎么查"。请按这些规则的方法去检查实际代码，以你的实际分析结论为准，不要照搬规则描述。\n\n${rulesContent}`
          : '## 审查维度\n请从安全性、性能、错误处理、框架最佳实践、可维护性五个维度审查。',
        reviewScope: fullReviewScope,
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

/** 扫描报告目录，返回所有 HTML/MD 文件 */
export function listReportFiles(projectId: string): { reportsDir: string; files: { name: string; path: string; type: 'html' | 'md'; size: number; mtime: string }[] } {
  const project = getProjectById(projectId);
  if (!project) throw new Error('项目不存在');
  const projectSlug = project.name.replace(/[<>:"/\\|?*\s]+/g, '_');
  const base = getConfig().testDataDir || getConfig().e2eDataDir;
  const reportsDir = path.join(base, 'codereview', 'reports', projectSlug);
  const files: { name: string; path: string; type: 'html' | 'md'; size: number; mtime: string }[] = [];
  if (fs.existsSync(reportsDir)) {
    for (const f of fs.readdirSync(reportsDir)) {
      const ext = path.extname(f).toLowerCase();
      if (ext !== '.html' && ext !== '.md') continue;
      const full = path.join(reportsDir, f);
      const stat = fs.statSync(full);
      files.push({
        name: f,
        path: full,
        type: ext === '.html' ? 'html' : 'md',
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { reportsDir, files };
}

/** 从选中的 MD 文件合并生成 HTML 报告 */
export function buildHtmlFromMdFiles(projectId: string, mdFiles: string[]): { htmlPath: string; moduleCount: number } {
  const project = getProjectById(projectId);
  if (!project) throw new Error('项目不存在');
  const projectSlug = project.name.replace(/[<>:"/\\|?*\s]+/g, '_');
  const base = getConfig().testDataDir || getConfig().e2eDataDir;
  const reportsDir = path.join(base, 'codereview', 'reports', projectSlug);
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  // 读取并合并 MD
  const parts: string[] = [];
  for (const f of mdFiles) {
    // 安全检查：确保文件在报告目录内
    const resolved = path.resolve(f);
    if (!resolved.startsWith(path.resolve(reportsDir))) continue;
    if (!fs.existsSync(resolved)) continue;
    const content = fs.readFileSync(resolved, 'utf-8');
    if (content.length < 50) continue;
    const name = path.basename(resolved, '.md').replace(/^manual-/, '');
    parts.push(`---\n## ${name}\n\n${content}`);
  }
  if (parts.length === 0) throw new Error('没有有效的 MD 文件');

  const merged = parts.join('\n\n');
  const html = buildReviewHtml(project.name, merged, 0);
  const ts = new Date().toISOString().slice(0, 10);
  const htmlPath = path.join(reportsDir, `review-${ts}.html`);
  fs.writeFileSync(htmlPath, html, 'utf-8');
  return { htmlPath, moduleCount: parts.length };
}

/** 将 Markdown 审查结果转为独立 HTML 报告（服务端渲染，无 CDN 依赖） */
export function buildReviewHtml(projectName: string, markdown: string, duration: number): string {
  const durationSec = (duration / 1000).toFixed(1);

  // ====== 按 h1 标题分割模块（避免 ---\n## 被内部标题误匹配） ======
  const h1Regex = /^# (.+)$/gm;
  const modules: { title: string; content: string; html: string; score: number | null; risk: string; critical: number; warning: number; info: number }[] = [];
  const splits: { title: string; index: number }[] = [];
  let h1Match: RegExpExecArray | null;
  while ((h1Match = h1Regex.exec(markdown)) !== null) {
    // 提取纯模块名（去掉 "— 代码审查报告" 等后缀）
    let title = h1Match[1].trim();
    title = title.replace(/\s*[—–\-]+\s*(深度)?代码审查报告.*$/, '').replace(/(深度)?代码审查报告\s*[—–\-]+\s*/, '').trim();
    splits.push({ title, index: h1Match.index });
  }

  function extractScore(content: string): number | null {
    const m1 = content.match(/模块评分[：:]\s*(\d+)/);
    if (m1) return parseInt(m1[1]);
    // 综合评分（0-100）\n**58 / 100** 或 综合评分（0-100）\n72
    const m2 = content.match(/综合评分[^\n]*\n\s*\*{0,2}(\d{1,3})\s*(?:\/\s*100)?/);
    if (m2 && parseInt(m2[1]) > 0) return parseInt(m2[1]);
    const m3 = content.match(/总体评分[：:]\s*(\d+)/);
    if (m3) return parseInt(m3[1]);
    return null;
  }

  function extractRisk(content: string): string {
    const m = content.match(/风险等级[：:]*\s*(high|medium|low|高|中|低)/i);
    if (m) {
      const v = m[1].toLowerCase();
      if (v === 'high' || v === '高') return 'high';
      if (v === 'medium' || v === '中') return 'medium';
      if (v === 'low' || v === '低') return 'low';
    }
    return '';
  }

  function countSeverity(content: string): { critical: number; warning: number; info: number } {
    let critical = 0, warning = 0, info = 0;
    const headings = content.match(/^#{2,4}\s+.+$/gm) || [];
    for (const h of headings) {
      if (/🔴|\bCritical\b|P0/i.test(h)) critical++;
      if (/🟡|\bWarning\b|\bHigh\b|P1/i.test(h)) warning++;
      if (/🔵|\bInfo\b|\bMedium\b|P2/i.test(h)) info++;
    }
    return { critical, warning, info };
  }

  // 在报告头部的元数据字段（审查日期、审查范围、风险等级）之间插入空行，确保各占一行
  function formatHeaderFields(md: string): string {
    // 第一步：先拆审查范围——将 "**审查范围**:" 与文件路径列表分开，文件路径单独成行
    let result = md.replace(
      /(\*\*审查范围\*\*[:：])\s*((?:`[^`]+`\s*,?\s*)+)/g,
      '$1\n\n$2'
    );
    // 第二步：在连续的字段行之间插入空行，使 marked 渲染为独立段落
    result = result.replace(
      /^(\*\*(?:审查日期|审查范围|审查工具|风险等级)\*\*[:：].*)$(\n)(\*\*(?:审查日期|审查范围|审查工具|风险等级)\*\*[:：])/gm,
      '$1\n\n$3'
    );
    // 第三步：文件路径行（以反引号开头）后面紧跟风险等级时，插入空行
    result = result.replace(
      /^(`[^`]+`.*)$(\n)(\*\*(?:审查日期|审查范围|审查工具|风险等级)\*\*[:：])/gm,
      '$1\n\n$3'
    );
    return result;
  }

  if (splits.length === 0) {
    const formatted = formatHeaderFields(markdown);
    const html = marked.parse(formatted) as string;
    const score = extractScore(markdown);
    const risk = extractRisk(markdown);
    const sev = countSeverity(markdown);
    modules.push({ title: '完整审查报告', content: markdown, html, score, risk, ...sev });
  } else {
    for (let i = 0; i < splits.length; i++) {
      // 从 h1 标题行结束位置开始取内容
      const start = markdown.indexOf('\n', splits[i].index);
      const end = i + 1 < splits.length ? splits[i + 1].index : markdown.length;
      const content = markdown.substring(start !== -1 ? start + 1 : splits[i].index, end).trim();
      const formatted = formatHeaderFields(content);
      const html = marked.parse(formatted) as string;
      const score = extractScore(content);
      const risk = extractRisk(content);
      const sev = countSeverity(content);
      modules.push({ title: splits[i].title, content, html, score, risk, ...sev });
    }
  }

  // ====== 汇总统计 ======
  let totalCritical = 0, totalWarning = 0, totalInfo = 0;
  let scoreSum = 0, scoreCount = 0;
  for (const m of modules) {
    totalCritical += m.critical;
    totalWarning += m.warning;
    totalInfo += m.info;
    if (m.score !== null) { scoreSum += m.score; scoreCount++; }
  }
  const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null;

  function scoreColor(s: number | null): string {
    if (s === null) return '#8c8c8c';
    if (s >= 80) return '#52c41a';
    if (s >= 60) return '#1890ff';
    if (s >= 40) return '#faad14';
    return '#ff4d4f';
  }
  function scoreColorBg(s: number | null): string {
    if (s === null) return '#f5f5f5';
    if (s >= 80) return '#f6ffed';
    if (s >= 60) return '#e6f7ff';
    if (s >= 40) return '#fffbe6';
    return '#fff1f0';
  }
  function riskLabel(r: string): string {
    if (r === 'high') return '高风险';
    if (r === 'medium') return '中风险';
    if (r === 'low') return '低风险';
    return '';
  }

  // ====== 构建侧边栏 ======
  let sidebarHtml = `<div class="sidebar-item active" data-idx="-1"><span class="sidebar-icon">\u{1F4CA}</span><span class="name">总览</span></div>`;
  modules.forEach((m, i) => {
    const riskTag = m.risk ? `<span class="risk ${m.risk}">${riskLabel(m.risk)}</span>` : '';
    const scoreTag = m.score !== null ? `<span class="score-badge" style="background:${scoreColorBg(m.score)};color:${scoreColor(m.score)}">${m.score}</span>` : '';
    sidebarHtml += `<div class="sidebar-item" data-idx="${i}">${riskTag}<span class="name">${m.title}</span>${scoreTag}</div>`;
  });

  // ====== 构建总览卡片 ======
  let overviewCards = '';
  modules.forEach((m, i) => {
    const sc = scoreColor(m.score);
    const scBg = scoreColorBg(m.score);
    const riskTag = m.risk ? `<span class="card-risk ${m.risk}">${riskLabel(m.risk)}</span>` : '';
    overviewCards += `<div class="overview-card" data-idx="${i}">
      <div class="card-header">
        <span class="card-title">${m.title}</span>
        ${riskTag}
      </div>
      <div class="card-score">
        <span class="score-circle" style="border-color:${sc};color:${sc}">${m.score !== null ? m.score : '--'}</span>
        <span class="score-label">/ 100</span>
      </div>
      <div class="card-stats">
        <span class="stat critical">${m.critical} 严重</span>
        <span class="stat warning">${m.warning} 警告</span>
        <span class="stat info">${m.info} 建议</span>
      </div>
      <div class="card-action">查看详情 \u2192</div>
    </div>`;
  });

  // ====== 构建模块内容区 ======
  let contentHtml = '';
  modules.forEach((m, i) => {
    contentHtml += `<div class="module-section" id="module-${i}">
      <div class="module-header-bar">
        <button class="btn-back" onclick="showOverview()">\u2190 返回总览</button>
        <h1>${m.title}</h1>
        ${m.score !== null ? `<span class="module-score-badge" style="background:${scBg(m.score)};color:${scoreColor(m.score)}">${m.score} 分</span>` : ''}
        ${m.risk ? `<span class="module-risk ${m.risk}">${riskLabel(m.risk)}</span>` : ''}
      </div>
      <div class="module-body">${m.html}</div>
    </div>`;
  });

  // avoid unused var
  void avgScore;
  void scoreColorBg;

  function scBg(s: number | null): string {
    return scoreColorBg(s);
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>代码审查报告 - ${projectName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f0f2f5; color: #1f1f1f; }

  /* ===== Header ===== */
  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 28px 40px; }
  .header h1 { font-size: 22px; font-weight: 600; display: flex; align-items: center; gap: 12px; }
  .header .engine-tag { display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 3px 12px; border-radius: 12px; font-size: 11px; font-weight: 500; letter-spacing: 0.5px; }
  .header .meta { font-size: 13px; opacity: 0.7; margin-top: 6px; }

  /* ===== Summary Strip ===== */
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 20px 40px; background: white; border-bottom: 1px solid #e8e8e8; }
  .summary-card { text-align: center; padding: 14px 16px; border-radius: 10px; background: #fafbfc; border: 1px solid #f0f0f0; }
  .summary-card .value { font-size: 28px; font-weight: 700; }
  .summary-card .label { font-size: 12px; color: #8c8c8c; margin-top: 4px; }
  .clr-module { color: #667eea; } .clr-critical { color: #ff4d4f; } .clr-warning { color: #faad14; } .clr-info { color: #1890ff; }

  /* ===== Layout ===== */
  .container { display: flex; min-height: calc(100vh - 240px); }
  .sidebar { width: 260px; background: white; border-right: 1px solid #e8e8e8; overflow-y: auto; flex-shrink: 0; }
  .content { flex: 1; padding: 0; overflow-y: auto; background: #f0f2f5; }

  /* ===== Sidebar ===== */
  .sidebar-item { padding: 12px 18px; cursor: pointer; border-bottom: 1px solid #f5f5f5; display: flex; align-items: center; gap: 8px; font-size: 13px; transition: all 0.15s; user-select: none; }
  .sidebar-item:hover { background: #fafafa; }
  .sidebar-item.active { background: #f0f5ff; border-left: 3px solid #667eea; padding-left: 15px; }
  .sidebar-icon { font-size: 15px; }
  .sidebar-item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sidebar-item .score-badge { font-size: 11px; padding: 1px 8px; border-radius: 10px; font-weight: 600; flex-shrink: 0; }
  .sidebar-item .risk { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 500; flex-shrink: 0; }
  .sidebar-item .risk.high { background: #fff1f0; color: #cf1322; }
  .sidebar-item .risk.medium { background: #fffbe6; color: #d48806; }
  .sidebar-item .risk.low { background: #e6f7ff; color: #0958d9; }

  /* ===== Overview ===== */
  .overview { padding: 28px 32px; }
  .overview-title { font-size: 18px; font-weight: 600; color: #1a1a2e; margin-bottom: 20px; }
  .overview-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
  .overview-card { background: white; border-radius: 12px; padding: 20px; cursor: pointer; transition: all 0.2s; border: 1px solid #f0f0f0; position: relative; }
  .overview-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); transform: translateY(-2px); border-color: #d9d9d9; }
  .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .card-title { font-size: 15px; font-weight: 600; color: #1a1a2e; }
  .card-risk { font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
  .card-risk.high { background: #fff1f0; color: #cf1322; }
  .card-risk.medium { background: #fffbe6; color: #d48806; }
  .card-risk.low { background: #e6f7ff; color: #0958d9; }
  .card-score { display: flex; align-items: baseline; gap: 4px; margin-bottom: 12px; }
  .score-circle { font-size: 32px; font-weight: 700; }
  .score-label { font-size: 14px; color: #8c8c8c; }
  .card-stats { display: flex; gap: 12px; margin-bottom: 14px; }
  .card-stats .stat { font-size: 12px; padding: 2px 8px; border-radius: 4px; }
  .card-stats .critical { background: #fff1f0; color: #cf1322; }
  .card-stats .warning { background: #fffbe6; color: #d48806; }
  .card-stats .info { background: #e6f7ff; color: #0958d9; }
  .card-action { font-size: 12px; color: #667eea; font-weight: 500; }

  /* ===== Module Detail ===== */
  .module-section { display: none; }
  .module-section.active { display: block; }
  .module-header-bar { background: white; padding: 16px 32px; border-bottom: 1px solid #e8e8e8; display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 10; }
  .btn-back { background: none; border: 1px solid #d9d9d9; padding: 4px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; color: #666; transition: all 0.15s; }
  .btn-back:hover { border-color: #667eea; color: #667eea; }
  .module-header-bar h1 { font-size: 18px; color: #1a1a2e; font-weight: 600; flex: 1; }
  .module-score-badge { font-size: 14px; padding: 3px 12px; border-radius: 8px; font-weight: 600; }
  .module-risk { font-size: 11px; padding: 2px 10px; border-radius: 10px; font-weight: 500; }
  .module-risk.high { background: #fff1f0; color: #cf1322; }
  .module-risk.medium { background: #fffbe6; color: #d48806; }
  .module-risk.low { background: #e6f7ff; color: #0958d9; }
  .module-body { padding: 24px 32px 40px; background: white; margin: 20px 24px; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }

  /* ===== Markdown 渲染样式 ===== */
  .module-body h1 { display: none; }
  .module-body h2 { font-size: 17px; color: #1a1a2e; margin: 28px 0 14px; padding-bottom: 8px; border-bottom: 2px solid #667eea; font-weight: 600; }
  .module-body h2:first-child { margin-top: 0; }
  .module-body h3 { font-size: 15px; color: #2d3748; margin: 20px 0 10px; padding-left: 10px; border-left: 3px solid #667eea; }
  .module-body h4 { font-size: 14px; color: #4a5568; margin: 16px 0 8px; font-weight: 600; }
  .module-body p { margin: 8px 0; line-height: 1.85; font-size: 14px; color: #333; }
  .module-body ul, .module-body ol { padding-left: 22px; margin: 8px 0; }
  .module-body li { margin: 4px 0; font-size: 14px; line-height: 1.8; }
  .module-body code { background: #f0f0ff; padding: 2px 7px; border-radius: 4px; font-size: 13px; color: #667eea; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; }
  .module-body pre { background: #1e1e2e; color: #cdd6f4; padding: 18px 20px; border-radius: 10px; overflow-x: auto; margin: 14px 0; font-size: 13px; line-height: 1.6; border: 1px solid #313244; }
  .module-body pre code { background: none; color: #cdd6f4; padding: 0; }
  .module-body strong { color: #1a1a2e; font-weight: 600; }
  .module-body table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
  .module-body th { background: #fafbfc; padding: 10px 14px; text-align: left; border: 1px solid #e8e8e8; font-weight: 600; color: #1a1a2e; }
  .module-body td { padding: 10px 14px; border: 1px solid #e8e8e8; }
  .module-body tr:nth-child(even) td { background: #fafbfc; }
  .module-body blockquote { border-left: 4px solid #667eea; padding: 10px 18px; background: #f8f8ff; margin: 14px 0; border-radius: 0 8px 8px 0; color: #555; }
  .module-body hr { border: none; border-top: 1px solid #e8e8e8; margin: 24px 0; }

  /* ===== Footer ===== */
  .footer { text-align: center; padding: 18px; font-size: 12px; color: #bfbfbf; background: white; border-top: 1px solid #f0f0f0; }

  /* ===== Print ===== */
  @media print { .sidebar, .btn-back { display: none !important; } .container { display: block; } .module-section { display: block !important; page-break-before: always; } .module-body { box-shadow: none; margin: 0; } }
</style>
</head>
<body>

<div class="header">
  <h1>代码审查报告 <span class="engine-tag">Claude Code AI</span></h1>
  <div class="meta">项目: ${projectName} | 模块: ${modules.length} | 耗时: ${durationSec}s | ${new Date().toLocaleString('zh-CN')}</div>
</div>

<div class="summary">
  <div class="summary-card">
    <div class="value clr-module">${modules.length}</div>
    <div class="label">审查模块</div>
  </div>
  <div class="summary-card">
    <div class="value clr-critical">${totalCritical}</div>
    <div class="label">严重问题</div>
  </div>
  <div class="summary-card">
    <div class="value clr-warning">${totalWarning}</div>
    <div class="label">警告问题</div>
  </div>
  <div class="summary-card">
    <div class="value clr-info">${totalInfo}</div>
    <div class="label">建议改进</div>
  </div>
</div>

<div class="container">
  <div class="sidebar" id="sidebar">${sidebarHtml}</div>
  <div class="content" id="content">
    <div class="overview active" id="overview">
      <div class="overview-title">模块总览</div>
      <div class="overview-grid">${overviewCards}</div>
    </div>
    ${contentHtml}
  </div>
</div>

<div class="footer">由 AI Platform 自动生成</div>

<script>
function switchView(idx) {
  document.querySelectorAll('.sidebar-item').forEach(function(el) { el.classList.remove('active'); });
  var target = document.querySelector('.sidebar-item[data-idx="' + idx + '"]');
  if (target) target.classList.add('active');
  document.getElementById('overview').classList.remove('active');
  document.getElementById('overview').style.display = 'none';
  document.querySelectorAll('.module-section').forEach(function(el) { el.classList.remove('active'); });
  if (idx === -1) {
    document.getElementById('overview').style.display = 'block';
    document.getElementById('overview').classList.add('active');
  } else {
    var mod = document.getElementById('module-' + idx);
    if (mod) mod.classList.add('active');
  }
}
function showOverview() { switchView(-1); }

document.querySelectorAll('.sidebar-item').forEach(function(item) {
  item.addEventListener('click', function() {
    switchView(parseInt(item.getAttribute('data-idx')));
  });
});
document.querySelectorAll('.overview-card').forEach(function(card) {
  card.addEventListener('click', function() {
    switchView(parseInt(card.getAttribute('data-idx')));
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
      const mode = 'deep';
      const scope = (config.scope as string) || 'all';
      const projectId = config.projectId as string | undefined;
      const project = projectId ? getProjectById(projectId) : undefined;
      if (project && project.pageSets && project.pageSets.length > 0) {
        // 按 PageSet 拆分为独立 case，支持逐 PageSet 执行和断点续跑
        const targetSets = scope === 'all'
          ? project.pageSets
          : project.pageSets.filter(ps => ps.id === scope);
        for (const ps of targetSets) {
          const pageCount = ps.pages?.length || 0;
          cases.push({
            id: uuid(),
            name: `${ps.name} (${pageCount}页)`,
            type,
            status: 'pending',
          });
        }
        // 如果 scope 指定了单个 pageSet 但没匹配到，fallback
        if (targetSets.length === 0) {
          cases.push({ id: uuid(), name: `E2E ${mode} 测试`, type, status: 'pending' });
        }
      } else {
        const label = project ? `${project.name} ${scope}` : scope;
        cases.push({ id: uuid(), name: `E2E ${mode} 测试 (${label})`, type, status: 'pending' });
      }
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
  if (original.type !== 'codereview' && original.type !== 'e2e') throw new Error('仅支持代码审查和 E2E 测试类型的恢复');

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

/** 注册手动执行产生的报告（让测试页面可见） */
export function registerManualReport(params: {
  type: string;
  projectId?: string;
  projectName?: string;
  reportPath?: string;
  reportFile?: string;  // 报告文件名（如 review-2026-06-03-1430.html），后端自动拼接目录
}): string {
  const suiteId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  // 从 projectId 查项目名（避免 curl 传中文乱码）
  let displayName = '未知项目';
  let projectSlug = 'unknown';
  let reportsDir = '';
  if (params.projectId) {
    const project = getProjectById(params.projectId);
    if (project?.name) {
      displayName = project.name;
      projectSlug = project.name.replace(/[<>:"/\\|?*\s]+/g, '_');
    }
    const base = getConfig().testDataDir || getConfig().e2eDataDir;
    reportsDir = path.join(base, 'codereview', 'reports', projectSlug);
  }

  // 确定 reportPath：优先用 reportFile 自动拼接（避免中文路径通过 curl 乱码）
  let finalReportPath = params.reportPath || '';
  if (!finalReportPath && params.reportFile && reportsDir) {
    finalReportPath = path.join(reportsDir, params.reportFile).replace(/\\/g, '/');
  }

  const suite: TestSuite = {
    id: suiteId,
    name: `${displayName} — 手动代码审查`,
    type: (params.type || 'codereview') as TestType,
    cases: [{
      id: `case-${suiteId}`,
      name: `${displayName} — 手动代码审查`,
      type: (params.type || 'codereview') as TestType,
      status: 'passed',
      duration: 0,
    }],
    status: 'passed',
    startedAt: now,
    finishedAt: now,
    config: {
      projectId: params.projectId || '',
      reportPath: finalReportPath,
      isManual: true,
    },
  };

  const dir = getRunsDir(suite.type as TestType);
  fs.writeFileSync(path.join(dir, `${suiteId}.json`), JSON.stringify(suite, null, 2), 'utf-8');
  runs.set(suiteId, suite);
  return suiteId;
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
    let rulesSection = '## 审查维度\n请从安全性、性能、错误处理、框架最佳实践、可维护性五个维度审查。';
    if (fs.existsSync(rulesPath)) {
      try {
        const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
        rulesSection = `## 审查筛查规则（参考指引）\n以下是筛查规则，定义了应该"查什么"和"怎么查"。请按这些规则的方法去检查实际代码，以你的实际分析结论为准，不要照搬规则描述。\n\n${JSON.stringify(rules, null, 2)}`;
      } catch { /* ignore */ }
    }

    // 读取模块信息和技术栈
    const discoveryPath = path.join(DATA_DIR, 'projects', projectId!, 'review-discovery.json');
    let allModules: any[] = [];
    let promptDiscovery: any = null;
    if (fs.existsSync(discoveryPath)) {
      try {
        const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
        allModules = discovery.modules || [];
        promptDiscovery = discovery;
      } catch { /* ignore */ }
    }

    // 从 discovery 提取技术栈信息
    const promptStruct = promptDiscovery?.projectStructure || {};
    const promptFe = promptStruct.frontend || {};
    const promptBe = promptStruct.backend || {};
    const promptTechParts: string[] = [];
    if (promptFe.framework && promptFe.framework !== '无') promptTechParts.push(`前端: ${promptFe.framework}`);
    if (promptBe.framework && promptBe.framework !== '无') promptTechParts.push(`后端: ${promptBe.framework}`);
    const techLine = promptTechParts.length > 0 ? promptTechParts.join(' + ') : '未知';

    const selectedModules = allModules.filter((m: any) => selectedModuleIds.includes(m.id));
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    const registerUrl = `http://localhost:3100/api/tests/register-manual-report`;
    const htmlReportName = `review-${ts}.html`;

    // 按模块逐个生成审查指令
    if (selectedModules.length > 0) {
      const moduleParts = selectedModules.map((mod: any) => {
        const fileList = (mod.keyFiles || []).map((f: string) => `   - ${f}`).join('\n');
        const riskIndicators = (mod as any).riskIndicators || (mod.reason ? [mod.reason] : []);
        const riskText = riskIndicators.length > 0 ? riskIndicators.map((r: string) => `   - ${r}`).join('\n') : '无';
        const modSlug = mod.name.replace(/[<>:"/\\|?*]+/g, '_');
        const reportPath = path.join(reportsDir, `manual-${modSlug}.md`).replace(/\\/g, '/');
        const layer = (mod as any).layer || 'frontend';
        const layerLabel = layer === 'backend' ? '后端' : '前端';

        return `### ${mod.name}
- 模块路径: ${mod.path}
- 层级: ${layerLabel}
- 文件数量: ${mod.files}
- 风险等级: ${mod.riskLevel || 'unknown'}
- 关注方向:
${riskText}
- 关键文件:
${fileList}
- 报告输出路径: ${reportPath}`;
      }).join('\n\n');

      // 合并 Markdown 路径（把所有模块合成一份，后端用固定模板生成 HTML）
      const mergedMdPath = path.join(reportsDir, `review-${ts}.md`).replace(/\\/g, '/');
      const htmlReportPath = path.join(reportsDir, `review-${ts}.html`).replace(/\\/g, '/');
      const buildHtmlUrl = `http://localhost:3100/api/tests/build-review-html`;

      const prompt = `请先 Read 以下 Skill 文件理解审查流程，然后对指定模块逐个执行代码审查。

Skill 文件: ${skillFile.replace(/\\/g, '/')}

## 项目信息
- 项目名称: ${project.name}
- 源码路径: ${project.sourcePath}
- 技术栈: ${techLine}

${rulesSection}

## 待审查模块 (${selectedModules.length}个)
${moduleParts}

## 执行方式
1. 对每个模块分别审查，按 Skill 中定义的格式生成报告，用 Write 工具写入各模块对应的「报告输出路径」
2. 全部模块审查完成后，将所有模块报告合并为一份 Markdown 文件（每个模块之间用 \`---\\n## 模块名\` 分隔），写入: ${mergedMdPath}
3. 用 Bash 调用平台 API 生成统一风格的 HTML 报告：
   curl -s -X POST "${buildHtmlUrl}" -H "Content-Type: application/json" -d "{\"markdownPath\":\"${mergedMdPath}\",\"htmlPath\":\"${htmlReportPath}\",\"projectName\":\"${projectSlug}\"}"
4. 用 Bash 注册报告到平台（使报告在测试页面可见）：
   curl -s -X POST "${registerUrl}" -H "Content-Type: application/json" -d "{\"type\":\"codereview\",\"projectId\":\"${projectId}\",\"reportFile\":\"${htmlReportName}\"}"`;

      return { prompt, cwd: project.sourcePath };
    }

    // 全量审查
    const reportPath = path.join(reportsDir, `manual-full-${ts}.md`).replace(/\\/g, '/');
    const htmlReportPath = path.join(reportsDir, `review-${ts}.html`).replace(/\\/g, '/');
    const buildHtmlUrl = `http://localhost:3100/api/tests/build-review-html`;

    // 构建全量审查范围（基于 discovery 结果的实际路径）
    const fullScopeParts: string[] = ['请扫描项目源码全面审查，重点关注以下目录：'];
    if (promptFe.sourceRoot) fullScopeParts.push(`- ${promptFe.sourceRoot}（前端源码）`);
    if (promptBe.sourceRoot) fullScopeParts.push(`- ${promptBe.sourceRoot}（后端源码）`);
    if (!promptFe.sourceRoot && !promptBe.sourceRoot) fullScopeParts.push('- src/ 下的所有源码文件');
    const fullScopeText = fullScopeParts.join('\n');

    const prompt = `请先 Read 以下 Skill 文件理解审查流程，然后对项目进行全面代码审查。

Skill 文件: ${skillFile.replace(/\\/g, '/')}

## 项目信息
- 项目名称: ${project.name}
- 源码路径: ${project.sourcePath}
- 技术栈: ${techLine}

${rulesSection}

## 审查范围
${fullScopeText}

## 执行方式
1. 按 Skill 中定义的格式生成 Markdown 报告，用 Write 工具写入: ${reportPath}
2. 用 Bash 调用平台 API 生成统一风格的 HTML 报告：
   curl -s -X POST "${buildHtmlUrl}" -H "Content-Type: application/json" -d "{\"markdownPath\":\"${reportPath}\",\"htmlPath\":\"${htmlReportPath}\",\"projectName\":\"${projectSlug}\"}"
3. 用 Bash 注册报告到平台（使报告在测试页面可见）：
   curl -s -X POST "${registerUrl}" -H "Content-Type: application/json" -d "{\"type\":\"codereview\",\"projectId\":\"${projectId}\",\"reportFile\":\"${htmlReportName}\"}"`;

    return { prompt, cwd: project.sourcePath };
  }

  if (type === 'e2e') {
    if (!project) throw new Error('请选择项目');
    const skillFile = path.resolve(base, 'skills', 'tests', 'e2e-page-test', 'SKILL.md');
    const mode = 'deep';
    const scope = (config.scope as string) || 'all';
    const projectSlug = project.name.replace(/[<>:"/\\|?*\s]+/g, '_');
    const e2eDataDir = (getConfig().testDataDir || getConfig().e2eDataDir).replace(/\\/g, '/');
    const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
    const knowledgeGraphPath = projectId
      ? path.join(DATA_DIR, 'projects', projectId, 'page-context.json').replace(/\\/g, '/')
      : '';

    // 构建页面列表
    const pages = resolvePages(project, scope);
    const pageList = pages.map(p => `- ${p.name}: ${project.baseUrl}${p.url}`).join('\n');

    // 构建参数映射
    const paramsInfo = project.globalParams && Object.keys(project.globalParams).length > 0
      ? `动态参数映射：\n${Object.entries(project.globalParams).map(([k, v]) => `  - ${k}: ${(v as string[]).join(', ')}`).join('\n')}`
      : '';

    // 构建页面列表（按 pageSet 分组）
    const pages = resolvePages(project, scope);
    const pagesBySet = new Map<string, typeof pages>();
    for (const p of pages) {
      const set = p.pageSet || 'default';
      if (!pagesBySet.has(set)) pagesBySet.set(set, []);
      pagesBySet.get(set)!.push(p);
    }

    let pageListSections = '';
    let totalIndex = 0;
    for (const [setName, setPages] of pagesBySet) {
      const tableRows = setPages.map(p => {
        const url = p.url.includes(':') ? `需从上级页面进入（路径含动态参数）` : `${project.baseUrl}${p.url}`;
        const remark = p.url.includes(':') ? '不能直接URL访问' : '';
        totalIndex++;
        return `| ${totalIndex} | ${p.name} | ${url} | ${remark} |`;
      }).join('\n');
      pageListSections += `\n### ${setName}（${setPages.length} 页）\n\n| 序号 | 页面名称 | URL | 备注 |\n|------|----------|-----|------|\n${tableRows}\n`;
    }

    // 构建参数映射
    const paramsInfo = project.globalParams && Object.keys(project.globalParams).length > 0
      ? `动态参数映射：\n${Object.entries(project.globalParams).map(([k, v]) => `  - ${k}: ${(v as string[]).join(', ')}`).join('\n')}`
      : '';

    const prompt = `我需要你执行 E2E 页面深度测试。请严格按照 Skill 文件的规范执行。

## 测试配置

- 项目名称：${project.name}
- 前端地址：${project.baseUrl}
- 后端 API：${project.apiBaseUrl || project.baseUrl}
- 登录页：${project.baseUrl}${project.loginUrl || ''}
- 登录账号：${project.username} / ${project.password}
- 测试产物输出目录：${e2eDataDir}
- 知识图谱路径：${knowledgeGraphPath || '（未配置）'}
- Skill 文件：${skillFile.replace(/\\/g, '/')}
${paramsInfo ? `\n${paramsInfo}\n` : ''}
请先读取 Skill 文件了解完整的测试规范和硬性最低标准${knowledgeGraphPath ? '，然后读取知识图谱文件获取页面上下文信息' : ''}。

## 测试范围

本次测试共 ${pages.length} 页。${scope !== 'all' ? `范围：${scope}` : '全部页面。'}
${pageListSections}
## 特别注意

1. **每个页面必须满足硬性最低标准**：CRUD页至少6个checks和6张截图，只读页至少4个checks和3张截图。"页面加载"不算有效interaction，必须真实操作按钮/输入框。
2. **URL 含动态参数的页面**（标注"不能直接URL访问"）：必须从上级列表页点击进入，不能直接URL访问。
3. **CRUD 管理页**：必须走完 新增→验证→编辑→验证→删除→验证 完整生命周期。
4. **遇到异常不要放弃**：页面重定向时尝试从正确入口进入，API报错时记录详细错误信息。
5. **每步必截**：每次操作后都要截图，截图命名格式为 \`{pageId}-{操作描述}.png\`。

## 执行要求

1. 先登录系统（${project.baseUrl}${project.loginUrl || ''}）
2. 严格按照 Skill 中的硬性最低标准逐页执行测试
3. 每页测完立即保存 JSON 结果和截图到磁盘
4. 全部完成后汇总 cross-page-issues.json 和 run.json
5. 产物写入 \`${e2eDataDir}/runs/${projectSlug}/{runId}/\` 目录

现在开始执行测试。`;

    return { prompt, cwd: project.sourcePath || base };
  }

  if (type === 'frontend') {
    if (!project?.sourcePath) throw new Error('请选择项目并配置源码路径');
    const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
    const discoveryPath = path.join(DATA_DIR, 'projects', projectId!, 'frontend-discovery.json');
    let discovery: any = null;
    try { discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8')); } catch { /* ignore */ }
    if (!discovery?.modules) throw new Error('请先在设置页面点击「发现组件」');

    // 读取 review-discovery 的文件分析数据
    let fileAnalysisMap = new Map<string, any>();
    try {
      const reviewData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'projects', projectId!, 'review-discovery.json'), 'utf-8'));
      const fa = reviewData?.fileAnalysis?.files;
      if (Array.isArray(fa)) {
        for (const item of fa) {
          if (item.path) fileAnalysisMap.set(item.path, item);
        }
      }
    } catch { /* review-discovery 可选 */ }

    const selectedModuleIds = (config.modules as string[]) || [];
    const selectedModules = selectedModuleIds.length > 0
      ? discovery.modules.filter((m: any) => selectedModuleIds.includes(m.id))
      : discovery.modules;
    if (selectedModules.length === 0) throw new Error('未找到选中的模块');

    const projectSlug = project.name.replace(/[<>:"/\\|?*\s]+/g, '_');
    const testsOutputDir = path.join(getConfig().testDataDir || getConfig().e2eDataDir, 'frontend', projectSlug).replace(/\\/g, '/');
    const moduleParts = selectedModules.map((mod: any) => {
      const moduleInfo = buildFrontendModuleInfo(mod, fileAnalysisMap);
      return `${moduleInfo}\n\n测试文件输出目录: ${testsOutputDir}/${mod.id || 'unknown'}/`;
    }).join('\n\n---\n\n');

    // 知识图谱辅助
    let pageContextSection = '暂无知识图谱数据。请仅基于源码分析生成测试。';
    const pageContextPath = path.join(DATA_DIR, 'projects', projectId!, 'page-context.json');
    try {
      const pageContext = JSON.parse(fs.readFileSync(pageContextPath, 'utf-8'));
      const sections = selectedModules.map((mod: any) => buildPageContextSection(mod, pageContext));
      pageContextSection = sections.join('\n\n');
    } catch { /* ignore */ }

    // 加载 Skill 内容
    const frontendSrcDir = detectFrontendSrcDir(discovery);
    const frontendSrcPathAbs = path.join(project.sourcePath, frontendSrcDir).replace(/\\/g, '/');
    const skillContent = loadFrontendTestSkill({
      projectName: project.name,
      sourcePath: project.sourcePath,
      moduleInfoSection: moduleParts,
      testsOutputDir,
      pageContextSection,
      frontendSrcDir,
      frontendSrcPath: frontendSrcPathAbs,
    });

    const prompt = `请执行以下前端单元测试生成任务。

${skillContent}

## 执行方式
1. 按 Skill 中的步骤逐模块生成 .test.ts 测试文件
2. 用 Read 读取源码真实内容，基于实际实现生成测试用例
3. 用 Write 将测试文件写入对应的输出目录
4. 确保每个源码文件都有对应的 .test.ts 文件`;

    return { prompt, cwd: project.sourcePath };
  }

  throw new Error(`类型 ${type} 暂不支持生成提示词`);
}
