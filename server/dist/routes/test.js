/**
 * 测试路由
 */
<<<<<<< Updated upstream
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const test_runner_js_1 = require("../services/test-runner.js");
const test_events_js_1 = require("../services/test-events.js");
exports.testRouter = (0, express_1.Router)();
=======
import { Router } from 'express';
import fs from 'fs';
import { createTestSuite, executeTestRun, listTestRuns, getTestRun, deleteTestRun, abortTestRun, listRunningSuites, getConcurrency, setConcurrency, } from '../services/test-runner.js';
import { testBus } from '../services/test-events.js';
export const testRouter = Router();
>>>>>>> Stashed changes
// 测试类型列表（前端用）
testRouter.get('/types', (_req, res) => {
    res.json([
        { type: 'agent', name: 'Agent 智能体测试', description: '测试 AI Agent 的对话响应、工具调用、代码理解能力', icon: '🤖' },
        { type: 'e2e', name: 'E2E 页面测试', description: 'Playwright 真实浏览器测试，覆盖主系统88个页面，支持 quick/standard/deep 三种模式', icon: '🌐' },
        { type: 'frontend', name: '前端单元测试', description: 'Claude Code 发现可测试单元，生成 vitest 测试用例并执行', icon: '🧪' },
        { type: 'api', name: 'API 接口测试', description: 'Claude Code 扫描源码发现接口，自动生成测试用例并验证响应', icon: '🔌' },
        { type: 'codereview', name: '代码审查', description: 'Claude Code 扫描源码，按安全/性能/规范等维度生成审查报告', icon: '🔍' },
    ]);
});
// 列出测试记录
testRouter.get('/runs', (req, res) => {
    const type = req.query.type;
    res.json(listTestRuns(type));
});
// 单条记录
testRouter.get('/runs/:id', (req, res) => {
    const run = getTestRun(req.params.id);
    if (!run)
        return res.status(404).json({ error: 'Run not found' });
    res.json(run);
});
// 生成提示词（供前端复制到 Claude Code 手动执行）
exports.testRouter.post('/generate-prompt', (req, res) => {
    const { type, config } = req.body;
    if (!type)
        return res.status(400).json({ error: 'type is required' });
    try {
        const result = (0, test_runner_js_1.generateTestPrompt)(type, config || {});
        res.json(result);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// 注册手动执行产生的报告（让测试页面可见）
exports.testRouter.post('/register-manual-report', (req, res) => {
    const { type, projectId, projectName, reportPath } = req.body;
    if (!reportPath)
        return res.status(400).json({ error: 'reportPath is required' });
    try {
        const suiteId = (0, test_runner_js_1.registerManualReport)({ type, projectId, projectName, reportPath });
        res.json({ ok: true, suiteId });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// 用固定模板将 Markdown 审查报告转为 HTML（保持平台统一风格）
exports.testRouter.post('/build-review-html', (req, res) => {
    const { markdownPath, htmlPath, projectName } = req.body;
    if (!markdownPath || !htmlPath || !projectName) {
        return res.status(400).json({ error: 'markdownPath, htmlPath, projectName are required' });
    }
    try {
        if (!fs_1.default.existsSync(markdownPath)) {
            return res.status(400).json({ error: `Markdown 文件不存在: ${markdownPath}` });
        }
        const markdown = fs_1.default.readFileSync(markdownPath, 'utf-8');
        if (markdown.length < 50) {
            return res.status(400).json({ error: 'Markdown 内容不足' });
        }
        const html = (0, test_runner_js_1.buildReviewHtml)(projectName, markdown, 0);
        const htmlDir = path_1.default.dirname(htmlPath);
        if (!fs_1.default.existsSync(htmlDir))
            fs_1.default.mkdirSync(htmlDir, { recursive: true });
        fs_1.default.writeFileSync(htmlPath, html, 'utf-8');
        res.json({ ok: true, htmlPath, size: html.length });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// 扫描报告目录，返回所有 HTML/MD 文件
exports.testRouter.get('/codereview/report-files', (req, res) => {
    const projectId = req.query.projectId;
    if (!projectId)
        return res.status(400).json({ error: 'projectId is required' });
    try {
        const result = (0, test_runner_js_1.listReportFiles)(projectId);
        res.json(result);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// 从选中的 MD 文件合并生成 HTML 报告
exports.testRouter.post('/codereview/build-from-files', (req, res) => {
    const { projectId, mdFiles } = req.body;
    if (!projectId || !Array.isArray(mdFiles) || mdFiles.length === 0) {
        return res.status(400).json({ error: 'projectId and mdFiles[] are required' });
    }
    try {
        const result = (0, test_runner_js_1.buildHtmlFromMdFiles)(projectId, mdFiles);
        res.json(result);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// 创建并执行测试（返回 JSON，SSE 通过 /runs/:id/stream 订阅）
testRouter.post('/run', (req, res) => {
    const { type, config } = req.body;
    if (!type)
        return res.status(400).json({ error: 'type is required' });
    try {
        const suite = createTestSuite(type, config);
        // Fire-and-forget 执行（事件通过 testBus 广播）
        executeTestRun(suite.id).catch((err) => {
            testBus.emit('test:error', { suiteId: suite.id, error: err.message });
        });
        res.json({ suiteId: suite.id });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// SSE 订阅某个测试运行的实时事件
testRouter.get('/runs/:id/stream', (req, res) => {
    const suiteId = req.params.id;
    const suite = getTestRun(suiteId);
    if (!suite)
        return res.status(404).json({ error: 'Run not found' });
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    // 如果已完成，直接返回最终状态
    if (suite.status !== 'running' && suite.status !== 'pending') {
        res.write(`data: ${JSON.stringify({ event: 'test:done', suiteId, status: suite.status })}\n\n`);
        res.end();
        return;
    }
    // 事件处理函数
    function onEvent(eventName, data) {
        if (data.suiteId !== suiteId)
            return;
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ event: eventName, ...data })}\n\n`);
            if (typeof res.flush === 'function')
                res.flush();
        }
    }
    function onDone(data) {
        if (data.suiteId !== suiteId)
            return;
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ event: 'test:done', ...data })}\n\n`);
            res.end();
        }
    }
    // 订阅事件总线
    const onTestStart = (d) => onEvent('test:start', d);
    const onTestUpdate = (d) => onEvent('test:update', d);
    const onAgentStream = (d) => onEvent('agent:stream', d);
    const onTestError = (d) => onEvent('test:error', d);
<<<<<<< Updated upstream
    const onTestResumed = (d) => onEvent('test:resumed', d);
    const onAgentChat = (d) => onEvent('agent:chat', d);
    test_events_js_1.testBus.on('test:start', onTestStart);
    test_events_js_1.testBus.on('test:update', onTestUpdate);
    test_events_js_1.testBus.on('agent:stream', onAgentStream);
    test_events_js_1.testBus.on('test:done', onDone);
    test_events_js_1.testBus.on('test:error', onTestError);
    test_events_js_1.testBus.on('test:resumed', onTestResumed);
    test_events_js_1.testBus.on('agent:chat', onAgentChat);
=======
    testBus.on('test:start', onTestStart);
    testBus.on('test:update', onTestUpdate);
    testBus.on('agent:stream', onAgentStream);
    testBus.on('test:done', onDone);
    testBus.on('test:error', onTestError);
>>>>>>> Stashed changes
    // 心跳保活
    const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
            res.write(': heartbeat\n\n');
        }
    }, 15000);
    // 客户端断开时清理
    req.on('close', () => {
        clearInterval(heartbeat);
<<<<<<< Updated upstream
        test_events_js_1.testBus.off('test:start', onTestStart);
        test_events_js_1.testBus.off('test:update', onTestUpdate);
        test_events_js_1.testBus.off('agent:stream', onAgentStream);
        test_events_js_1.testBus.off('test:done', onDone);
        test_events_js_1.testBus.off('test:error', onTestError);
        test_events_js_1.testBus.off('test:resumed', onTestResumed);
        test_events_js_1.testBus.off('agent:chat', onAgentChat);
=======
        testBus.off('test:start', onTestStart);
        testBus.off('test:update', onTestUpdate);
        testBus.off('agent:stream', onAgentStream);
        testBus.off('test:done', onDone);
        testBus.off('test:error', onTestError);
>>>>>>> Stashed changes
    });
});
// 列出当前运行中的测试
testRouter.get('/running', (_req, res) => {
    res.json(listRunningSuites());
});
// 获取/设置并发配置
testRouter.get('/concurrency', (_req, res) => {
    res.json(getConcurrency());
});
testRouter.post('/concurrency', (req, res) => {
    const { type, value } = req.body;
    if (!type || typeof value !== 'number') {
        return res.status(400).json({ error: 'type and value(number) are required' });
    }
    setConcurrency(type, value);
    res.json(getConcurrency());
});
// 中断正在运行的测试
testRouter.post('/runs/:id/abort', (req, res) => {
    const ok = abortTestRun(req.params.id);
    res.json({ ok });
});
// 恢复中断的代码审查
exports.testRouter.post('/runs/:id/resume', async (req, res) => {
    try {
        const suiteId = await (0, test_runner_js_1.resumeTestRun)(req.params.id);
        // 启动执行
        (0, test_runner_js_1.executeTestRun)(suiteId).catch((err) => {
            test_events_js_1.testBus.emit('test:error', { suiteId, error: err.message });
        });
        res.json({ suiteId });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// 人工对话（基于审查上下文）
exports.testRouter.post('/runs/:id/chat', async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required' });
    }
    try {
        const chatSuiteId = await (0, test_runner_js_1.chatWithReview)(req.params.id, message);
        res.json({ suiteId: chatSuiteId });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// 获取 E2E 测试报告（HTML）
testRouter.get('/runs/:id/report', (req, res) => {
    const run = getTestRun(req.params.id);
    if (!run)
        return res.status(404).json({ error: 'Run not found' });
    const reportPath = run.config?.reportPath;
    if (!reportPath)
        return res.status(404).json({ error: '报告未生成' });
    if (!fs.existsSync(reportPath))
        return res.status(404).json({ error: '报告文件不存在' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(reportPath);
});
// 删除测试记录
testRouter.delete('/runs/:id', (req, res) => {
    const ok = deleteTestRun(req.params.id);
    res.json({ ok });
});
//# sourceMappingURL=test.js.map