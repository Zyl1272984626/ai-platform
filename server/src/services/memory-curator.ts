import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  type ConversationSummary,
  type MemoryAutomationLog,
  type MemoryInsight,
  type MemoryInjectionLog,
  type MemoryItem,
  type MemoryItemStatus,
  type MemoryItemType,
  type MemoryRecallResult,
  addAutomationLog,
  addInjectionLog,
  getMemoryItemById,
  loadConversationDetail,
  loadConversationIndex,
  loadInsights,
  loadInjections,
  loadMemoryItems,
  recordMemoryUsage,
  updateMemoryItem,
  upsertMemoryItems,
} from './memory-store.js';
import { getMemoryConfig } from './memory-config.js';
import { scanAllConversations } from './conversation-scanner.js';
import { chatWithDeepSeek, isDeepSeekAvailable } from './deepseek-client.js';
import { rebuildVectorIndex, semanticScores, getVectorIndexStatus } from './memory-vector.js';

export interface GenerateMemoryCandidatesOptions {
  limit?: number;
  source?: ConversationSummary['source'] | 'all';
  projectPath?: string;
}

export interface RecallMemoryOptions {
  query: string;
  projectPath?: string;
  platform?: ConversationSummary['source'];
  limit?: number;
  includeCandidates?: boolean;
  recordUsage?: boolean;
  /** 注入目标：不同 target 召回不同类型的记忆 */
  target?: MemoryInjectionLog['target'];
}

/** 召回理由：解释某条记忆为何被召回，供注入可视化 */
export interface RecallReason {
  itemId: string;
  score: number;
  factors: string[];
}

export interface MemoryRecallResultWithReasons extends MemoryRecallResult {
  reasons: RecallReason[];
  target: MemoryInjectionLog['target'];
}

export interface MemoryAutomationResult {
  scan: Awaited<ReturnType<typeof scanAllConversations>>;
  candidates: ReturnType<typeof generateMemoryCandidates>;
  log: MemoryAutomationLog;
}

const GLOBAL_SEEDS: Array<Omit<MemoryItem, 'id' | 'normalizedContent' | 'createdAt' | 'updatedAt'>> = [
  {
    type: 'term',
    title: '冷库',
    content: '本地会话沉淀出的个人上下文资产，包含特殊术语、偏好、流程、纠偏、项目知识和平台经验，不是普通聊天记录备份。',
    scope: 'global',
    sourceRefs: [{ source: 'system' }],
    confidence: 0.95,
    status: 'active',
    tags: ['术语', '个人记忆'],
    aliases: ['会话冷库', '个人冷库'],
    evidenceCount: 1,
    usageCount: 0,
  },
  {
    type: 'term',
    title: '根 AI',
    content: '负责主导对话、调度工具、串联平台并读取冷库上下文的主 AI；它需要通过记忆召回减少重复解释。',
    scope: 'global',
    sourceRefs: [{ source: 'system' }],
    confidence: 0.9,
    status: 'active',
    tags: ['术语', '根AI'],
    aliases: ['根AI', '主 AI'],
    evidenceCount: 1,
    usageCount: 0,
  },
  {
    type: 'preference',
    title: '偏好深入可信的方案',
    content: '用户不满意浅层判断，期待方案包含市场参考、深入设计、实现路径、调用方式和能说服团队的论证。',
    scope: 'global',
    sourceRefs: [{ source: 'system' }],
    confidence: 0.95,
    status: 'active',
    tags: ['偏好', '交付标准'],
    evidenceCount: 1,
    usageCount: 0,
  },
  {
    type: 'project_rule',
    title: 'ai-platform 项目规则',
    content: '文档放在 /doc；后端接口只使用 GET/POST，写操作使用 POST；开发模式需要同时启动 server:3100 和 web:3200。',
    scope: 'project',
    projectPath: 'C:/FengSuKeJi/ai-platform',
    sourceRefs: [{ source: 'system' }],
    confidence: 0.98,
    status: 'active',
    tags: ['项目规则', 'ai-platform'],
    evidenceCount: 1,
    usageCount: 0,
  },
  {
    type: 'source',
    title: 'ZCode 平台',
    content: 'ZCode 是智谱平台的新本地会话来源，应与 Claude Code、Codex 一起进入 Memory Hub，并参与冷库候选、召回和自动化。',
    scope: 'platform',
    platform: 'zcode',
    sourceRefs: [{ source: 'system' }],
    confidence: 0.92,
    status: 'active',
    tags: ['平台', 'zcode', '智谱'],
    aliases: ['智谱 ZCode', 'zcode'],
    evidenceCount: 1,
    usageCount: 0,
  },
];

export function generateMemoryCandidates(options: GenerateMemoryCandidatesOptions = {}) {
  const now = new Date().toISOString();
  const limit = options.limit ?? 80;
  const conversations = filterConversations(loadConversationIndex(), options).slice(0, limit);
  const insights = loadInsights();
  const items: MemoryItem[] = [
    ...GLOBAL_SEEDS.map(seed => toMemoryItem(seed, now)),
    ...insights.flatMap(insight => insightToMemoryItem(insight, conversations, now)),
    ...conversations.flatMap(conv => conversationToMemoryItems(conv, now)),
  ];

  const result = upsertMemoryItems(dedupeItems(items));
  // 候选变化后重建向量索引，保证召回语义准确
  rebuildVectorIndex();
  return result;
}

