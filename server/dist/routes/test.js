"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testRouter = void 0;
/**
 * 测试路由
 */
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const test_runner_js_1 = require("../services/test-runner.js");
const test_events_js_1 = require("../services/test-events.js");
exports.testRouter = (0, express_1.Router)();
// 测试类型列表（前端用）
exports.testRouter.get('/types', (_req, res) => {
    res.json([
        { type: 'agent', name: 'Agent 智能体测试', description: '测试 AI Agent 的对话响应、工具调用、代码理解能力', icon: '🤖' },
        { type: 'e2e', name: 'E2E 页面测试', description: 'Playwright 真实浏览器测试，覆盖主系统88个页面，支持 quick/standard/deep 三种模式', icon: '🌐' },
        { type: 'frontend', name: '前端单元测试', description: '运行 vitest 前端测试用例，收集通过率', icon: '🧪' },
        { type: 'api', name: 'API 接口测试', description: '自动检测所有后端 API 端点的可用性和响应状态', icon: '🔌' },
    ]);
});
// 列出测试记录
exports.testRouter.get('/runs', (req, res) => {
    const type = req.query.type;
    res.json((0, test_runner_js_1.listTestRuns)(type));
});
// 单条记录
exports.testRouter.get('/runs/:id', (req, res) => {
    const run = (0, test_runner_js_1.getTestRun)(req.params.id);
    if (!run)
        return res.status(404).json({ error: 'Run not found' });
    res.json(run);
});
// 创建并执行测试（返回 JSON，SSE 通过 /runs/:id/stream 订阅）
exports.testRouter.post('/run', (req, res) => {
    const { type, config } = req.body;
    if (!type)
        return res.status(400).json({ error: 'type is required' });
    try {
        const suite = (0, test_runner_js_1.createTestSuite)(type, config);
        // Fire-and-forget 执行（事件通过 testBus 广播）
        (0, test_runner_js_1.executeTestRun)(suite.id).catch((err) => {
            test_events_js_1.testBus.emit('test:error', { suiteId: suite.id, error: err.message });
        });
        res.json({ suiteId: suite.id });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// SSE 订阅某个测试运行的实时事件
exports.testRouter.get('/runs/:id/stream', (req, res) => {
    const suiteId = req.params.id;
    const suite = (0, test_runner_js_1.getTestRun)(suiteId);
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
    test_events_js_1.testBus.on('test:start', onTestStart);
    test_events_js_1.testBus.on('test:update', onTestUpdate);
    test_events_js_1.testBus.on('agent:stream', onAgentStream);
    test_events_js_1.testBus.on('test:done', onDone);
    test_events_js_1.testBus.on('test:error', onTestError);
    // 心跳保活
    const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
            res.write(': heartbeat\n\n');
        }
    }, 15000);
    // 客户端断开时清理
    req.on('close', () => {
        clearInterval(heartbeat);
        test_events_js_1.testBus.off('test:start', onTestStart);
        test_events_js_1.testBus.off('test:update', onTestUpdate);
        test_events_js_1.testBus.off('agent:stream', onAgentStream);
        test_events_js_1.testBus.off('test:done', onDone);
        test_events_js_1.testBus.off('test:error', onTestError);
    });
});
// 列出当前运行中的测试
exports.testRouter.get('/running', (_req, res) => {
    res.json((0, test_runner_js_1.listRunningSuites)());
});
// 获取/设置并发配置
exports.testRouter.get('/concurrency', (_req, res) => {
    res.json((0, test_runner_js_1.getConcurrency)());
});
exports.testRouter.post('/concurrency', (req, res) => {
    const { type, value } = req.body;
    if (!type || typeof value !== 'number') {
        return res.status(400).json({ error: 'type and value(number) are required' });
    }
    (0, test_runner_js_1.setConcurrency)(type, value);
    res.json((0, test_runner_js_1.getConcurrency)());
});
// 中断正在运行的测试
exports.testRouter.post('/runs/:id/abort', (req, res) => {
    const ok = (0, test_runner_js_1.abortTestRun)(req.params.id);
    res.json({ ok });
});
// 获取 E2E 测试报告（HTML）
exports.testRouter.get('/runs/:id/report', (req, res) => {
    const run = (0, test_runner_js_1.getTestRun)(req.params.id);
    if (!run)
        return res.status(404).json({ error: 'Run not found' });
    const reportPath = run.config?.reportPath;
    if (!reportPath)
        return res.status(404).json({ error: '报告未生成' });
    if (!fs_1.default.existsSync(reportPath))
        return res.status(404).json({ error: '报告文件不存在' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(reportPath);
});
// 删除测试记录
exports.testRouter.delete('/runs/:id', (req, res) => {
    const ok = (0, test_runner_js_1.deleteTestRun)(req.params.id);
    res.json({ ok });
});
//# sourceMappingURL=test.js.map