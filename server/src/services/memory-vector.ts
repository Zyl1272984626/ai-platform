/**
 * 冷库 TF-IDF 向量索引
 *
 * 纯本地实现，零外部依赖、零 API 调用。
 * - 中文：复用 memory-curator 的 tokenize（保留 CJK 字符，按非字母数字汉字切分）
 * - 英文：同一切分器
 * - 相似度：余弦相似度
 *
 * 设计目标：在不引入 embedding API 的前提下，把召回从“纯关键词命中”升级为
 * “语义相关度”，让“偏好深入方案”也能在用户说“我要一份有说服力的设计”时被召回。
 *
 * 索引文件：server/data/memory/vectors/index.json
 * 结构：{ items: [{ id, docFreq, mag, vec: { token: tfidf } }] , documentCount, builtAt }
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadMemoryItems, type MemoryItem } from './memory-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.resolve(__dirname, '../../data/memory');
const VECTORS_DIR = path.join(MEMORY_DIR, 'vectors');
const INDEX_FILE = path.join(VECTORS_DIR, 'index.json');

// ========== 分词（与 memory-curator 保持一致） ==========

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter(token => token.length >= 2);
}

// ========== 向量结构 ==========

interface DocVector {
  id: string;
  /** 每个文档的 TF-IDF 向量（稀疏表示：token -> weight） */
  vec: Record<string, number>;
  /** 向量模长，余弦相似度分母用 */
  mag: number;
}

interface VectorIndex {
  /** 所有文档的向量 */
  docs: DocVector[];
  /** 整个语料的文档频率：token 在多少篇文档出现过 */
  docFreq: Record<string, number>;
  /** 文档总数 */
  documentCount: number;
  builtAt: string;
}

const EMPTY_INDEX: VectorIndex = { docs: [], docFreq: {}, documentCount: 0, builtAt: '' };

// ========== 索引构建 ==========

/** 取一条记忆的可索引文本（标题权重最高，其次内容、标签、别名） */
function itemToDocText(item: MemoryItem): string {
  // 标题重复 3 次以提升权重，标签/别名各重复 2 次
  const titleBoost = [item.title, item.title, item.title].join(' ');
  const tagBoost = (item.tags || []).join(' ').repeat(2);
  const aliasBoost = (item.aliases || []).join(' ').repeat(2);
  return `${titleBoost} ${item.content} ${tagBoost} ${aliasBoost}`;
}

function buildIndex(items: MemoryItem[]): VectorIndex {
  const docs: DocVector[] = [];
  const docFreq: Record<string, number> = {};
  const docTokens: string[][] = [];

  // 第一遍：分词 + 统计文档频率
  for (const item of items) {
    const tokens = tokenize(itemToDocText(item));
    const uniqueTokens = Array.from(new Set(tokens));
    for (const token of uniqueTokens) {
      docFreq[token] = (docFreq[token] || 0) + 1;
    }
    docTokens.push(tokens);
  }

  const N = items.length;

  // 第二遍：计算每篇文档的 TF-IDF 向量
  for (let i = 0; i < items.length; i++) {
    const tokens = docTokens[i];
    const tf: Record<string, number> = {};
    for (const token of tokens) {
      tf[token] = (tf[token] || 0) + 1;
    }

    const vec: Record<string, number> = {};
    let sumSq = 0;
    for (const [token, freq] of Object.entries(tf)) {
      // TF：1 + log(freq)，避免长文档压制；IDF：log(N / df)
      const df = docFreq[token] || 1;
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      const weight = (1 + Math.log(freq)) * idf;
      vec[token] = weight;
      sumSq += weight * weight;
    }

    docs.push({
      id: items[i].id,
      vec,
      mag: Math.sqrt(sumSq) || 1,
    });
  }

  return { docs, docFreq, documentCount: N, builtAt: new Date().toISOString() };
}

// ========== 索引持久化 ==========

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let cachedIndex: VectorIndex | null = null;

function persist(index: VectorIndex): void {
  ensureDir(VECTORS_DIR);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index), 'utf-8');
  cachedIndex = index;
}

function loadFromDisk(): VectorIndex {
  try {
    if (fs.existsSync(INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')) as VectorIndex;
    }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_INDEX };
}

/** 重建向量索引（全量）。调用时机：候选生成后、编辑/删除后、手动触发。 */
export function rebuildVectorIndex(): { documentCount: number; builtAt: string } {
  const items = loadMemoryItems();
  const index = buildIndex(items);
  persist(index);
  return { documentCount: index.documentCount, builtAt: index.builtAt };
}

/** 获取当前索引（带内存缓存，避免每次召回都读盘） */
export function getVectorIndex(): VectorIndex {
  if (cachedIndex) return cachedIndex;
  cachedIndex = loadFromDisk();
  return cachedIndex;
}

export function getVectorIndexStatus() {
  const index = getVectorIndex();
  return {
    documentCount: index.documentCount,
    builtAt: index.builtAt,
    hasIndex: index.documentCount > 0,
  };
}

// ========== 查询向量化与相似度 ==========

/** 把查询文本转成与索引同空间的 TF-IDF 向量（用索引的 docFreq 计算 IDF） */
function queryToVector(query: string, index: VectorIndex): { vec: Record<string, number>; mag: number } {
  const tokens = tokenize(query);
  const tf: Record<string, number> = {};
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }

  const N = index.documentCount || 1;
  const vec: Record<string, number> = {};
  let sumSq = 0;
  for (const [token, freq] of Object.entries(tf)) {
    const df = index.docFreq[token] || 1;
    const idf = Math.log((N + 1) / (df + 1)) + 1;
    const weight = (1 + Math.log(freq)) * idf;
    vec[token] = weight;
    sumSq += weight * weight;
  }
  return { vec, mag: Math.sqrt(sumSq) || 1 };
}

function cosineSimilarity(
  queryVec: Record<string, number>,
  queryMag: number,
  doc: DocVector,
): number {
  if (queryMag === 0 || doc.mag === 0) return 0;
  let dot = 0;
  // 遍历较短的向量
  const qKeys = Object.keys(queryVec);
  const dVec = doc.vec;
  for (const key of qKeys) {
    const dw = dVec[key];
    if (dw !== undefined) dot += queryVec[key] * dw;
  }
  return dot / (queryMag * doc.mag);
}

/**
 * 语义相似度召回：返回每篇文档与查询的余弦相似度（0~1）。
 * 调用方通常会与关键词命中、项目匹配等分数加权融合。
 */
export function semanticScores(query: string): Map<string, number> {
  const index = getVectorIndex();
  const scores = new Map<string, number>();
  if (index.documentCount === 0) return scores;

  const { vec: queryVec, mag: queryMag } = queryToVector(query, index);
  for (const doc of index.docs) {
    const sim = cosineSimilarity(queryVec, queryMag, doc);
    if (sim > 0) scores.set(doc.id, sim);
  }
  return scores;
}