export async function runMemoryAutomation(
  options: GenerateMemoryCandidatesOptions & { trigger?: MemoryAutomationLog['trigger'] } = {},
): Promise<MemoryAutomationResult> {
  const startedAt = new Date().toISOString();
  try {
    const scan = await scanAllConversations();
    const candidates = generateMemoryCandidates(options);
    const log: MemoryAutomationLog = {
      id: `auto_${Date.now().toString(36)}_${hash(startedAt).slice(0, 6)}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'success',
      trigger: options.trigger || 'api',
      scan,
      candidates,
    };
    addAutomationLog(log);
    return { scan, candidates, log };
  } catch (err: any) {
    const log: MemoryAutomationLog = {
      id: `auto_${Date.now().toString(36)}_${hash(startedAt).slice(0, 6)}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      trigger: options.trigger || 'api',
      error: err?.message || String(err),
    };
    addAutomationLog(log);
    throw err;
  }
}

/** 不同注入目标偏好的记忆类型权重 */
const TARGET_TYPE_WEIGHT: Record<MemoryInjectionLog['target'], Partial<Record<MemoryItemType, number>>> = {
  chat: { term: 1.3, preference: 1.2, project_rule: 1.1, source: 0.9 },
  pipeline: { project_rule: 1.4, workflow: 1.3, decision: 1.2, warning: 1.1 },
  test: { project_rule: 1.2, warning: 1.3, workflow: 1.1 },
  review: { project_rule: 1.3, warning: 1.3, decision: 1.2, preference: 1.1 },
};

export function recallMemory(options: RecallMemoryOptions): MemoryRecallResultWithReasons {
  const query = (options.query || '').trim();
  // limit 优先用调用方传入值，未传则回退配置
  const limit = options.limit ?? getMemoryConfig().recallLimit;
  const target = options.target || 'chat';
  const allowedStatuses: MemoryItemStatus[] = options.includeCandidates
    ? ['active', 'approved', 'candidate']
    : ['active', 'approved'];

  // TF-IDF 语义相似度（一次性算出，供每条记忆复用）
  const semScores = semanticScores(query);
  const typeWeights = TARGET_TYPE_WEIGHT[target] || {};

  const all = loadMemoryItems().filter(item => allowedStatuses.includes(item.status));

  const scored = all
    .map(item => {
      const { score, factors } = scoreMemoryItemRich(item, query, options, target, semScores.get(item.id) || 0, typeWeights);
      return { item, score, factors };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const items = scored.map(entry => entry.item);
  const reasons: RecallReason[] = scored.map(entry => ({
    itemId: entry.item.id,
    score: Math.round(entry.score * 100) / 100,
    factors: entry.factors,
  }));

  if (options.recordUsage !== false) {
    recordMemoryUsage(items.map(item => item.id));
  }

  return {
    query,
    projectPath: options.projectPath,
    platform: options.platform,
    generatedAt: new Date().toISOString(),
    target,
    items,
    reasons,
    bundle: renderRecallBundle(query, items),
  };
}

/**
 * 综合评分：语义相似度 + 关键词命中 + 项目匹配 + 平台匹配 + 类型适配 + 置信度 + 证据数 + 状态。
 * 比旧版 scoreMemoryItem 多了语义分数、target 类型权重、过期惩罚和可解释的 factors。
 */
function scoreMemoryItemRich(
  item: MemoryItem,
  query: string,
  options: RecallMemoryOptions,
  target: MemoryInjectionLog['target'],
  semScore: number,
  typeWeights: Partial<Record<MemoryItemType, number>>,
): { score: number; factors: string[] } {
  const haystack = normalizeText(`${item.title} ${item.content} ${item.tags.join(' ')} ${(item.aliases || []).join(' ')}`);
  const tokens = tokenize(query);
  const factors: string[] = [];
  let score = 0;

  // 1. 语义相似度（TF-IDF 余弦），主信号，权重最高
  if (semScore > 0) {
    score += semScore * 12;
    factors.push(`语义相关 ${Math.round(semScore * 100)}%`);
  }

  // 2. 关键词精确命中（仍是重要信号，尤其对短查询）
  let kwHits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token.length > 2 ? 3 : 1;
      kwHits++;
    }
  }
  if (kwHits > 0) factors.push(`关键词命中 ${kwHits}`);

  // 3. 项目路径匹配
  if (options.projectPath && item.projectPath && normalizePath(options.projectPath).includes(normalizePath(item.projectPath))) {
    score += 8;
    factors.push('同项目');
  }

  // 4. 平台匹配
  if (options.platform && item.platform === options.platform) {
    score += 4;
    factors.push('同平台');
  }

  // 5. target 类型适配
  const tw = typeWeights[item.type];
  if (tw && tw !== 1) {
    score *= tw;
    if (tw > 1) factors.push(`适配${target}`);
  }

  // 6. 作用域与状态
  if (item.scope === 'global') {
    score += 2;
  }
  if (['active', 'approved'].includes(item.status)) {
    score += 3;
  }

  // 7. 置信度与证据
  score += Math.round(item.confidence * 3);
  score += Math.min(3, item.evidenceCount || 0);

  // 8. 过期惩罚：长期未使用且证据少的记忆轻微降权（不删除，留机会）
  if (item.lastUsedAt) {
    const daysSinceUse = (Date.now() - new Date(item.lastUsedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUse > 60 && (item.evidenceCount || 0) <= 1) {
      score *= 0.85;
      factors.push('长期未用');
    }
  }

  return { score, factors };
}

export function transitionMemoryItem(id: string, status: MemoryItemStatus, updates: Partial<MemoryItem> = {}) {
  return updateMemoryItem(id, { ...updates, status });
}

/**
 * 受控编辑记忆条目：只允许改可读字段，绝不改状态/计数/溯源。
 * 改完重新生成 normalizedContent（去重 key 依赖它）。
 * 返回 null 表示条目不存在。
 */
const EDITABLE_FIELDS = ['title', 'content', 'type', 'scope', 'tags', 'aliases', 'confidence', 'projectPath', 'platform'] as const;

export function editMemoryItem(id: string, rawUpdates: Partial<MemoryItem>): MemoryItem | null {
  const existing = getMemoryItemById(id);
  if (!existing) return null;

  const updates: Partial<MemoryItem> = {};
  for (const key of EDITABLE_FIELDS) {
    const value = (rawUpdates as Record<string, unknown>)[key];
    if (value === undefined) continue;

    if (key === 'type') {
      if (typeof value === 'string' && value) updates.type = value as MemoryItemType;
    } else if (key === 'scope') {
      if (typeof value === 'string' && value) updates.scope = value as MemoryItem['scope'];
    } else if (key === 'confidence') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        updates.confidence = Math.min(1, Math.max(0, value));
      }
    } else if (key === 'tags') {
      if (Array.isArray(value)) updates.tags = value.map(v => String(v).trim()).filter(Boolean);
    } else if (key === 'aliases') {
      if (Array.isArray(value)) updates.aliases = value.map(v => String(v).trim()).filter(Boolean);
    } else if (key === 'platform') {
      if (typeof value === 'string' && value) updates.platform = value as MemoryItem['platform'];
    } else if (key === 'projectPath') {
      if (typeof value === 'string' && value) updates.projectPath = value.trim();
    } else {
      // title / content
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) (updates as Record<string, string>)[key] = trimmed;
      }
    }
  }

  // 改了 title/content/type/scope/projectPath/platform 之一就要重算 normalizedContent，
  // 保持去重与召回 haystack 一致
  const needsRenormalize = ['title', 'content', 'type', 'scope', 'projectPath', 'platform'].some(k => k in updates);
  if (needsRenormalize) {
    const merged: MemoryItem = { ...existing, ...updates } as MemoryItem;
    updates.normalizedContent = normalizeText(
      `${merged.type}:${merged.scope}:${merged.projectPath || ''}:${merged.platform || ''}:${merged.title}:${merged.content}`,
    );
  }

  return updateMemoryItem(id, updates);
}

