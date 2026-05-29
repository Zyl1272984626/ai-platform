"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionRouter = void 0;
/**
 * 会话管理路由
 */
const express_1 = require("express");
const uuid_1 = require("uuid");
const claude_client_js_1 = require("../services/claude-client.js");
const config_js_1 = require("../services/config.js");
exports.sessionRouter = (0, express_1.Router)();
// 创建会话
exports.sessionRouter.post('/', (req, res) => {
    const { systemPrompt, allowedTools, cwd } = req.body;
    const id = (0, uuid_1.v4)();
    const session = (0, claude_client_js_1.createSession)(id, {
        cwd: cwd || config_js_1.PROJECT_ROOT,
        systemPrompt,
        allowedTools,
    });
    res.status(201).json(session);
});
// 列出会话
exports.sessionRouter.get('/', (_req, res) => {
    res.json((0, claude_client_js_1.listSessions)());
});
// 获取会话详情
exports.sessionRouter.get('/:id', (req, res) => {
    const session = (0, claude_client_js_1.getSession)(req.params.id);
    if (!session)
        return res.status(404).json({ error: 'Session not found' });
    res.json(session);
});
// 发送消息（SSE 流式返回）
exports.sessionRouter.post('/:id/messages', async (req, res) => {
    const { message } = req.body;
    if (!message)
        return res.status(400).json({ error: 'message is required' });
    const session = (0, claude_client_js_1.getSession)(req.params.id);
    if (!session)
        return res.status(404).json({ error: 'Session not found' });
    // SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const { EventEmitter } = await import('events');
    const emitter = new EventEmitter();
    emitter.on('event', (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        // 强制 flush，避免 Express/Node 缓冲 SSE 数据
        if (typeof res.flush === 'function') {
            res.flush();
        }
    });
    emitter.on('close', () => {
        res.end();
    });
    await (0, claude_client_js_1.sendMessage)(req.params.id, message, emitter);
});
// 删除会话
exports.sessionRouter.delete('/:id', (req, res) => {
    const deleted = (0, claude_client_js_1.deleteSession)(req.params.id);
    if (!deleted)
        return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true });
});
//# sourceMappingURL=session.js.map