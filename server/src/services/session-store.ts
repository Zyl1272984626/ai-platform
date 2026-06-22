/**
 * 会话持久化存储
 *
 * 风格对齐 memory-store.ts：ensureDir / readJsonFile / writeJsonFile + 索引 + 按对象分文件
 *
 * 存储结构：
 *   server/data/sessions/
 *     index.json        # SessionSummary[] 索引（轻量，只存摘要字段）
 *     {id}.json         # 单个会话完整内容（含 messages）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.resolve(__dirname, '../../data/sessions');
const INDEX_FILE = path.join(SESSIONS_DIR, 'index.json');

// ========== 类型定义 ==========

export interface SessionConfig {
  cwd: string;
  systemPrompt?: string;
  allowedTools?: string[];
  maxTurns?: number;
  stepTimeout?: number;
  totalTimeout?: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 仅 assistant 消息可能携带的工具调用记录（第 3 批启用） */
  toolEvents?: Array<{
    name: string;
    input?: unknown;
    result?: string;
  }>;
}

export interface Session {
  id: string;
  title: string;
  config: SessionConfig;
  messages: SessionMessage[];
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'idle' | 'error';
}

/** 索引文件中的轻量摘要（去掉 messages，避免索引膨胀） */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: Session['status'];
  messageCount: number;
}

// ========== 工具方法（与 memory-store.ts 同风格） ==========

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore parse errors */ }
  return fallback;
}

function writeJsonFile(filePath: string, data: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ========== 初始化 ==========

export function ensureSessionDirs() {
  ensureDir(SESSIONS_DIR);
}

// ========== 索引读写 ==========

function toSummary(session: Session): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    messageCount: session.messages.length,
  };
}

export function loadSessionIndex(): SessionSummary[] {
  return readJsonFile<SessionSummary[]>(INDEX_FILE, []);
}

function saveSessionIndex(items: SessionSummary[]) {
  writeJsonFile(INDEX_FILE, items);
}

/** 刷新某条会话在索引中的摘要（不存在则追加） */
function upsertSessionIndex(session: Session) {
  const index = loadSessionIndex();
  const summary = toSummary(session);
  const idx = index.findIndex(s => s.id === session.id);
  if (idx >= 0) {
    index[idx] = summary;
  } else {
    index.push(summary);
  }
  saveSessionIndex(index);
}

// ========== 单会话读写 ==========

function sessionFile(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

export function loadSession(id: string): Session | null {
  return readJsonFile<Session | null>(sessionFile(id), null);
}

/** 保存完整会话并同步更新索引 */
export function saveSession(session: Session) {
  writeJsonFile(sessionFile(session.id), session);
  upsertSessionIndex(session);
}

export function deleteSessionFiles(id: string): boolean {
  const file = sessionFile(id);
  let removed = false;
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    removed = true;
  }
  // 同步从索引移除
  const index = loadSessionIndex();
  const next = index.filter(s => s.id !== id);
  if (next.length !== index.length) {
    saveSessionIndex(next);
    removed = true;
  }
  return removed;
}

/**
 * 加载全部会话（按 updatedAt 倒序）。
 * 历史数据兼容：缺 title 的旧会话补默认标题。
 */
export function loadAllSessions(): Session[] {
  const index = loadSessionIndex();
  const sessions: Session[] = [];
  for (const s of index) {
    const full = loadSession(s.id);
    if (full) {
      if (!full.title) full.title = deriveTitle(full);
      sessions.push(full);
    }
  }
  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return sessions;
}

// ========== 标题推导 ==========

/** 从首条用户消息推导标题，截断到 20 字 */
export function deriveTitle(session: Pick<Session, 'messages'>): string {
  const firstUser = session.messages.find(m => m.role === 'user');
  if (!firstUser || !firstUser.content.trim()) return '新会话';
  const text = firstUser.content.replace(/\s+/g, ' ').trim();
  return text.length > 20 ? text.slice(0, 20) + '…' : text;
}