/**
 * 记录一次根 AI 注入，供注入可视化与反馈使用。
 * 由 claude-client 在实际注入后调用。
 */
export function recordInjection(input: {
  request: string;
  projectPath?: string;
  platform?: ConversationSummary['source'];
  memoryIds: string[];
  bundle: string;
  target: MemoryInjectionLog['target'];
}): MemoryInjectionLog {
  const log: MemoryInjectionLog = {
    id: `inj_${Date.now().toString(36)}_${hash(input.bundle || input.request).slice(0, 6)}`,
    request: (input.request || '').slice(0, 500),
    projectPath: input.projectPath,
    platform: input.platform,
    memoryIds: input.memoryIds,
    bundle: input.bundle,
    generatedAt: new Date().toISOString(),
    target: input.target,
  };
  addInjectionLog(log);
  return log;
}

export function exportProjectMemory(projectPath: string, outputFile?: string): { path: string; itemCount: number; content: string } {
  const normalizedProject = normalizePath(projectPath);
  const items = loadMemoryItems()
    .filter(item => ['active', 'approved'].includes(item.status))
    .filter(item => item.scope === 'global' || (item.projectPath && normalizePath(projectPath).includes(normalizePath(item.projectPath))))
    .sort((a, b) => scoreExportItem(b, normalizedProject) - scoreExportItem(a, normalizedProject));

  const content = renderProjectMemory(projectPath, items);
  const filePath = outputFile || path.join(projectPath, 'AGENTS.memory.md');
  fs.writeFileSync(filePath, content, 'utf-8');
  return { path: filePath, itemCount: items.length, content };
}

// ========== Phase 2: LLM 策展 ==========

export interface CuratedMemoryDraft {
  type: MemoryItemType;
  title: string;
  content: string;
  scope: MemoryItem['scope'];
  confidence: number;
  importance?: number;
  tags: string[];
  evidence?: Array<{ conversationId?: string; quote?: string }>;
}

