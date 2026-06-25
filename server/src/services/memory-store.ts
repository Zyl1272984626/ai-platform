/**
 * 记忆中枢 - 文件化 JSON 存储
 *
 * 存储结构：
 *   server/data/memory/
 *     index.json                       # ConversationSummary[] 索引
 *     conversations/{source}--{id}.json # 完整对话详情
 *     insights/index.json              # MemoryInsight[]
 *     artifacts/index.json             # GeneratedArtifact[]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.resolve(__dirname, '../../data/memory');
const CONV_DIR = path.join(MEMORY_DIR, 'conversations');
const INSIGHTS_DIR = path.join(MEMORY_DIR, 'insights');
const ARTIFACTS_DIR = path.join(MEMORY_DIR, 'artifacts');
const ITEMS_DIR = path.join(MEMORY_DIR, 'items');
const AUTOMATION_DIR = path.join(MEMORY_DIR, 'automation');
const INJECTIONS_DIR = path.join(MEMORY_DIR, 'injections');

// ========== 类型定义 ==========

export interface ConversationSummary {
  id: string;
  source: 'claude-code' | 'codex' | 'zcode';
  projectSlug: string;
  projectPath: string;
  sessionId: string;
  title: string;
  model: string;
  messageCount: number;
  toolCallCount: number;
  startedAt: string;
  lastActivityAt: string;
  sizeBytes: number;
  summary?: string;
  tags?: string[];
  importedAt: string;
  sourceFilePath?: string;
}

export interface ConversationMessage {
  uuid: string;
  parentUuid: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  contentType: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  toolName?: string;
  toolInput?: Record<string, unknown>;
  timestamp: string;
  isSidechain: boolean;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

export interface MemoryInsight {
  id: string;
  sourceConversationId: string;
  type: 'preference' | 'pattern' | 'correction' | 'knowledge' | 'skill-idea';
  content: string;
  confidence: number;
  generatedAt: string;
  model: string;
}

export interface GeneratedArtifact {
  id: string;
  sourceConversationId: string;
  type: 'skill' | 'prompt' | 'memory-note';
  title: string;
  content: string;
  generatedAt: string;
  applied: boolean;
}

export type MemoryItemType =
  | 'term'
  | 'preference'
  | 'project_rule'
  | 'workflow'
  | 'decision'
  | 'entity'
  | 'skill'
  | 'warning'
  | 'source';

export type MemoryItemStatus =
  | 'candidate'
  | 'approved'
  | 'active'
  | 'stale'
  | 'conflict'
  | 'archived'
  | 'rejected';

export interface MemorySourceRef {
  source: ConversationSummary['source'] | 'system' | 'insight';
  conversationId?: string;
  insightId?: string;
  messageIds?: string[];
}

export interface MemoryItem {
  id: string;
  type: MemoryItemType;
  title: string;
  content: string;
  normalizedContent: string;
  scope: 'global' | 'project' | 'platform' | 'session';
  projectPath?: string;
  platform?: ConversationSummary['source'];
  sourceRefs: MemorySourceRef[];
  confidence: number;
  status: MemoryItemStatus;
  tags: string[];
  aliases?: string[];
  evidenceCount: number;
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecallResult {
  query: string;
  projectPath?: string;
  platform?: ConversationSummary['source'];
  generatedAt: string;
  items: MemoryItem[];
  bundle: string;
}

export interface MemoryAutomationLog {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'failed';
  trigger: 'manual' | 'startup' | 'scheduled' | 'api';
  scan?: { scanned: number; newCount: number; updated: number };
  candidates?: { created: number; updated: number; skipped: number };
  error?: string;
}

/**
 * 注入日志：根 AI 调用前从冷库召回并注入上下文的记录。
 * 让"本次对话注入了哪些记忆"变得可解释、可反馈。
 */
export interface MemoryInjectionLog {
  id: string;
  /** 触发注入的请求文本（截断，仅作回溯线索） */
  request: string;
  projectPath?: string;
  platform?: ConversationSummary['source'];
  /** 本次注入的记忆 id 列表 */
  memoryIds: string[];
  /** 实际拼入根 AI system prompt 的 bundle */
  bundle: string;
  generatedAt: string;
  target: 'chat' | 'pipeline' | 'test' | 'review';
  /** 用户对本次注入质量的标记 */
  feedback?: 'useful' | 'wrong' | 'irrelevant';
}

// ========== 工具方法 ==========

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

/** 将复合 ID 转为安全的文件名（claude-code:xxx -> claude-code--xxx） */
function idToFileName(id: string): string {
  return id.replace(/:/g, '--');
}

// ========== 初始化 ==========

export function ensureMemoryDirs() {
  ensureDir(MEMORY_DIR);
  ensureDir(CONV_DIR);
  ensureDir(INSIGHTS_DIR);
  ensureDir(ARTIFACTS_DIR);
  ensureDir(ITEMS_DIR);
  ensureDir(AUTOMATION_DIR);
  ensureDir(INJECTIONS_DIR);
}

