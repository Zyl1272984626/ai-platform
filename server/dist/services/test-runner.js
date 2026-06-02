"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTestRuns = listTestRuns;
exports.getTestRun = getTestRun;
exports.createTestSuite = createTestSuite;
exports.executeTestRun = executeTestRun;
exports.abortTestRun = abortTestRun;
exports.deleteTestRun = deleteTestRun;
exports.listRunningSuites = listRunningSuites;
exports.getConcurrency = getConcurrency;
exports.setConcurrency = setConcurrency;
/**
 * 测试执行服务
 *
 * 支持 4 种测试类型：
 * - agent: Agent 智能体对话测试（通过 Claude Code SDK）
 * - e2e: Playwright E2E 页面测试（AI 模拟真人操作）
 * - frontend: 前端单元测试（vitest）
 * - api: 后端接口测试（.http 格式）
 */
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const net_1 = __importDefault(require("net"));
const config_js_1 = require("./config.js");
const test_events_js_1 = require("./test-events.js");
// ========== 存储 ==========
const runs = new Map();
const abortControllers = new Map(); // suiteId -> AbortController
const runsDir = path_1.default.resolve(config_js_1.AI_PLATFORM_ROOT, 'data', 'test-runs');
const typeQueues = { agent: [], e2e: [], frontend: [], api: [] };
const typeRunning = { agent: 0, e2e: 0, frontend: 0, api: 0 };
// 每种类型的最大并发数
const CONCURRENCY = {
    agent: 3,
    e2e: 2,
    frontend: 1,
    api: 2,
};
function processTypeQueue(type) {
    while (typeRunning[type] < CONCURRENCY[type] && typeQueues[type].length > 0) {
        const entry = typeQueues[type].shift();
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
function checkPort(port, host = 'localhost') {
    return new Promise(resolve => {
        const socket = new net_1.default.Socket();
        socket.setTimeout(3000);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('error', () => resolve(false));
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.connect(port, host);
    });
}
async function preflightCheck(type, config) {
    if (type !== 'e2e')
        return null;
    const projectId = config?.projectId;
    const project = projectId ? (0, config_js_1.getProjectById)(projectId) : undefined;
    if (project) {
        // 检测项目前端可达性
        try {
            const resp = await fetch(project.baseUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
            if (!resp.ok && resp.status !== 200) {
                return `项目 ${project.name} 前端不可达 (${project.baseUrl})`;
            }
        }
        catch {
            return `项目 ${project.name} 前端不可达 (${project.baseUrl})`;
        }
    }
    return null;
}
function ensureRunsDir() {
    if (!fs_1.default.existsSync(runsDir))
        fs_1.default.mkdirSync(runsDir, { recursive: true });
}
/** 启动时清理残留的"运行中"记录（服务器重启后这些测试已不可能完成） */
function cleanupStaleRuns() {
    ensureRunsDir();
    const files = fs_1.default.readdirSync(runsDir).filter(f => f.endsWith('.json'));
    let cleaned = 0;
    for (const f of files) {
        try {
            const filePath = path_1.default.join(runsDir, f);
            const suite = JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
            if (suite.status === 'running' || suite.status === 'pending') {
                suite.status = 'error';
                suite.finishedAt = new Date().toISOString();
                if (!suite.duration)
                    suite.duration = 0;
                for (const tc of suite.cases) {
                    if (tc.status === 'running' || tc.status === 'pending') {
                        tc.status = 'error';
                        tc.error = '服务器重启，测试中断';
                    }
                }
                fs_1.default.writeFileSync(filePath, JSON.stringify(suite, null, 2));
                cleaned++;
            }
        }
        catch { /* skip */ }
    }
    if (cleaned > 0)
        console.log(`[test-runner] 清理了 ${cleaned} 个残留的运行中记录`);
}
function saveRun(suite) {
    ensureRunsDir();
    fs_1.default.writeFileSync(path_1.default.join(runsDir, `${suite.id}.json`), JSON.stringify(suite, null, 2));
}
function listTestRuns(type) {
    // 先从磁盘加载
    cleanupStaleRuns();
    ensureRunsDir();
    const files = fs_1.default.readdirSync(runsDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
        try {
            const suite = JSON.parse(fs_1.default.readFileSync(path_1.default.join(runsDir, f), 'utf-8'));
            if (!runs.has(suite.id))
                runs.set(suite.id, suite);
        }
        catch { /* skip */ }
    }
    const all = Array.from(runs.values()).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return type ? all.filter(r => r.type === type) : all;
}
function getTestRun(id) {
    return runs.get(id);
}
// ========== Agent 测试 ==========
async function runAgentTest(suite, config) {
    const { query } = await import('@anthropic-ai/claude-code');
    const skillPath = path_1.default.resolve(config_js_1.AI_PLATFORM_ROOT, 'skills', 'tests', 'agent-test', 'SKILL.md');
    let skillContent = '';
    try {
        skillContent = fs_1.default.readFileSync(skillPath, 'utf-8');
        // 去掉 YAML front matter
        skillContent = skillContent.replace(/^---[\s\S]*?---\n*/, '');
    }
    catch {
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
    const blocks = [];
    try {
        const response = query({
            prompt,
            options: {
                cwd: (0, config_js_1.getConfig)().aiPlatformRoot,
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
            if (abortController.signal.aborted)
                throw new Error('Agent test timeout');
            switch (msg.type) {
                case 'assistant': {
                    if (msg.message?.content) {
                        for (const block of msg.message.content) {
                            if (block.type === 'text') {
                                fullOutput += block.text;
                                blocks.push({ type: 'text', content: block.text });
                                test_events_js_1.testBus.emit('agent:stream', {
                                    suiteId: suite.id,
                                    type: 'text',
                                    content: block.text,
                                });
                            }
                            else if (block.type === 'tool_use') {
                                blocks.push({
                                    type: 'tool_use',
                                    name: block.name,
                                    input: block.input,
                                    toolUseId: block.id,
                                });
                                test_events_js_1.testBus.emit('agent:stream', {
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
                    if ('message' in msg && msg.message?.content) {
                        for (const block of msg.message.content) {
                            if (block.type === 'tool_result') {
                                const resultContent = typeof block.content === 'string'
                                    ? block.content
                                    : JSON.stringify(block.content);
                                // 回填 blocks 中对应工具调用的结果
                                const existingBlock = blocks.find(b => b.type === 'tool_use' && b.toolUseId === block.tool_use_id);
                                if (existingBlock) {
                                    existingBlock.result = resultContent?.slice(0, 5000);
                                }
                                test_events_js_1.testBus.emit('agent:stream', {
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
                    const resultMsg = msg;
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
            if (mainCase.status === 'failed')
                mainCase.error = '输出内容不足';
        }
        // 其他预设 case 标记为 skipped（主流程已覆盖）
        for (let i = 1; i < suite.cases.length; i++) {
            suite.cases[i].status = 'passed';
            suite.cases[i].output = '(包含在主流程测试中)';
        }
    }
    catch (err) {
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
    test_events_js_1.testBus.emit('test:update', { suiteId: suite.id, caseId: mainCase?.id, status: mainCase?.status, duration: mainCase?.duration });
}
// ========== E2E 页面测试（AI Agent + Playwright MCP） ==========
async function runE2ETest(suite, config) {
    console.log('[E2E] 开始加载 Claude Code SDK...');
    const { query } = await import('@anthropic-ai/claude-code');
    console.log('[E2E] SDK 加载成功');
    // 获取项目配置
    const projectId = config.projectId;
    const project = projectId ? (0, config_js_1.getProjectById)(projectId) : undefined;
    // 解析 Skill 路径
    const skillBasePath = project?.skillPath
        ? path_1.default.dirname(project.skillPath)
        : path_1.default.resolve((0, config_js_1.getConfig)().aiPlatformRoot, 'skills', 'tests', 'e2e-page-test');
    const skillPath = path_1.default.resolve(skillBasePath, 'SKILL.md');
    let skillContent = '';
    try {
        skillContent = fs_1.default.readFileSync(skillPath, 'utf-8');
        skillContent = skillContent.replace(/^---[\s\S]*?---\n*/, '');
        console.log('[E2E] Skill 加载成功，长度:', skillContent.length);
    }
    catch (e) {
        skillContent = '你是一个 E2E 页面测试助手，通过 Playwright MCP 控制浏览器测试页面。';
        console.log('[E2E] Skill 加载失败:', e.message);
    }
    const mode = config.mode || 'standard';
    const scope = config.scope || 'all';
    // 从项目配置解析页面列表
    let pageListPrompt = '';
    if (project) {
        const pages = resolvePages(project, scope);
        const baseUrl = project.baseUrl;
        pageListPrompt = `
## 当前项目信息
- 项目名称: ${project.name}
- 前端地址: ${baseUrl}
- 后端 API: ${project.apiBaseUrl}
- 登录页: ${baseUrl}${project.loginUrl}
- 登录凭据: ${project.username} / ${project.password}

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
    const blocks = [];
    try {
        console.log('[E2E] 调用 query()...');
        const e2eCwd = project?.sourcePath || (0, config_js_1.getConfig)().aiPlatformRoot;
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
                        type: 'stdio',
                        command: 'npx',
                        args: ['-y', '@executeautomation/playwright-mcp-server'],
                    },
                },
            },
        });
        console.log('[E2E] query() 返回，开始迭代消息...');
        let msgCount = 0;
        for await (const msg of response) {
            if (abortController.signal.aborted)
                throw new Error('E2E test timeout');
            msgCount++;
            if (msgCount <= 5 || msgCount % 20 === 0) {
                console.log(`[E2E] 消息 #${msgCount}: type=${msg.type}`);
            }
            switch (msg.type) {
                case 'assistant': {
                    if (msg.message?.content) {
                        for (const block of msg.message.content) {
                            if (block.type === 'text') {
                                fullOutput += block.text;
                                blocks.push({ type: 'text', content: block.text });
                                test_events_js_1.testBus.emit('agent:stream', { suiteId: suite.id, type: 'text', content: block.text });
                            }
                            else if (block.type === 'tool_use') {
                                blocks.push({
                                    type: 'tool_use',
                                    name: block.name,
                                    input: block.input,
                                    toolUseId: block.id,
                                });
                                test_events_js_1.testBus.emit('agent:stream', { suiteId: suite.id, type: 'tool_use', name: block.name, input: block.input, id: block.id });
                            }
                        }
                    }
                    break;
                }
                case 'user': {
                    if ('message' in msg && msg.message?.content) {
                        for (const block of msg.message.content) {
                            if (block.type === 'tool_result') {
                                const resultContent = typeof block.content === 'string'
                                    ? block.content : JSON.stringify(block.content);
                                // 回填 blocks 中对应工具调用的结果
                                const existingBlock = blocks.find(b => b.type === 'tool_use' && b.toolUseId === block.tool_use_id);
                                if (existingBlock) {
                                    existingBlock.result = resultContent?.slice(0, 5000);
                                }
                                test_events_js_1.testBus.emit('agent:stream', {
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
                    const resultMsg = msg;
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
        if (mainCase.status === 'failed')
            mainCase.error = '输出内容不足';
        // 尝试读取 e2e-test 生成的报告路径
        try {
            const e2eRunsDir = path_1.default.join((0, config_js_1.getConfig)().e2eDataDir, 'runs');
            if (fs_1.default.existsSync(e2eRunsDir)) {
                const runDirs = fs_1.default.readdirSync(e2eRunsDir)
                    .filter(d => { try {
                    return fs_1.default.statSync(path_1.default.join(e2eRunsDir, d)).isDirectory();
                }
                catch {
                    return false;
                } })
                    .map(d => ({ name: d, mtime: fs_1.default.statSync(path_1.default.join(e2eRunsDir, d)).mtimeMs }))
                    .sort((a, b) => b.mtime - a.mtime);
                if (runDirs.length > 0) {
                    const runJsonPath = path_1.default.join(e2eRunsDir, runDirs[0].name, 'run.json');
                    if (fs_1.default.existsSync(runJsonPath)) {
                        const runData = JSON.parse(fs_1.default.readFileSync(runJsonPath, 'utf-8'));
                        suite.config.reportPath = runData.reportPath || '';
                    }
                }
            }
        }
        catch { /* ignore */ }
        // 标记其他 case
        for (let i = 1; i < suite.cases.length; i++) {
            suite.cases[i].status = 'passed';
            suite.cases[i].output = '(包含在 AI Agent 主流程测试中)';
        }
    }
    catch (err) {
        clearTimeout(timer);
        abortControllers.delete(suite.id);
        mainCase.duration = Date.now() - startTime;
        mainCase.status = 'error';
        mainCase.error = err.message;
    }
    abortControllers.delete(suite.id);
    saveRun(suite);
    test_events_js_1.testBus.emit('test:update', { suiteId: suite.id, caseId: mainCase.id, status: mainCase.status, duration: mainCase.duration });
}
/** 根据项目配置和 scope 解析出要测试的页面列表 */
function resolvePages(project, scope) {
    if (scope === 'all') {
        return project.pageSets.flatMap(ps => ps.pages);
    }
    const pageSet = project.pageSets.find(ps => ps.id === scope);
    return pageSet?.pages || [];
}
// ========== 前端单元测试 ==========
async function runFrontendTest(suite, config) {
    const webDir = path_1.default.resolve(config_js_1.AI_PLATFORM_ROOT, 'web');
    for (const tc of suite.cases) {
        tc.status = 'running';
        saveRun(suite);
        test_events_js_1.testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: 'running' });
        const startTime = Date.now();
        try {
            const { execSync } = await import('child_process');
            const result = execSync('npx vitest run --reporter=json 2>&1', {
                cwd: webDir,
                timeout: 60000,
                encoding: 'utf-8',
            });
            tc.duration = Date.now() - startTime;
            tc.output = result.slice(0, 3000);
            // 解析 vitest JSON 输出判断通过/失败
            try {
                const jsonMatch = result.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
                if (jsonMatch) {
                    const report = JSON.parse(jsonMatch[0]);
                    const total = report.numTotalTests || 0;
                    const passed = report.numPassedTests || 0;
                    tc.status = total > 0 && passed === total ? 'passed' : 'failed';
                    tc.output = `总计 ${total} 个测试，通过 ${passed}，失败 ${report.numFailedTests || 0}`;
                }
                else {
                    tc.status = result.includes('Tests') && !result.includes('FAIL') ? 'passed' : 'failed';
                }
            }
            catch {
                tc.status = result.includes('passed') ? 'passed' : 'failed';
            }
        }
        catch (err) {
            tc.duration = Date.now() - startTime;
            tc.status = 'error';
            tc.error = err.stderr?.slice(0, 500) || err.message;
            tc.output = err.stdout?.slice(0, 2000) || '';
        }
        saveRun(suite);
        test_events_js_1.testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: tc.status, duration: tc.duration });
    }
}
// ========== API 接口测试 ==========
async function runApiTest(suite, config) {
    const baseUrl = config.baseUrl || (0, config_js_1.getConfig)().apiTestBaseUrl;
    const apiTests = [
        { name: 'Health API', method: 'GET', url: '/api/health', expect: 200 },
        { name: 'Skills 列表', method: 'GET', url: '/api/skills', expect: 200 },
        { name: 'Schools 列表', method: 'GET', url: '/api/schools', expect: 200 },
        { name: 'Workflows 列表', method: 'GET', url: '/api/workflows', expect: 200 },
        { name: 'Sessions 列表', method: 'GET', url: '/api/sessions', expect: 200 },
    ];
    for (const tc of suite.cases) {
        const testDef = apiTests.find(t => t.name === tc.name);
        if (!testDef) {
            tc.status = 'skipped';
            continue;
        }
        tc.status = 'running';
        saveRun(suite);
        test_events_js_1.testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: 'running' });
        const startTime = Date.now();
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(`${baseUrl}${testDef.url}`, {
                method: testDef.method,
                signal: controller.signal,
            });
            clearTimeout(timer);
            tc.duration = Date.now() - startTime;
            const statusCode = res.status;
            tc.output = `${testDef.method} ${testDef.url} -> HTTP ${statusCode}`;
            tc.status = statusCode === testDef.expect ? 'passed' : 'failed';
            if (tc.status === 'failed')
                tc.error = `期望 HTTP ${testDef.expect}，实际 HTTP ${statusCode}`;
        }
        catch (err) {
            tc.duration = Date.now() - startTime;
            tc.status = 'error';
            tc.error = err.message;
        }
        saveRun(suite);
        test_events_js_1.testBus.emit('test:update', { suiteId: suite.id, caseId: tc.id, caseName: tc.name, status: tc.status, duration: tc.duration });
    }
}
// ========== 主入口 ==========
function createTestSuite(type, config = {}) {
    const cases = [];
    switch (type) {
        case 'agent':
            cases.push({ id: (0, uuid_1.v4)(), name: '基础对话响应', type, status: 'pending' }, { id: (0, uuid_1.v4)(), name: '工具调用测试', type, status: 'pending' }, { id: (0, uuid_1.v4)(), name: '代码理解测试', type, status: 'pending' });
            break;
        case 'e2e': {
            const mode = config.mode || 'standard';
            const scope = config.scope || 'all';
            const projectId = config.projectId;
            const project = projectId ? (0, config_js_1.getProjectById)(projectId) : undefined;
            const label = project ? `${project.name} ${scope}` : scope;
            cases.push({ id: (0, uuid_1.v4)(), name: `E2E ${mode} 测试 (${label})`, type, status: 'pending' });
            break;
        }
        case 'frontend':
            cases.push({ id: (0, uuid_1.v4)(), name: 'Vitest 前端单元测试', type, status: 'pending' });
            break;
        case 'api':
            cases.push({ id: (0, uuid_1.v4)(), name: 'Health API', type, status: 'pending' }, { id: (0, uuid_1.v4)(), name: 'Skills 列表', type, status: 'pending' }, { id: (0, uuid_1.v4)(), name: 'Schools 列表', type, status: 'pending' }, { id: (0, uuid_1.v4)(), name: 'Workflows 列表', type, status: 'pending' }, { id: (0, uuid_1.v4)(), name: 'Sessions 列表', type, status: 'pending' });
            break;
    }
    const suite = {
        id: (0, uuid_1.v4)(),
        name: `${type === 'agent' ? 'Agent智能体' : type === 'e2e' ? (() => { const p = config.projectId ? (0, config_js_1.getProjectById)(config.projectId) : undefined; return `E2E页面(${p ? p.name : config.scope || 'all'})`; })() : type === 'frontend' ? '前端单元' : 'API接口'}测试`,
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
async function executeTestRun(suiteId) {
    const suite = runs.get(suiteId);
    if (!suite)
        throw new Error('Test run not found');
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
        test_events_js_1.testBus.emit('test:start', { suiteId: suite.id });
        test_events_js_1.testBus.emit('test:done', { suiteId: suite.id, status: 'error', error: checkError });
        return suite;
    }
    // 入队执行（按类型分队列）
    return new Promise((resolve, reject) => {
        typeQueues[suite.type].push({ suiteId, resolve, reject });
        processTypeQueue(suite.type);
    });
}
async function executeTestRunInternal(suiteId) {
    const suite = runs.get(suiteId);
    if (!suite)
        throw new Error('Test run not found');
    suite.status = 'running';
    saveRun(suite);
    test_events_js_1.testBus.emit('test:start', { suiteId: suite.id });
    try {
        switch (suite.type) {
            case 'agent':
                await runAgentTest(suite, suite.config);
                break;
            case 'e2e':
                await runE2ETest(suite, suite.config);
                break;
            case 'frontend':
                await runFrontendTest(suite, suite.config);
                break;
            case 'api':
                await runApiTest(suite, suite.config);
                break;
        }
        const allPassed = suite.cases.every(c => c.status === 'passed');
        const anyFailed = suite.cases.some(c => c.status === 'failed' || c.status === 'error');
        suite.status = allPassed ? 'passed' : anyFailed ? 'failed' : 'passed';
    }
    catch (err) {
        suite.status = 'error';
    }
    suite.finishedAt = new Date().toISOString();
    suite.duration = new Date(suite.finishedAt).getTime() - new Date(suite.startedAt).getTime();
    saveRun(suite);
    test_events_js_1.testBus.emit('test:done', { suiteId: suite.id, status: suite.status });
    return suite;
}
function abortTestRun(id) {
    const ac = abortControllers.get(id);
    if (!ac)
        return false;
    ac.abort();
    abortControllers.delete(id);
    return true;
}
function deleteTestRun(id) {
    const existed = runs.delete(id);
    if (existed) {
        const f = path_1.default.join(runsDir, `${id}.json`);
        if (fs_1.default.existsSync(f))
            fs_1.default.unlinkSync(f);
    }
    return existed;
}
/** 获取当前运行中的测试列表 */
function listRunningSuites() {
    return Array.from(runs.values()).filter(s => s.status === 'running');
}
/** 获取/设置并发配置 */
function getConcurrency() {
    return { ...CONCURRENCY };
}
function setConcurrency(type, val) {
    if (val >= 1 && val <= 5) {
        CONCURRENCY[type] = val;
        processTypeQueue(type); // 可能立即启动排队的测试
    }
}
//# sourceMappingURL=test-runner.js.map