export interface CurateResult {
  conversationId: string;
  drafts: MemoryItem[];
  rawDrafts: number;
  skipped: number;
}

/**
 * 用 DeepSeek 对单条会话做深度策展，把规则策展捕捉不到的偏好/决策/纠偏提取出来。
 * LLM 输出默认进入 candidate 状态，不直接 active。
 */
export async function curateConversation(conversationId: string): Promise<CurateResult> {
  if (!isDeepSeekAvailable()) throw new Error('DeepSeek 未配置，无法进行 LLM 策展');

  const detail = loadConversationDetail(conversationId);
  if (!detail) throw new Error(`会话不存在: ${conversationId}`);

  const conversationText = truncateForCuration(detail.messages, 6000);

  const systemPrompt = `你是一个个人记忆策展专家。请分析以下 AI 编码助手的对话，提取值得长期记住的用户记忆。

严格按 JSON 数组输出，每个元素包含：
- type: 类型，必须是 term（术语）| preference（偏好）| project_rule（项目规则）| workflow（工作流）| decision（决策）| warning（纠偏/避坑）| skill（可复用技能）之一
- title: 简短标题（中文，<=30字）
- content: 完整内容（中文，说明这条记忆是什么、为什么重要）
- scope: global（全局）| project（项目级）| platform（平台级）
- confidence: 置信度 0~1（明确表达>0.85，推断 0.6~0.8）
- importance: 重要性 0~1
- tags: 标签数组
- evidence: 证据数组，每项含 quote（原文片段）

只输出 JSON 数组，不要其他内容。无值得提取的内容输出 []。

注意：
- 过滤敏感信息（密钥、token、密码、内部 IP）。
- 只提取稳定的、可复用的记忆，不要提取临时性任务细节。
- 用户明确表达的偏好/规则优先级高于 AI 推断。`;

  const userPrompt = `对话标题：${detail.title}\n来源：${detail.source}\n项目：${detail.projectPath || 'unknown'}\n\n对话内容：\n${conversationText}`;

  const response = await chatWithDeepSeek(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.2, maxTokens: 2500 },
  );

  const rawDrafts = parseCuratedDrafts(response.content);
  const now = new Date().toISOString();
  const validTypes: MemoryItemType[] = ['term', 'preference', 'project_rule', 'workflow', 'decision', 'entity', 'skill', 'warning', 'source'];

  const items: MemoryItem[] = rawDrafts
    .filter(d => d.title && d.content && validTypes.includes(d.type))
    .map(d => toMemoryItem({
      type: d.type,
      title: sanitizeText(d.title).slice(0, 80),
      content: sanitizeText(d.content).slice(0, 500),
      scope: d.scope || 'global',
      projectPath: detail.projectPath,
      platform: detail.source,
      sourceRefs: [{
        source: detail.source,
        conversationId: detail.id,
      }],
      confidence: clamp(d.confidence, 0, 1),
      status: 'candidate', // LLM 产物一律候选，需人工审核
      tags: Array.isArray(d.tags) ? d.tags.slice(0, 8).map(t => sanitizeText(String(t))).filter(Boolean) : [],
      evidenceCount: 1,
      usageCount: 0,
    }, now));

  const upserted = items.length > 0 ? upsertMemoryItems(items) : { created: 0, updated: 0, skipped: 0 };
  if (items.length > 0) rebuildVectorIndex();

  return {
    conversationId,
    drafts: items,
    rawDrafts: rawDrafts.length,
    skipped: rawDrafts.length - items.length,
  };
}

/**
 * 批量策展：对最近 N 条会话依次策展。
 * 用于自动化或手动一键深度策展。
 */
export async function curateBatch(options: { limit?: number; projectPath?: string; source?: ConversationSummary['source'] | 'all' } = {}): Promise<{
  total: number;
  curated: number;
  draftsCreated: number;
  results: CurateResult[];
}> {
  if (!isDeepSeekAvailable()) throw new Error('DeepSeek 未配置，无法进行 LLM 策展');

  const limit = Math.min(options.limit ?? 10, 30); // 单批上限 30，控制 API 成本
  const conversations = filterConversations(loadConversationIndex(), {
    limit,
    source: options.source,
    projectPath: options.projectPath,
  }).slice(0, limit);

  const results: CurateResult[] = [];
  let draftsCreated = 0;

  for (const conv of conversations) {
    try {
      const result = await curateConversation(conv.id);
      results.push(result);
      draftsCreated += result.drafts.length;
    } catch (err: any) {
      console.warn(`[Memory] curate ${conv.id} failed: ${err?.message || err}`);
      results.push({ conversationId: conv.id, drafts: [], rawDrafts: 0, skipped: 0 });
    }
  }

  return {
    total: conversations.length,
    curated: results.filter(r => r.drafts.length > 0).length,
    draftsCreated,
    results,
  };
}