// ========== 对话索引 ==========

const INDEX_FILE = path.join(MEMORY_DIR, 'index.json');

export function loadConversationIndex(): ConversationSummary[] {
  return readJsonFile<ConversationSummary[]>(INDEX_FILE, []);
}

export function saveConversationIndex(items: ConversationSummary[]) {
  writeJsonFile(INDEX_FILE, items);
}

export function upsertConversationSummary(summary: ConversationSummary) {
  const index = loadConversationIndex();
  const idx = index.findIndex(c => c.id === summary.id);
  if (idx >= 0) {
    // 保留已有的 summary 和 tags
    summary.summary = summary.summary || index[idx].summary;
    summary.tags = summary.tags || index[idx].tags;
    index[idx] = summary;
  } else {
    index.push(summary);
  }
  saveConversationIndex(index);
}

// ========== 对话详情 ==========

export function loadConversationDetail(id: string): ConversationDetail | null {
  const filePath = path.join(CONV_DIR, `${idToFileName(id)}.json`);
  return readJsonFile<ConversationDetail | null>(filePath, null);
}

export function saveConversationDetail(detail: ConversationDetail) {
  const filePath = path.join(CONV_DIR, `${idToFileName(detail.id)}.json`);
  writeJsonFile(filePath, detail);
}

export function updateConversationSummary(id: string, updates: Partial<ConversationSummary>) {
  const index = loadConversationIndex();
  const item = index.find(c => c.id === id);
  if (item) {
    Object.assign(item, updates);
    saveConversationIndex(index);
  }
}

export function deleteConversations(ids: string[]): { deleted: number; freedBytes: number } {
  const index = loadConversationIndex();
  const idSet = new Set(ids);
  let freedBytes = 0;

  // 删除原始源文件（彻底删除）
  for (const item of index) {
    if (idSet.has(item.id) && item.sourceFilePath) {
      try {
        if (fs.existsSync(item.sourceFilePath)) {
          freedBytes += fs.statSync(item.sourceFilePath).size;
          fs.unlinkSync(item.sourceFilePath);
          console.log(`[Memory] 已删除源文件: ${item.sourceFilePath}`);
        }
      } catch (err: any) {
        console.warn(`[Memory] 无法删除源文件 ${item.sourceFilePath}: ${err.message}`);
      }
    }
  }

  // 删除记忆中枢缓存文件
  for (const id of ids) {
    const filePath = path.join(CONV_DIR, `${idToFileName(id)}.json`);
    if (fs.existsSync(filePath)) {
      freedBytes += fs.statSync(filePath).size;
      fs.unlinkSync(filePath);
    }
  }

  // 从索引中移除
  const remaining = index.filter(c => !idSet.has(c.id));
  saveConversationIndex(remaining);

  // 清理关联的洞察和制品中的引用
  const insights = loadInsights().filter(i => !idSet.has(i.sourceConversationId));
  saveInsights(insights);
  const artifacts = loadArtifacts().filter(a => !idSet.has(a.sourceConversationId));
  saveArtifacts(artifacts);

  return { deleted: ids.length, freedBytes };
}

// ========== 洞察 ==========

const INSIGHTS_FILE = path.join(INSIGHTS_DIR, 'index.json');

export function loadInsights(): MemoryInsight[] {
  return readJsonFile<MemoryInsight[]>(INSIGHTS_FILE, []);
}

export function saveInsights(items: MemoryInsight[]) {
  writeJsonFile(INSIGHTS_FILE, items);
}

export function addInsights(newInsights: MemoryInsight[]) {
  const all = loadInsights();
  all.push(...newInsights);
  saveInsights(all);
}

// ========== 制品 ==========

const ARTIFACTS_FILE = path.join(ARTIFACTS_DIR, 'index.json');

export function loadArtifacts(): GeneratedArtifact[] {
  return readJsonFile<GeneratedArtifact[]>(ARTIFACTS_FILE, []);
}

export function saveArtifacts(items: GeneratedArtifact[]) {
  writeJsonFile(ARTIFACTS_FILE, items);
}

export function addArtifact(artifact: GeneratedArtifact) {
  const all = loadArtifacts();
  all.push(artifact);
  saveArtifacts(all);
}

export function updateArtifact(id: string, updates: Partial<GeneratedArtifact>) {
  const all = loadArtifacts();
  const item = all.find(a => a.id === id);
  if (item) {
    Object.assign(item, updates);
    saveArtifacts(all);
  }
}

// ========== 统计 ==========

const ITEMS_FILE = path.join(ITEMS_DIR, 'index.json');

export function loadMemoryItems(): MemoryItem[] {
  return readJsonFile<MemoryItem[]>(ITEMS_FILE, []);
}

export function saveMemoryItems(items: MemoryItem[]) {
  writeJsonFile(ITEMS_FILE, items);
}

