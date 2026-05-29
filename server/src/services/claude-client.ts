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

// 动态加载 claude-code，避免启动时阻塞
let _query: typeof import('@anthropic-ai/claude-code').query | null = null;
async function getClaudeQuery() {
  if (!_query) {
    const mod = await import('@anthropic-ai/claude-code');
    _query = mod.query;
  }
  return _query!;
}

// ========== 类型 ==========

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
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'idle' | 'error';
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

const sessions = new Map<string, Session>();

export function createSession(id: string, config: SessionConfig): Session {
  const mergedTools = [...new Set([...AUTO_APPROVED_TOOLS, ...(config.allowedTools || [])])];
  const session: Session = {
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

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function listSessions(): Session[] {
  return Array.from(sessions.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function deleteSession(id: string): boolean {
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
export async function sendMessage(
  sessionId: string,
  message: string,
  emitter: EventEmitter
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    emitter.emit('event', { type: 'error', content: 'Session not found' } satisfies StreamEvent);
    emitter.emit('close');
    return;
  }

  session.messages.push({ role: 'user', content: message });
  session.status = 'active';
  session.updatedAt = new Date().toISOString();

  const maxTurns = session.config.maxTurns || 50;

  try {
    const abortController = new AbortController();
    const totalTimeout = session.config.totalTimeout || 30 * 60 * 1000;
    const timer = setTimeout(() => abortController.abort(), totalTimeout);

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
          const sysMsg = msg as any;
          emitter.emit('event', {
            type: 'system',
            content: `Session initialized: model=${sysMsg.model}, tools=${sysMsg.tools?.length || 0}`,
            metadata: { model: sysMsg.model, permissionMode: sysMsg.permissionMode },
          } satisfies StreamEvent);
          break;
        }

        case 'assistant': {
          const asstMsg = msg as any;
          if (asstMsg.message?.content) {
            for (const block of asstMsg.message.content) {
              if (block.type === 'text') {
                assistantText += block.text;
                emitter.emit('event', { type: 'text', content: block.text } satisfies StreamEvent);
              } else if (block.type === 'tool_use') {
                emitter.emit('event', {
                  type: 'tool_use',
                  content: block.name,
                  metadata: { input: block.input, id: block.id },
                } satisfies StreamEvent);
              }
            }
          }
          break;
        }

        case 'user': {
          // 工具执行结果作为 user message 回传
          // Claude Code 会把 tool_result 包装在 user message 的 content blocks 中
          if ('message' in msg && (msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'tool_result') {
                const resultContent = typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content);
                emitter.emit('event', {
                  type: 'tool_result',
                  content: resultContent,
                  metadata: { toolUseId: block.tool_use_id },
                } satisfies StreamEvent);
              }
            }
          }
          break;
        }

        case 'result': {
          const resultMsg = msg as any;
          if (resultMsg.subtype === 'success' && resultMsg.result) {
            // 如果还没有收集到文本，用 result 的文本
            if (!assistantText) {
              assistantText = resultMsg.result;
              emitter.emit('event', { type: 'text', content: resultMsg.result } satisfies StreamEvent);
            }
          }
          if (resultMsg.subtype !== 'success') {
            emitter.emit('event', {
              type: 'progress',
              content: `Result: subtype=${resultMsg.subtype}, turns=${resultMsg.num_turns}, cost=$${resultMsg.total_cost_usd?.toFixed(4) || '0'}`,
            } satisfies StreamEvent);
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
    emitter.emit('event', { type: 'done', content: '' } satisfies StreamEvent);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    session.status = 'error';
    session.updatedAt = new Date().toISOString();
    emitter.emit('event', { type: 'error', content: errorMsg } satisfies StreamEvent);
  } finally {
    emitter.emit('close');
  }
}

/**
 * 执行工作流单步（无会话，独立调用）
 */
export async function executeStep(
  prompt: string,
  config: {
    cwd: string;
    allowedTools?: string[];
    maxTurns?: number;
    timeout?: number;
  },
  emitter?: EventEmitter
): Promise<{ output: string; metadata: Record<string, unknown> }> {
  const mergedTools = [...new Set([...AUTO_APPROVED_TOOLS, ...(config.allowedTools || [])])];
  const timeout = config.timeout || 10 * 60 * 1000;

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeout);

  try {
    const query = await getClaudeQuery();
    const response = query({
      prompt,
      options: {
        cwd: config.cwd,
        allowedTools: mergedTools,
        maxTurns: config.maxTurns || 30,
        permissionMode: 'bypassPermissions',
        abortController,
      },
    });

    let output = '';
    let toolCalls = 0;

    for await (const msg of response) {
      if (abortController.signal.aborted) throw new Error('Step timeout exceeded');

      switch (msg.type) {
        case 'assistant': {
          const asstMsg = msg as any;
          if (asstMsg.message?.content) {
            for (const block of asstMsg.message.content) {
              if (block.type === 'text') {
                output += block.text;
                emitter?.emit('event', { type: 'text', content: block.text });
              } else if (block.type === 'tool_use') {
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
          if ('message' in msg && (msg as any).message?.content) {
            for (const block of (msg as any).message.content) {
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
          const resultMsg = msg as any;
          if (resultMsg.subtype === 'success' && resultMsg.result && !output) {
            output = resultMsg.result;
          }
          break;
        }
      }
    }

    clearTimeout(timer);
    return { output, metadata: { toolCalls } };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