/** 截取对话用于策展（保留 user/assistant 文本，跳过 tool_result 和 system） */
function truncateForCuration(messages: Array<{ role: string; contentType?: string; content: string; toolName?: string }>, maxChars = 6000): string {
  const selected: string[] = [];
  let total = 0;
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.contentType === 'tool_result') continue;
    let text = '';
    if (msg.role === 'user') {
      text = `[用户]: ${msg.content}`;
    } else if (msg.contentType === 'tool_use') {
      text = `[工具]: ${msg.toolName || ''}`;
    } else {
      text = `[助手]: ${msg.content}`;
    }
    if (total + text.length > maxChars) {
      text = text.slice(0, maxChars - total) + '...';
    }
    selected.push(text);
    total += text.length;
    if (total >= maxChars) break;
  }
  return selected.join('\n\n');
}

function parseCuratedDrafts(text: string): CuratedMemoryDraft[] {
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed as CuratedMemoryDraft[];
  } catch {
    return [];
  }
}

function clamp(value: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function sanitizeText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** 导出向量索引状态，供路由/前端展示 */
export function getMemoryVectorStatus() {
  return getVectorIndexStatus();
}

// ========== 概览统计 ==========

export interface MemoryOverview {
  totals: {
    total: number;
    recallable: number;          // 活跃+已通过
    candidate: number;
    weeklyInjections: number;
    avgHitPerInjection: number;
  };
  /** 按类型分组的活跃记忆（AI 知识库全景） */
  knowledgeByType: Record<string, MemoryItem[]>;
  topUsed: MemoryItem[];          // 高频使用 Top 5
  dormant: MemoryItem[];          // 沉睡（从未召回的活跃记忆）
  topPositiveFeedback: Array<{ item: MemoryItem; usefulCount: number }>;
  distribution: {
    byType: Record<string, number>;
    byScope: Record<string, number>;
    bySource: Record<string, number>;
    byStatus: Record<string, number>;
  };
  /** AGENTS.memory.md 产物预览（前若干行） */
  exportPreview: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 构建冷库概览：回答"我的冷库有价值吗、AI 知道我什么"。
 * 从已有数据聚合，不产生副作用。
 */
export function buildMemoryOverview(projectPath?: string): MemoryOverview {
  const items = loadMemoryItems();
  const injections = loadInjections();
  const now = Date.now();

  // 可召回 = 活跃 + 已通过
  const recallable = items.filter(i => i.status === 'active' || i.status === 'approved');
  const candidates = items.filter(i => i.status === 'candidate');

  // 注入活力统计
  const weeklyInjections = injections.filter(
    inj => now - new Date(inj.generatedAt).getTime() < WEEK_MS,
  );
  const totalHits = injections.reduce((sum, inj) => sum + (inj.memoryIds?.length || 0), 0);
  const avgHit = injections.length ? Math.round((totalHits / injections.length) * 10) / 10 : 0;

  // 按类型分组的活跃记忆（知识库全景）
  const knowledgeByType: Record<string, MemoryItem[]> = {};
  for (const item of recallable) {
    const key = item.type;
    (knowledgeByType[key] = knowledgeByType[key] || []).push(item);
  }
  // 每组按使用次数降序
  for (const key of Object.keys(knowledgeByType)) {
    knowledgeByType[key].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
  }

  // 高频使用 Top 5
  const topUsed = [...recallable]
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
    .slice(0, 5);

  // 沉睡记忆：可召回但从未使用（按创建时间，最近的排前，提示可能该删）
  const dormant = recallable
    .filter(i => !i.usageCount)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  // 正反馈榜：统计每条记忆在注入记录里被标 useful 的次数
  const usefulCountMap = new Map<string, number>();
  for (const inj of injections) {
    if (inj.feedback !== 'useful') continue;
    for (const id of inj.memoryIds || []) {
      usefulCountMap.set(id, (usefulCountMap.get(id) || 0) + 1);
    }
  }
  const itemById = new Map(items.map(i => [i.id, i]));
  const topPositiveFeedback = Array.from(usefulCountMap.entries())
    .map(([id, count]) => ({ item: itemById.get(id), usefulCount: count }))
    .filter((entry): entry is { item: MemoryItem; usefulCount: number } => !!entry.item)
    .sort((a, b) => b.usefulCount - a.usefulCount)
    .slice(0, 5);

  // 分布统计
  const countBy = (arr: MemoryItem[], keyFn: (i: MemoryItem) => string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const i of arr) {
      const k = keyFn(i);
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  };
  const distribution = {
    byType: countBy(items, i => i.type),
    byScope: countBy(items, i => i.scope),
    bySource: countBy(items, i => i.platform || i.sourceRefs[0]?.source || 'unknown'),
    byStatus: countBy(items, i => i.status),
  };

  // 产物预览
  let exportPreview = '';
  try {
    const rendered = renderProjectMemory(projectPath || 'C:/FengSuKeJi/ai-platform', recallable);
    exportPreview = rendered.split('\n').slice(0, 40).join('\n');
  } catch {
    exportPreview = '(暂无可预览的产物)';
  }

  return {
    totals: {
      total: items.length,
      recallable: recallable.length,
      candidate: candidates.length,
      weeklyInjections: weeklyInjections.length,
      avgHitPerInjection: avgHit,
    },
    knowledgeByType,
    topUsed,
    dormant,
    topPositiveFeedback,
    distribution,
    exportPreview,
  };
}

// ========== 智能筛选 ==========

export type FilterSuggestion = 'approve' | 'reject' | 'review';

export interface SmartFilterResult {
  items: Array<{ id: string; suggestion: FilterSuggestion; reason: string }>;
  summary: {
    approve: number;
    reject: number;
    review: number;
    total: number;
  };
  mode: 'rule' | 'llm';
}

const APPROVE_THRESHOLD = 0.85;
const REJECT_THRESHOLD = 0.6;

/** 临时性/无价值内容的判别关键词（规则版用来辅助识别"该拒绝"的候选） */
const TRIVIAL_PATTERNS = [
  /第\s*\d+\s*行/, /line\s*\d+/i,
  /临时/, /先这样/, /随便/, /测试用/,
  /把.*改成/, /替换为/, /删除.*行/,
];

/**
 * 智能筛选候选记忆：按置信度 + 内容启发式快速分类。
 * - 置信度 ≥ 0.85 → 建议通过
 * - 置信度 < 0.6 → 建议拒绝
 * - 0.6~0.85 → 需确认
 * mode='llm' 时额外调 DeepSeek 做语义判断（稳定可复用 vs 临时细节）。
 */
export async function smartFilterCandidates(mode: 'rule' | 'llm' = 'rule'): Promise<SmartFilterResult> {
  const candidates = loadMemoryItems().filter(i => i.status === 'candidate');
  const results: SmartFilterResult['items'] = [];

  // LLM 模式：先批量评估，拿回语义判断
  let llmVerdicts: Map<string, { keep: boolean; reason: string }> = new Map();
  if (mode === 'llm' && isDeepSeekAvailable() && candidates.length > 0) {
    try {
      llmVerdicts = await llmFilterCandidates(candidates);
    } catch (err: any) {
      console.warn('[Memory] LLM 筛选失败，回退规则模式:', err?.message || err);
      mode = 'rule';
    }
  }

  for (const item of candidates) {
    let suggestion: FilterSuggestion;
    let reason: string;

    const llm = llmVerdicts.get(item.id);
    if (llm) {
      suggestion = llm.keep ? 'approve' : 'reject';
      reason = llm.reason;
    } else {
      // 规则版：置信度为主，内容启发式辅助
      const isTrivial = TRIVIAL_PATTERNS.some(re => re.test(item.title + ' ' + item.content));
      if (isTrivial) {
        suggestion = 'reject';
        reason = '内容偏临时性/具体操作，不像可复用记忆';
      } else if (item.confidence >= APPROVE_THRESHOLD) {
        suggestion = 'approve';
        reason = `置信度 ${Math.round(item.confidence * 100)}%，内容稳定`;
      } else if (item.confidence < REJECT_THRESHOLD) {
        suggestion = 'reject';
        reason = `置信度 ${Math.round(item.confidence * 100)}% 偏低，推断过度`;
      } else {
        suggestion = 'review';
        reason = `置信度 ${Math.round(item.confidence * 100)}%，需人工判断`;
      }
    }

    results.push({ id: item.id, suggestion, reason });
  }

  const summary = {
    approve: results.filter(r => r.suggestion === 'approve').length,
    reject: results.filter(r => r.suggestion === 'reject').length,
    review: results.filter(r => r.suggestion === 'review').length,
    total: results.length,
  };

  return { items: results, summary, mode };
}

/**
 * 批量应用智能筛选建议：把"建议通过"全 approved、"建议拒绝"全 rejected。
 * 用户可指定只应用某种建议（避免全盘接受）。
 */
export function applyFilterSuggestions(
  suggestions: Array<{ id: string; action: 'approve' | 'reject' }>,
): { applied: number; results: MemoryItem[] } {
  const statusMap = { approve: 'approved' as MemoryItemStatus, reject: 'rejected' as MemoryItemStatus };
  const results: MemoryItem[] = [];
  for (const { id, action } of suggestions) {
    const item = transitionMemoryItem(id, statusMap[action]);
    if (item) results.push(item);
  }
  return { applied: results.length, results };
}

/** 用 DeepSeek 对候选做语义判断：是否值得作为长期记忆保留 */
async function llmFilterCandidates(candidates: MemoryItem[]): Promise<Map<string, { keep: boolean; reason: string }>> {
  // 控制成本：每批最多 20 条
  const batch = candidates.slice(0, 20);
  const compact = batch.map((c, i) => ({
    i,
    type: c.type,
    title: c.title,
    content: c.content.slice(0, 200),
    confidence: c.confidence,
  }));

  const systemPrompt = `你是一个个人记忆质量审核员。判断每条候选记忆是否值得作为长期记忆保留。

判断标准：
- 保留(keep=true)：稳定、可复用的偏好/规则/术语/决策/工作流，跨任务有价值
- 拒绝(keep=false)：临时性任务细节、具体代码行修改、无重复价值的内容、过度推断

严格按 JSON 数组输出，每项：{ "i": 序号, "keep": true/false, "reason": "简短中文理由" }
只输出 JSON 数组。`;

  const response = await chatWithDeepSeek(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(compact, null, 2) },
    ],
    { temperature: 0.1, maxTokens: 1500 },
  );

  const verdicts = new Map<string, { keep: boolean; reason: string }>();
  try {
    const match = response.content.match(/\[[\s\S]*\]/);
    if (!match) return verdicts;
    const parsed = JSON.parse(match[0]) as Array<{ i: number; keep: boolean; reason: string }>;
    for (const v of parsed) {
      const item = batch[v.i];
      if (item) verdicts.set(item.id, { keep: !!v.keep, reason: v.reason || '' });
    }
  } catch {
    /* 解析失败返回空 map，回退到规则判断 */
  }
  return verdicts;
}

