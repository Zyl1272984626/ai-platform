/**
 * 对话扫描器 - 解析 Claude Code 和 Codex 的 JSONL 对话文件
 *
 * Claude Code 格式：~/.claude/projects/{slug}/{sessionId}.jsonl
 *   每行 JSON，type 字段区分: user, assistant, system, permission-mode 等
 *
 * Codex 格式：~/.codex/sessions/{year}/{month}/{day}/rollout-*.jsonl
 *   每行 JSON，type 字段区分: session_meta, event_msg 等
 */
import fs from 'fs';
import path from 'path';
import * as readline from 'readline';
import os from 'os';
import {
  type ConversationSummary,
  type ConversationMessage,
  type ConversationDetail,
  loadConversationIndex,
  upsertConversationSummary,
  saveConversationDetail,
  ensureMemoryDirs,
} from './memory-store.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CODEX_DIR = path.join(os.homedir(), '.codex');

// ========== Claude Code 扫描 ==========

interface ClaudeHistoryEntry {
  display: string;
  project: string;
  sessionId: string;
  timestamp: number;
}

async function readClaudeHistory(): Promise<Map<string, ClaudeHistoryEntry>> {
  const historyFile = path.join(CLAUDE_DIR, 'history.jsonl');
  const map = new Map<string, ClaudeHistoryEntry>();
  if (!fs.existsSync(historyFile)) return map;

  const rl = readline.createInterface({ input: fs.createReadStream(historyFile, 'utf-8') });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as ClaudeHistoryEntry;
      if (entry.sessionId) map.set(entry.sessionId, entry);
    } catch { /* skip malformed */ }
  }
  return map;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === 'text' && c.text)
      .map((c: any) => c.text as string)
      .join('\n');
  }
  return '';
}

function countToolCalls(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  return content.filter((c: any) => c.type === 'tool_use').length;
}