export function upsertMemoryItems(newItems: MemoryItem[]): { created: number; updated: number; skipped: number } {
  const all = loadMemoryItems();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of newItems) {
    const idx = all.findIndex(existing => existing.id === item.id);
    if (idx >= 0) {
      if (all[idx].status === 'rejected' || all[idx].status === 'archived') {
        skipped++;
        continue;
      }
      all[idx] = {
        ...all[idx],
        ...item,
        status: all[idx].status,
        usageCount: all[idx].usageCount || 0,
        lastUsedAt: all[idx].lastUsedAt,
        createdAt: all[idx].createdAt,
        updatedAt: new Date().toISOString(),
        evidenceCount: Math.max(all[idx].evidenceCount || 1, item.evidenceCount || 1),
        sourceRefs: mergeSourceRefs(all[idx].sourceRefs || [], item.sourceRefs || []),
      };
      updated++;
    } else {
      all.push(item);
      created++;
    }
  }

  saveMemoryItems(all);
  return { created, updated, skipped };
}

export function updateMemoryItem(id: string, updates: Partial<MemoryItem>): MemoryItem | null {
  const all = loadMemoryItems();
  const item = all.find(m => m.id === id);
  if (!item) return null;
  Object.assign(item, updates, { updatedAt: new Date().toISOString() });
  saveMemoryItems(all);
  return item;
}

export function getMemoryItemById(id: string): MemoryItem | null {
  return loadMemoryItems().find(item => item.id === id) || null;
}

export function recordMemoryUsage(ids: string[]) {
  const idSet = new Set(ids);
  const all = loadMemoryItems();
  const now = new Date().toISOString();
  let changed = false;
  for (const item of all) {
    if (idSet.has(item.id)) {
      item.usageCount = (item.usageCount || 0) + 1;
      item.lastUsedAt = now;
      item.updatedAt = now;
      changed = true;
    }
  }
  if (changed) saveMemoryItems(all);
}

function mergeSourceRefs(a: MemorySourceRef[], b: MemorySourceRef[]): MemorySourceRef[] {
  const seen = new Set<string>();
  const out: MemorySourceRef[] = [];
  for (const ref of [...a, ...b]) {
    const key = `${ref.source}:${ref.conversationId || ''}:${ref.insightId || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

const AUTOMATION_FILE = path.join(AUTOMATION_DIR, 'runs.json');

export function loadAutomationLogs(): MemoryAutomationLog[] {
  return readJsonFile<MemoryAutomationLog[]>(AUTOMATION_FILE, []);
}

export function addAutomationLog(log: MemoryAutomationLog) {
  const logs = loadAutomationLogs();
  logs.unshift(log);
  writeJsonFile(AUTOMATION_FILE, logs.slice(0, 80));
}

// ========== 注入日志 ==========

const INJECTIONS_FILE = path.join(INJECTIONS_DIR, 'index.json');
const MAX_INJECTION_LOGS = 200;

export function loadInjections(): MemoryInjectionLog[] {
  return readJsonFile<MemoryInjectionLog[]>(INJECTIONS_FILE, []);
}

export function addInjectionLog(log: MemoryInjectionLog) {
  const logs = loadInjections();
  logs.unshift(log);
  writeJsonFile(INJECTIONS_FILE, logs.slice(0, MAX_INJECTION_LOGS));
}

export function updateInjectionFeedback(id: string, feedback: MemoryInjectionLog['feedback']): MemoryInjectionLog | null {
  const logs = loadInjections();
  const item = logs.find(l => l.id === id);
  if (!item) return null;
  item.feedback = feedback;
  writeJsonFile(INJECTIONS_FILE, logs);
  return item;
}

export interface MemoryStats {
  totalConversations: number;
  bySource: Record<string, number>;
  byProject: Record<string, number>;
  totalInsights: number;
  totalArtifacts: number;
  appliedArtifacts: number;
  totalMemoryItems: number;
  activeMemoryItems: number;
  candidateMemoryItems: number;
}

export function getMemoryStats(): MemoryStats {
  const conversations = loadConversationIndex();
  const insights = loadInsights();
  const artifacts = loadArtifacts();
  const memoryItems = loadMemoryItems();

  const bySource: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  for (const c of conversations) {
    bySource[c.source] = (bySource[c.source] || 0) + 1;
    const proj = c.projectPath || c.projectSlug;
    byProject[proj] = (byProject[proj] || 0) + 1;
  }

  return {
    totalConversations: conversations.length,
    bySource,
    byProject,
    totalInsights: insights.length,
    totalArtifacts: artifacts.length,
    appliedArtifacts: artifacts.filter(a => a.applied).length,
    totalMemoryItems: memoryItems.length,
    activeMemoryItems: memoryItems.filter(a => ['approved', 'active'].includes(a.status)).length,
    candidateMemoryItems: memoryItems.filter(a => a.status === 'candidate').length,
  };
}

// ========== 初始化目录 ==========

ensureMemoryDirs();