// ========== Phase 5: 跨工作流记忆上下文 ==========

/**
 * 为 Pipeline / Test / Review 等工作流构建记忆上下文文本。
 * 与 Chat 注入不同：这里按 target 召回不同策略的记忆，
 * 失败静默返回空串（绝不阻断主工作流）。
 *
 * 返回可直接拼接到提示词的 Markdown 片段（含标题），无记忆时返回空串。
 */
export function buildWorkflowMemoryContext(
  target: MemoryInjectionLog['target'],
  query: string,
  projectPath?: string,
): string {
  try {
    const config = getMemoryConfig();
    if (!config.autoInject) return '';

    const result = recallMemory({
      query,
      projectPath,
      limit: Math.min(config.recallLimit, 8), // 工作流注入更克制
      includeCandidates: config.includeCandidatesInRecall,
      recordUsage: true,
      target,
    });
    if (!result.items.length) return '';

    // 落注入日志，让工作流注入也可追溯
    try {
      const maxChars = Math.max(0, config.maxInjectionTokens) * 4;
      const bundle = maxChars > 0 && result.bundle.length > maxChars ? result.bundle.slice(0, maxChars) : result.bundle;
      recordInjection({
        request: query,
        projectPath,
        memoryIds: result.items.map(item => item.id),
        bundle,
        target,
      });
    } catch {
      /* 注入日志失败不影响工作流 */
    }

    return [
      '',
      '## 个人记忆上下文（来自冷库召回）',
      '以下记忆作为背景参考。当前任务需求和现有代码优先级更高，记忆与之冲突时以需求和代码为准。',
      '',
      result.bundle,
    ].join('\n');
  } catch (err: any) {
    console.warn(`[Memory] workflow ${target} injection skipped:`, err?.message || err);
    return '';
  }
}