async function parseClaudeSessionJsonl(
  filePath: string,
  projectSlug: string,
  historyMap: Map<string, ClaudeHistoryEntry>,
): Promise<{ summary: ConversationSummary; messages: ConversationMessage[] } | null> {
  const sessionId = path.basename(filePath, '.jsonl');
  const stat = fs.statSync(filePath);

  let userCount = 0;
  let assistantCount = 0;
  let toolCallCount = 0;
  let firstUserMsg = '';
  let model = '';
  let startedAt = '';
  let lastActivityAt = '';
  let projectPath = '';
  const messages: ConversationMessage[] = [];

  // 从 history 获取项目路径和首条消息
  const historyEntry = historyMap.get(sessionId);
  if (historyEntry) {
    projectPath = historyEntry.project || '';
    if (!firstUserMsg) firstUserMsg = historyEntry.display || '';
  }

  const rl = readline.createInterface({ input: fs.createReadStream(filePath, 'utf-8') });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let event: any;
    try { event = JSON.parse(line); } catch { continue; }

    const ts = event.timestamp || '';
    if (ts && (!startedAt || ts < startedAt)) startedAt = ts;
    if (ts && ts > lastActivityAt) lastActivityAt = ts;

    // 从 cwd 获取项目路径
    if (event.cwd && !projectPath) projectPath = event.cwd;

    if (event.type === 'user' && event.message) {
      // 跳过 sidechain（子代理）消息
      if (event.isSidechain) continue;

      // 跳过纯 tool_result 消息（工具返回结果，不是用户输入）
      const content = event.message.content;
      if (Array.isArray(content) && content.every((c: any) => c.type === 'tool_result')) continue;

      const text = extractTextFromContent(content);
      if (!firstUserMsg && text) firstUserMsg = text;

      userCount++;
      messages.push({
        uuid: event.uuid || '',
        parentUuid: event.parentUuid || null,
        role: 'user',
        content: text,
        contentType: 'text',
        timestamp: typeof ts === 'number' ? new Date(ts).toISOString() : String(ts),
        isSidechain: !!event.isSidechain,
      });
    } else if (event.type === 'assistant' && event.message) {
      // 跳过 sidechain（子代理）消息
      if (event.isSidechain) continue;

      assistantCount++;
      const msgContent = event.message.content;
      const text = extractTextFromContent(msgContent);
      toolCallCount += countToolCalls(msgContent);
      if (event.message.model) model = event.message.model;

      // 提取文本部分
      if (text) {
        messages.push({
          uuid: event.uuid || '',
          parentUuid: event.parentUuid || null,
          role: 'assistant',
          content: text,
          contentType: 'text',
          timestamp: typeof ts === 'number' ? new Date(ts).toISOString() : String(ts),
          isSidechain: !!event.isSidechain,
        });
      }

      // 提取工具调用
      if (Array.isArray(msgContent)) {
        for (const item of msgContent) {
          if (item.type === 'tool_use') {
            messages.push({
              uuid: event.uuid || '',
              parentUuid: event.parentUuid || null,
              role: 'assistant',
              content: `${item.name}(${JSON.stringify(item.input).slice(0, 200)})`,
              contentType: 'tool_use',
              toolName: item.name,
              toolInput: item.input,
              timestamp: typeof ts === 'number' ? new Date(ts).toISOString() : String(ts),
              isSidechain: !!event.isSidechain,
            });
          }
        }
      }
    }
  }

  if (userCount === 0 && assistantCount === 0) return null;

  // 格式化时间戳
  if (startedAt && typeof startedAt === 'number') {
    startedAt = new Date(startedAt).toISOString();
  }
  if (lastActivityAt && typeof lastActivityAt === 'number') {
    lastActivityAt = new Date(lastActivityAt).toISOString();
  }

  return {
    summary: {
      id: `claude-code:${sessionId}`,
      source: 'claude-code',
      projectSlug,
      projectPath,
      sessionId,
      title: firstUserMsg.slice(0, 80) || '(无标题)',
      model,
      messageCount: userCount + assistantCount,
      toolCallCount,
      startedAt,
      lastActivityAt,
      sizeBytes: stat.size,
      importedAt: new Date().toISOString(),
      sourceFilePath: filePath,
    },
    messages,
  };
}

async function scanClaudeCodeSessions(): Promise<number> {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  if (!fs.existsSync(projectsDir)) return 0;

  const historyMap = await readClaudeHistory();
  let count = 0;

  const slugs = fs.readdirSync(projectsDir).filter(f => {
    const p = path.join(projectsDir, f);
    return fs.statSync(p).isDirectory();
  });

  for (const slug of slugs) {
    const slugDir = path.join(projectsDir, slug);
    const files = fs.readdirSync(slugDir).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = path.join(slugDir, file);
      try {
        const result = await parseClaudeSessionJsonl(filePath, slug, historyMap);
        if (result) {
          upsertConversationSummary(result.summary);
          saveConversationDetail({ ...result.summary, messages: result.messages });
          count++;
        }
      } catch (err: any) {
        console.warn(`[Memory] 跳过 ${file}: ${err.message}`);
      }
    }
  }

  return count;
}

// ========== Codex 扫描 ==========

interface CodexSessionIndex {
  id: string;
  thread_name: string;
  updated_at: string;
}

async function readCodexSessionIndex(): Promise<Map<string, CodexSessionIndex>> {
  const indexFile = path.join(CODEX_DIR, 'session_index.jsonl');
  const map = new Map<string, CodexSessionIndex>();
  if (!fs.existsSync(indexFile)) return map;

  const rl = readline.createInterface({ input: fs.createReadStream(indexFile, 'utf-8') });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as CodexSessionIndex;
      if (entry.id) map.set(entry.id, entry);
    } catch { /* skip */ }
  }
  return map;
}

