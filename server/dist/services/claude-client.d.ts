/**
 * Claude Code Agent SDK 客户端（v3）
 *
 * 基于 @anthropic-ai/claude-code v1.0.x 实际类型
 *
 * 核心：
 * - permissionMode: 'bypassPermissions' 实现全自动（无需确认）
 * - allowedTools 预授权工具列表
 * - 正确解析 SDKMessage 的 5 种类型
 *
 * 性能：使用动态 import 避免启动时加载 75MB 的 claude-code 包
 */
import { EventEmitter } from 'events';
export interface StreamEvent {
    type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'error' | 'done' | 'system' | 'progress';
    content: string;
    metadata?: Record<string, unknown>;
}
export interface SessionConfig {
    cwd: string;
    systemPrompt?: string;
    allowedTools?: string[];
    maxTurns?: number;
    stepTimeout?: number;
    totalTimeout?: number;
}
export interface Session {
    id: string;
    config: SessionConfig;
    messages: Array<{
        role: 'user' | 'assistant';
        content: string;
    }>;
    createdAt: string;
    updatedAt: string;
    status: 'active' | 'idle' | 'error';
}
export declare function createSession(id: string, config: SessionConfig): Session;
export declare function getSession(id: string): Session | undefined;
export declare function listSessions(): Session[];
export declare function deleteSession(id: string): boolean;
/**
 * 发送消息并流式返回事件
 *
 * 关键自动化配置：
 * - permissionMode: 'bypassPermissions' — 完全自动，不暂停
 * - allowedTools: 预授权工具列表
 * - maxTurns: 50 — 允许多轮工具调用
 */
export declare function sendMessage(sessionId: string, message: string, emitter: EventEmitter): Promise<void>;
/**
 * 执行工作流单步（无会话，独立调用）
 */
export declare function executeStep(prompt: string, config: {
    cwd: string;
    allowedTools?: string[];
    maxTurns?: number;
    timeout?: number;
}, emitter?: EventEmitter): Promise<{
    output: string;
    metadata: Record<string, unknown>;
}>;
//# sourceMappingURL=claude-client.d.ts.map