function filterConversations(conversations: ConversationSummary[], options: GenerateMemoryCandidatesOptions) {
  return conversations
    .filter(conv => !options.source || options.source === 'all' || conv.source === options.source)
    .filter(conv => !options.projectPath || normalizePath(conv.projectPath).includes(normalizePath(options.projectPath)))
    .sort((a, b) => (b.lastActivityAt || b.importedAt || '').localeCompare(a.lastActivityAt || a.importedAt || ''));
}

function conversationToMemoryItems(conv: ConversationSummary, now: string): MemoryItem[] {
  const items: MemoryItem[] = [];
  const text = `${conv.title}\n${conv.summary || ''}`.toLowerCase();

  if (conv.source === 'zcode') {
    items.push(toMemoryItem({
      type: 'source',
      title: `ZCode 会话来源：${shortProject(conv.projectPath)}`,
      content: `ZCode 已在 ${conv.projectPath || 'unknown project'} 产生会话，可作为智谱平台经验和项目上下文的来源。`,
      scope: 'platform',
      projectPath: conv.projectPath,
      platform: 'zcode',
      sourceRefs: [{ source: conv.source, conversationId: conv.id }],
      confidence: 0.78,
      status: 'candidate',
      tags: ['zcode', '平台来源'],
      evidenceCount: 1,
      usageCount: 0,
    }, now));
  }

  if (text.includes('agents') || text.includes('项目规则') || text.includes('get/post')) {
    items.push(toMemoryItem({
      type: 'project_rule',
      title: `${shortProject(conv.projectPath)} 的项目规则线索`,
      content: conv.summary || `该会话可能包含 ${shortProject(conv.projectPath)} 的项目规则或约束，需要确认后固化。`,
      scope: 'project',
      projectPath: conv.projectPath,
      sourceRefs: [{ source: conv.source, conversationId: conv.id }],
      confidence: conv.summary ? 0.74 : 0.58,
      status: 'candidate',
      tags: ['项目规则', shortProject(conv.projectPath)],
      evidenceCount: 1,
      usageCount: 0,
    }, now));
  }

  if (containsAny(text, ['希望', '不满意', '偏好', '差点意思', '全权交给你', '自由改造', '深入'])) {
    const detail = loadConversationDetail(conv.id);
    const userSignal = detail?.messages
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content)
      .find(content => containsAny(content, ['希望', '不满意', '偏好', '差点意思', '全权交给你', '自由改造', '深入']));
    items.push(toMemoryItem({
      type: 'preference',
      title: '用户表达出的协作偏好',
      content: summarizeSignal(userSignal || conv.summary || conv.title),
      scope: 'global',
      sourceRefs: [{ source: conv.source, conversationId: conv.id }],
      confidence: userSignal ? 0.8 : 0.64,
      status: 'candidate',
      tags: ['偏好', '协作方式'],
      evidenceCount: 1,
      usageCount: 0,
    }, now));
  }

  return items;
}