async function parseCodexRollout(
  filePath: string,
  sessionIndex: Map<string, CodexSessionIndex>,
): Promise<{ summary: ConversationSummary; messages: ConversationMessage[] } | null> {
  const fileName = path.basename(filePath);
  // 从文件名提取 sessionId (UUIDv7): rollout-2026-06-11T11-48-47-{uuid}.jsonl
  const uuidMatch = fileName.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const sessionId = uuidMatch ? uuidMatch[1] : fileName.replace('.jsonl', '');
  const stat = fs.statSync(filePath);

  let userCount = 0;
  let assistantCount = 0;
  let toolCallCount = 0;
  let firstUserMsg = '';
  let model = '';
  let projectPath = '';
  let startedAt = '';
  let lastActivityAt = '';
  let threadName = '';
  const messages: ConversationMessage[] = [];

  const indexEntry = sessionIndex.get(sessionId);
  if (indexEntry) threadName = indexEntry.thread_name || '';

  const rl = readline.createInterface({ input: fs.createReadStream(filePath, 'utf-8') });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let event: any;
    try { event = JSON.parse(line); } catch { continue; }

    const ts = event.timestamp || '';

    if (event.type === 'session_meta' && event.payload) {
      const p = event.payload;
      projectPath = p.cwd || '';
      startedAt = p.timestamp || '';
      model = p.model_provider || '';
      continue;
    }

    // Codex 消息来源1: event_msg 事件（包含真实的用户和助手消息）
    if (event.type === 'event_msg' && event.payload) {
      const p = event.payload;

      // 用户消息: event_msg + payload.type=user_message, 文本在 payload.message
      if (p.type === 'user_message' && p.message) {
        userCount++;
        const text = p.message;
        if (!firstUserMsg) firstUserMsg = text;

        messages.push({
          uuid: p.client_id || '',
          parentUuid: null,
          role: 'user',
          content: text,
          contentType: 'text',
          timestamp: typeof ts === 'string' ? ts : new Date(ts || Date.now()).toISOString(),
          isSidechain: false,
        });
      }

      // 助手消息: event_msg + payload.type=agent_message
      if (p.type === 'agent_message' && p.message) {
        assistantCount++;
        messages.push({
          uuid: p.id || '',
          parentUuid: null,
          role: 'assistant',
          content: p.message,
          contentType: 'text',
          timestamp: typeof ts === 'string' ? ts : new Date(ts || Date.now()).toISOString(),
          isSidechain: false,
        });
      }

      // 任务完成时间
      if (p.type === 'task_complete' && p.completed_at) {
        lastActivityAt = new Date(p.completed_at * 1000).toISOString();
      }
    }

    // Codex 消息来源2: response_item 事件（助手回复和工具调用）
    if (event.type === 'response_item' && event.payload) {
      const p = event.payload;

      // 助手消息: response_item + payload.role=assistant + payload.type=message
      if (p.role === 'assistant' && p.type === 'message') {
        let text = '';
        if (typeof p.content === 'string') {
          text = p.content;
        } else if (Array.isArray(p.content)) {
          text = p.content
            .filter((c: any) => c.type === 'output_text' && c.text)
            .map((c: any) => c.text)
            .join('\n');
        }
        if (text) {
          // 避免重复（如果 event_msg 已经捕获了相同的助手消息）
          const alreadyExists = messages.some(m =>
            m.role === 'assistant' && m.contentType === 'text' && m.content === text
          );
          if (!alreadyExists) {
            assistantCount++;
            messages.push({
              uuid: p.id || '',
              parentUuid: null,
              role: 'assistant',
              content: text,
              contentType: 'text',
              timestamp: typeof ts === 'string' ? ts : new Date(ts || Date.now()).toISOString(),
              isSidechain: false,
            });
          }
        }
      }

      // 工具调用: response_item + payload.type=function_call
      if (p.type === 'function_call') {
        toolCallCount++;
        const fnName = p.name || p.function?.name || 'tool';
        let fnArgs = '';
        try { fnArgs = typeof p.arguments === 'string' ? p.arguments.slice(0, 200) : JSON.stringify(p.arguments || p.function?.arguments).slice(0, 200); } catch { /* ignore */ }
        messages.push({
          uuid: p.id || '',
          parentUuid: null,
          role: 'assistant',
          content: `${fnName}(${fnArgs})`,
          contentType: 'tool_use',
          toolName: fnName,
          timestamp: typeof ts === 'string' ? ts : new Date(ts || Date.now()).toISOString(),
          isSidechain: false,
        });
      }
    }

    // 任务完成时间
    if (event.type === 'event_msg' && event.payload?.type === 'task_complete' && event.payload.completed_at) {
      lastActivityAt = new Date(event.payload.completed_at * 1000).toISOString();
    }
  }

  if (userCount === 0 && assistantCount === 0) return null;

  // 优先用 thread_name 作为标题，否则取第一个非 XML 标签的用户消息
  let title = threadName;
  if (!title) {
    const cleanFirst = firstUserMsg.trimStart().startsWith('<')
      ? firstUserMsg.split('\n').find(l => l.trim() && !l.trim().startsWith('<')) || ''
      : firstUserMsg;
    title = cleanFirst.slice(0, 80) || '(无标题)';
  }

  return {
    summary: {
      id: `codex:${sessionId}`,
      source: 'codex',
      projectSlug: projectPath ? projectPath.replace(/[\\/:]/g, '--').replace(/^-+/, '') : 'unknown',
      projectPath,
      sessionId,
      title,
      model,
      messageCount: userCount + assistantCount,
      toolCallCount,
      startedAt: startedAt || stat.mtime.toISOString(),
      lastActivityAt: lastActivityAt || stat.mtime.toISOString(),
      sizeBytes: stat.size,
      importedAt: new Date().toISOString(),
      sourceFilePath: filePath,
    },
    messages,
  };
}

