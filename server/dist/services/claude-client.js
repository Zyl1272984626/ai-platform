// 动态加载 claude-code，避免启动时阻塞
let _query = null;
async function getClaudeQuery() {
    if (!_query) {
        const mod = await import('@anthropic-ai/claude-code');
        _query = mod.query;
    }
    return _query;
}
// ========== 自动审批工具白名单 ==========
const AUTO_APPROVED_TOOLS = [
    'Read', 'Write', 'Edit', 'MultiEdit',
    'Glob', 'Grep', 'Bash',
    'WebSearch', 'WebFetch', 'NotebookEdit',
    'mcp__mcp_server_mysql__mysql_query',
    'mcp__web_reader__webReader',
    'mcp__4_5v_mcp__analyze_image',
];
// ========== 会话管理 ==========
const sessions = new Map();
export function createSession(id, config) {
    const mergedTools = [...new Set([...AUTO_APPROVED_TOOLS, ...(config.allowedTools || [])])];
    const session = {
        id,
        config: { ...config, allowedTools: mergedTools },
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'idle',
    };
    sessions.set(id, session);
    return session;
}
export function getSession(id) {
    return sessions.get(id);
}
export function listSessions() {
    return Array.from(sessions.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
export function deleteSession(id) {
    return sessions.delete(id);
}
// ========== 核心消息发送 ==========
/**
 * 发送消息并流式返回事件
 *
 * 关键自动化配置：
 * - permissionMode: 'bypassPermissions' — 完全自动，不暂停
 * - allowedTools: 预授权工具列表
 * - maxTurns: 50 — 允许多轮工具调用
 */
export async function sendMessage(sessionId, message, emitter) {
    const session = sessions.get(sessionId);
    if (!session) {
        emitter.emit('event', { type: 'error', content: 'Session not found' });
        emitter.emit('close');
        return;
    }
    session.messages.push({ role: 'user', content: message });
    session.status = 'active';
    session.updatedAt = new Date().toISOString();
    const maxTurns = session.config.maxTurns || 9999;
    try {
        const abortController = new AbortController();
        // 无超时限制，让 Claude Code 自然完成
        const timer = setTimeout(() => { }, 0);
        // 调用 Agent SDK
        const query = await getClaudeQuery();
        const response = query({
            prompt: message,
            options: {
                cwd: session.config.cwd,
                allowedTools: session.config.allowedTools,
                maxTurns,
                // 关键：bypassPermissions 让所有工具调用自动通过
                permissionMode: 'bypassPermissions',
                abortController,
                appendSystemPrompt: session.config.systemPrompt,
            },
        });
        let assistantText = '';
        for await (const msg of response) {
            if (abortController.signal.aborted) {
                throw new Error('Total timeout exceeded');
            }
            switch (msg.type) {
                case 'system': {
                    const sysMsg = msg;
                    emitter.emit('event', {
                        type: 'system',
                        content: `Session initialized: model=${sysMsg.model}, tools=${sysMsg.tools?.length || 0}`,
                        metadata: { model: sysMsg.model, permissionMode: sysMsg.permissionMode },
                    });
                    break;
                }
                case 'assistant': {
                    const asstMsg = msg;
                    if (asstMsg.message?.content) {
                        for (const block of asstMsg.message.content) {
                            if (block.type === 'text') {
                                assistantText += block.text;
                                emitter.emit('event', { type: 'text', content: block.text });
                            }
                            else if (block.type === 'tool_use') {
                                emitter.emit('event', {
                                    type: 'tool_use',
                                    content: block.name,
                                    metadata: { input: block.input, id: block.id },
                                });
                            }
                        }
                    }
                    break;
                }
                case 'user': {
                    // 工具执行结果作为 user message 回传
                    // Claude Code 会把 tool_result 包装在 user message 的 content blocks 中
                    if ('message' in msg && msg.message?.content) {
                        for (const block of msg.message.content) {
                            if (block.type === 'tool_result') {
                                const resultContent = typeof block.content === 'string'
                                    ? block.content
                                    : JSON.stringify(block.content);
                                emitter.emit('event', {
                                    type: 'tool_result',
                                    content: resultContent,
                                    metadata: { toolUseId: block.tool_use_id },
                                });
                            }
                        }
                    }
                    break;
                }
                case 'result': {
                    const resultMsg = msg;
                    if (resultMsg.subtype === 'success' && resultMsg.result) {
                        // 如果还没有收集到文本，用 result 的文本
                        if (!assistantText) {
                            assistantText = resultMsg.result;
                            emitter.emit('event', { type: 'text', content: resultMsg.result });
                        }
                    }
                    if (resultMsg.subtype !== 'success') {
                        emitter.emit('event', {
                            type: 'progress',
                            content: `Result: subtype=${resultMsg.subtype}, turns=${resultMsg.num_turns}, cost=$${resultMsg.total_cost_usd?.toFixed(4) || '0'}`,
                        });
                    }
                    break;
                }
                case 'stream_event': {
                    // 部分消息（如果启用 includePartialMessages）
                    // 暂不处理
                    break;
                }
            }
        }
        clearTimeout(timer);
        if (assistantText) {
            session.messages.push({ role: 'assistant', content: assistantText });
        }
        session.status = 'idle';
        session.updatedAt = new Date().toISOString();
        emitter.emit('event', { type: 'done', content: '' });
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        session.status = 'error';
        session.updatedAt = new Date().toISOString();
        emitter.emit('event', { type: 'error', content: errorMsg });
    }
    finally {
        emitter.emit('close');
    }
}
/**
 * 执行工作流单步（无会话，独立调用）
 */
export async function executeStep(prompt, config, emitter) {
    const mergedTools = [...new Set([...AUTO_APPROVED_TOOLS, ...(config.allowedTools || [])])];
    const timeout = config.timeout || 0; // 0 表示无限制
    const abortController = new AbortController();
    // 无超时限制，让 Claude Code 自然完成
    const timer = setTimeout(() => { }, 0);
    try {
        const query = await getClaudeQuery();
        const response = query({
            prompt,
            options: {
                cwd: config.cwd,
                allowedTools: mergedTools,
                maxTurns: config.maxTurns || 9999,
                permissionMode: 'bypassPermissions',
                abortController,
            },
        });
        let output = '';
        let toolCalls = 0;
        for await (const msg of response) {
            if (abortController.signal.aborted)
                throw new Error('Step timeout exceeded');
            switch (msg.type) {
                case 'assistant': {
                    const asstMsg = msg;
                    if (asstMsg.message?.content) {
                        for (const block of asstMsg.message.content) {
                            if (block.type === 'text') {
                                output += block.text;
                                emitter?.emit('event', { type: 'text', content: block.text });
                            }
                            else if (block.type === 'tool_use') {
                                toolCalls++;
                                emitter?.emit('event', {
                                    type: 'tool_use',
                                    content: block.name,
                                    metadata: { input: block.input },
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
                                emitter?.emit('event', {
                                    type: 'tool_result',
                                    content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                                });
                            }
                        }
                    }
                    break;
                }
                case 'result': {
                    const resultMsg = msg;
                    if (resultMsg.subtype === 'success' && resultMsg.result && !output) {
                        output = resultMsg.result;
                    }
                    break;
                }
            }
        }
        clearTimeout(timer);
        return { output, metadata: { toolCalls } };
    }
    catch (err) {
        clearTimeout(timer);
        throw err;
    }
}
//# sourceMappingURL=claude-client.js.map