function insightToMemoryItem(insight: MemoryInsight, conversations: ConversationSummary[], now: string): MemoryItem[] {
  const conv = conversations.find(item => item.id === insight.sourceConversationId);
  const typeMap: Record<MemoryInsight['type'], MemoryItemType> = {
    preference: 'preference',
    pattern: 'workflow',
    correction: 'warning',
    knowledge: 'project_rule',
    'skill-idea': 'skill',
  };

  return [toMemoryItem({
    type: typeMap[insight.type],
    title: insightTitle(insight.type),
    content: insight.content,
    scope: conv?.projectPath ? 'project' : 'global',
    projectPath: conv?.projectPath,
    platform: conv?.source,
    sourceRefs: [{ source: 'insight', insightId: insight.id, conversationId: insight.sourceConversationId }],
    confidence: insight.confidence,
    status: insight.confidence >= 0.88 ? 'approved' : 'candidate',
    tags: ['洞察', insight.type],
    evidenceCount: 1,
    usageCount: 0,
  }, now)];
}

function toMemoryItem(seed: Omit<MemoryItem, 'id' | 'normalizedContent' | 'createdAt' | 'updatedAt'>, now: string): MemoryItem {
  const normalizedContent = normalizeText(`${seed.type}:${seed.scope}:${seed.projectPath || ''}:${seed.platform || ''}:${seed.title}:${seed.content}`);
  return {
    ...seed,
    id: `mem_${hash(normalizedContent).slice(0, 16)}`,
    normalizedContent,
    createdAt: now,
    updatedAt: now,
  };
}

function dedupeItems(items: MemoryItem[]): MemoryItem[] {
  const map = new Map<string, MemoryItem>();
  for (const item of items) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      continue;
    }
    existing.evidenceCount += item.evidenceCount || 1;
    existing.sourceRefs.push(...item.sourceRefs);
    existing.confidence = Math.max(existing.confidence, item.confidence);
  }
  return Array.from(map.values());
}

function renderRecallBundle(query: string, items: MemoryItem[]): string {
  const groups = groupBy(items, item => item.type);
  const sections = Object.entries(groups).map(([type, group]) => {
    const lines = group.map(item => `- ${item.title}: ${item.content}`);
    return `## ${memoryTypeLabel(type as MemoryItemType)}\n${lines.join('\n')}`;
  });

  return [
    '# Personal Memory Context',
    '',
    `## Current Request`,
    query || '(empty)',
    '',
    ...sections.flatMap(section => [section, '']),
    '## Usage Rules',
    '- Use these memories as context, not as a replacement for the latest user instruction.',
    '- If memory conflicts with current code or explicit user input, prefer the current code and latest instruction.',
  ].join('\n');
}

function renderProjectMemory(projectPath: string, items: MemoryItem[]): string {
  const groups = groupBy(items, item => item.type);
  const sections = Object.entries(groups).map(([type, group]) => {
    const lines = group.map(item => `- ${item.title}: ${item.content}`);
    return `## ${memoryTypeLabel(type as MemoryItemType)}\n${lines.join('\n')}`;
  });
  return [
    '# Project Memory Context',
    '',
    `Project: ${projectPath}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    'This file is generated from the local Memory Hub. Treat it as long-lived context, while still preferring current user instructions and current code when conflicts appear.',
    '',
    ...sections.flatMap(section => [section, '']),
  ].join('\n');
}

function scoreExportItem(item: MemoryItem, normalizedProject: string) {
  let score = item.scope === 'global' ? 3 : 0;
  if (item.projectPath && normalizedProject.includes(normalizePath(item.projectPath))) score += 8;
  score += Math.round(item.confidence * 4);
  score += Math.min(3, item.evidenceCount || 0);
  return score;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = keyFn(item);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
}

function memoryTypeLabel(type: MemoryItemType): string {
  const labels: Record<MemoryItemType, string> = {
    term: 'User Terms',
    preference: 'User Preferences',
    project_rule: 'Project Rules',
    workflow: 'Workflows',
    decision: 'Past Decisions',
    entity: 'Entities',
    skill: 'Reusable Skills',
    warning: 'Warnings',
    source: 'Platform Sources',
  };
  return labels[type];
}

function insightTitle(type: MemoryInsight['type']) {
  const labels: Record<MemoryInsight['type'], string> = {
    preference: '用户偏好',
    pattern: '工作模式',
    correction: '纠偏提醒',
    knowledge: '项目知识',
    'skill-idea': '可复用 Skill 想法',
  };
  return labels[type];
}

function containsAny(text: string, words: string[]) {
  return words.some(word => text.includes(word.toLowerCase()));
}

function summarizeSignal(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function tokenize(text: string) {
  return normalizeText(text)
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter(token => token.length >= 2);
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizePath(text: string) {
  return text.replace(/\\/g, '/').toLowerCase();
}

function shortProject(projectPath?: string) {
  if (!projectPath) return 'unknown';
  const parts = projectPath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || projectPath;
}

function hash(input: string) {
  return crypto.createHash('sha1').update(input).digest('hex');
}