async function scanCodexSessions(): Promise<number> {
  const sessionsDir = path.join(CODEX_DIR, 'sessions');
  if (!fs.existsSync(sessionsDir)) return 0;

  const sessionIndex = await readCodexSessionIndex();
  let count = 0;

  // 遍历 sessions/{year}/{month}/{day}/
  async function walkDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        try {
          const result = await parseCodexRollout(fullPath, sessionIndex);
          if (result) {
            upsertConversationSummary(result.summary);
            saveConversationDetail({ ...result.summary, messages: result.messages });
            count++;
          }
        } catch (err: any) {
          console.warn(`[Memory] 跳过 ${entry.name}: ${err.message}`);
        }
      }
    }
  }

  // 同时扫描 archived_sessions
  const archivedDir = path.join(CODEX_DIR, 'archived_sessions');
  if (fs.existsSync(archivedDir)) {
    const archivedFiles = fs.readdirSync(archivedDir).filter(f => f.startsWith('rollout-') && f.endsWith('.jsonl'));
    for (const file of archivedFiles) {
      try {
        const result = await parseCodexRollout(path.join(archivedDir, file), sessionIndex);
        if (result) {
          upsertConversationSummary(result.summary);
          saveConversationDetail({ ...result.summary, messages: result.messages });
          count++;
        }
      } catch (err: any) {
        console.warn(`[Memory] 跳过归档 ${file}: ${err.message}`);
      }
    }
  }

  await walkDir(sessionsDir);
  return count;
}

// ========== 统一扫描入口 ==========

export interface ScanResult {
  scanned: number;
  newCount: number;
  updated: number;
}

export async function scanAllConversations(): Promise<ScanResult> {
  ensureMemoryDirs();

  const existingIds = new Set(loadConversationIndex().map(c => c.id));

  const claudeCount = await scanClaudeCodeSessions();
  const codexCount = await scanCodexSessions();

  const totalScanned = claudeCount + codexCount;
  const newIndex = loadConversationIndex();
  const newCount = newIndex.filter(c => !existingIds.has(c.id)).length;
  const updated = totalScanned - newCount;

  return { scanned: totalScanned, newCount, updated };
}
