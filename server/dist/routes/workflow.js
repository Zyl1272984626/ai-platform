"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflowRouter = void 0;
/**
 * 工作流路由（v2）
 *
 * 新增：resume（断点恢复）、abort（中止）、confirm（确认继续）
 */
const express_1 = require("express");
const events_1 = require("events");
const workflow_engine_js_1 = require("../services/workflow-engine.js");
exports.workflowRouter = (0, express_1.Router)();
// 工作流模板列表
exports.workflowRouter.get('/', (_req, res) => {
    const definitions = (0, workflow_engine_js_1.loadWorkflowDefinitions)();
    res.json(definitions.map((d) => ({
        name: d.name,
        description: d.description,
        trigger: d.trigger,
        stepCount: d.steps.length,
    })));
});
// 触发执行
exports.workflowRouter.post('/:name/run', (req, res) => {
    const { name } = req.params;
    const params = req.body || {};
    try {
        const emitter = new events_1.EventEmitter();
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        const run = (0, workflow_engine_js_1.startWorkflow)(name, params, emitter);
        // 推送初始状态
        res.write(`data: ${JSON.stringify({ type: 'workflow:start', runId: run.id })}\n\n`);
        // 心跳（保持连接）
        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 15000);
        const eventTypes = [
            'step:start', 'step:stream', 'step:done',
            'step:retry', 'step:skip', 'step:waiting',
            'workflow:done', 'workflow:failed', 'workflow:error',
        ];
        for (const type of eventTypes) {
            emitter.on(type, (data) => {
                res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
            });
        }
        const cleanup = () => {
            clearInterval(heartbeat);
            if (!res.writableEnded)
                res.end();
        };
        emitter.on('workflow:done', cleanup);
        emitter.on('workflow:failed', cleanup);
        emitter.on('workflow:error', cleanup);
        req.on('close', cleanup);
    }
    catch (err) {
        if (!res.headersSent) {
            res.status(400).json({ error: err.message });
        }
    }
});
// 运行历史
exports.workflowRouter.get('/runs', (_req, res) => {
    res.json((0, workflow_engine_js_1.listWorkflowRuns)());
});
// 单次运行详情
exports.workflowRouter.get('/runs/:runId', (req, res) => {
    const run = (0, workflow_engine_js_1.getWorkflowRun)(req.params.runId);
    if (!run)
        return res.status(404).json({ error: 'Run not found' });
    res.json(run);
});
// 断点恢复
exports.workflowRouter.post('/runs/:runId/resume', (req, res) => {
    try {
        const emitter = new events_1.EventEmitter();
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        const run = (0, workflow_engine_js_1.resumeWorkflow)(req.params.runId, emitter);
        res.write(`data: ${JSON.stringify({ type: 'workflow:resumed', runId: run.id })}\n\n`);
        emitter.on('step:start', (data) => res.write(`data: ${JSON.stringify({ type: 'step:start', ...data })}\n\n`));
        emitter.on('step:done', (data) => res.write(`data: ${JSON.stringify({ type: 'step:done', ...data })}\n\n`));
        emitter.on('workflow:done', (data) => { res.write(`data: ${JSON.stringify({ type: 'workflow:done', ...data })}\n\n`); res.end(); });
        emitter.on('workflow:failed', (data) => { res.write(`data: ${JSON.stringify({ type: 'workflow:failed', ...data })}\n\n`); res.end(); });
    }
    catch (err) {
        if (!res.headersSent)
            res.status(400).json({ error: err.message });
    }
});
// 确认继续
exports.workflowRouter.post('/runs/:runId/confirm', (req, res) => {
    try {
        (0, workflow_engine_js_1.confirmStep)(req.params.runId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// 中止
exports.workflowRouter.post('/runs/:runId/abort', (req, res) => {
    (0, workflow_engine_js_1.abortWorkflow)(req.params.runId);
    res.json({ ok: true });
});
//# sourceMappingURL=workflow.js.map