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
import {
  ensureSessionDirs,
  loadAllSessions,
  loadSession,
  saveSession,
  deleteSessionFiles,
  deriveTitle,
  type Session,
  type SessionConfig,
  type SessionMessage,
} from './session-store.js';

// 动态加载 claude-code，避免启动时阻塞
let _query: typeof import('@anthropic-ai/claude-code').query | null = null;
async function getClaudeQuery() {
  if (!_query) {
    const mod = await import('@anthropic-ai/claude-code');
    _query = mod.query;
  }
  return _query!;
}

// 启动即初始化会话存储目录
ensureSessionDirs();

// 重新导出类型，保持对外 API 不变（session.ts 仍可从本文件 import 类型）
export type { Session, SessionConfig, SessionMessage };

// ========== 类型 ==========

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'error' | 'done' | 'system' | 'progress' | 'aborted';
  content: string;
  metadata?: Record<string, unknown>;
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

// ========== 会话管理（基于文件持久化） ==========

export function createSession(id: string, config: SessionConfig): Session {
  const mergedTools = [...new Set([...AUTO_APPROVED_TOOLS, ...(config.allowedTools || [])])];
  const now = new Date().toISOString();
  const session: Session = {
    id,
    title: '新会话',
    config: { ...config, allowedTools: mergedTools },
    messages: [],
    createdAt: now,
    updatedAt: now,
    status: 'idle',
  };
  saveSession(session);
  return session;
}

export function getSession(id: string): Session | undefined {
  return loadSession(id) || undefined;
}

export function listSessions(): Session[] {
  return loadAllSessions();
}

export function deleteSession(id: string): boolean {
  return deleteSessionFiles(id);
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
  emitter: EventEmitter,
  externalSignal?: AbortSignal
): Promise<void> {
  const sessionMaybe = getSession(sessionId);
  if (!sessionMaybe) {
    emitter.emit('event', { type: 'error', content: 'Session not found' } satisfies StreamEvent);
    emitter.emit('close');
    return;
  }
  // 重新绑定为确定非空的 const，使后续闭包（pushAssistantIfNeeded）内 TS 收窄生效
  const session: Session = sessionMaybe;

  session.messages.push({ role: 'user', content: message });
  // 首条用户消息时自动生成标题（替换默认“新会话”）
  if (session.title === '新会话') {
    session.title = deriveTitle(session);
  }
  session.status = 'active';
  session.updatedAt = new Date().toISOString();
  saveSession(session);

  const maxTurns = session.config.maxTurns || 9999;
  // 声明在 try 外，便于 catch 时保留已生成的部分文本
  let assistantText = '';
  // 当前轮次工具调用累计（用 tool_use_id 关联 use 与 result），最终落到 assistant 消息的 toolEvents
  const toolEvents: Array<{ id?: string; name: string; input?: unknown; result?: string }> = [];
  // 声明在 try 外，便于 catch 时判断是否主动中断
  const abortController = new AbortController();

  /** 有文本或工具记录时，push 一条 assistant 消息（含 toolEvents，剥离临时 id） */
  function pushAssistantIfNeeded() {
    const cleanToolEvents = toolEvents.map(e => ({ name: e.name, input: e.input, result: e.result }));
    if (assistantText || cleanToolEvents.length > 0) {
      session.messages.push({
        role: 'assistant',
        content: assistantText,
        ...(cleanToolEvents.length > 0 ? { toolEvents: cleanToolEvents } : {}),
      });
    }
  }

  try {
    // 联动外部信号（客户端断开 / 主动停止）：任一触发即中断本地
    if (externalSignal) {
      if (externalSignal.aborted) {
        abortController.abort();
      } else {
        externalSignal.addEventListener('abort', () => abortController.abort(), { once: true });
      }
    }
    // 无超时限制，让 Claude Code 自然完成
    const timer = setTimeout(() => {}, 0);

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

    for await (const msg of response) {
      if (abortController.signal.aborted) {
        throw new Error('__ABORTED__');
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
              } else if (block.type === 'thinking') {
                // 思考过程块：{ type: 'thinking', thinking: '...' }
                const thinkingText = block.thinking || '';
                if (thinkingText) {
                  emitter.emit('event', { type: 'thinking', content: thinkingText } satisfies StreamEvent);
                }
              } else if (block.type === 'tool_use') {
                toolEvents.push({ id: block.id, name: block.name, input: block.input });
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
                // 关联到对应的 tool_use 记录（按 id），截断到 5000 字符（与前端 ToolCallBlock 阈值一致）
                const evt = toolEvents.find(e => e.id === block.tool_use_id);
                if (evt) {
                  evt.result = resultContent.length > 5000 ? resultContent.slice(0, 5000) : resultContent;
                }
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

    pushAssistantIfNeeded();

    session.status = 'idle';
    session.updatedAt = new Date().toISOString();
    emitter.emit('event', { type: 'done', content: '' } satisfies StreamEvent);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // 以 signal 状态为准判断是否主动中断（SDK 中断错误形态多样，字符串不可靠）
    const aborted = abortController.signal.aborted;
    // 主动中断视为正常结束（status=idle），真实错误才标记 error
    session.status = aborted ? 'idle' : 'error';
    session.updatedAt = new Date().toISOString();
    // 中断 / 出错都保留已生成的部分 assistant 文本与工具记录
    pushAssistantIfNeeded();
    if (aborted) {
      emitter.emit('event', { type: 'aborted', content: '已停止' } satisfies StreamEvent);
    } else {
      emitter.emit('event', { type: 'error', content: errMsg } satisfies StreamEvent);
    }
  } finally {
    // 统一落盘：覆盖成功 / 中断 / 错误三种情况，保证已生成内容不丢
    saveSession(session);
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
  const timeout = config.timeout || 0; // 0 表示无限制

  const abortController = new AbortController();
  // 无超时限制，让 Claude Code 自然完成
  const timer = setTimeout(() => {}, 0);

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
