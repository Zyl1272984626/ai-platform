/**
 * 接力流水线 trace 记录（P3 审计追踪）
 *
 * 纯增量、无副作用：记录提示词生成、阶段标记变更、执行器调用、产物依赖、最终决策。
 * 让「平台做了什么、为什么这么做」可解释、可回溯。
 *
 * 存储结构：
 *   server/data/pipeline-traces/{runId}.json   # 每条 run 一个 trace 文件，事件数组
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AI_PLATFORM_ROOT } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(AI_PLATFORM_ROOT, 'data');
const TRACE_DIR = path.join(DATA_ROOT, 'pipeline-traces');

/** trace 事件类型，覆盖交接文档 P3 列出的 5 类动作 */
export type TraceEventType =
  | 'prompt-generated'      // 提示词生成（阶段提示词/总控/续跑/导出 SKILL）
  | 'stage-mark-changed'    // 阶段标记变更（working/rework/accepted）
  | 'executor-called'       // 执行器调用（DeepSeek / Shell 自构建）
  | 'artifact-dependency'   // 产物依赖关系（本阶段读取了哪些前序产物）
  | 'final-decision';       // 最终交付决策（人工通过 / 打回 / 交付摘要）

export interface TraceEvent {
  id: string;
  runId: string;
  type: TraceEventType;
  /** 动作发起者：platform(自动) / user(人工) / executor */
  actor: 'platform' | 'user' | 'executor';
  /** ISO 时间戳 */
  timestamp: string;
  /** 人类可读摘要 */
  summary: string;
  /** 结构化详情（按事件类型不同） */
  detail: Record<string, unknown>;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 将 runId 规整为安全文件名（与 pipeline-engine 的 sanitizeRunId 对齐） */
function safeTraceFile(runId: string): string {
  return path.join(TRACE_DIR, `${runId.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}.json`);
}

function loadTraceFile(runId: string): TraceEvent[] {
  const filePath = safeTraceFile(runId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveTraceFile(runId: string, events: TraceEvent[]): void {
  ensureDir(TRACE_DIR);
  fs.writeFileSync(safeTraceFile(runId), JSON.stringify(events, null, 2), 'utf-8');
}

/** 生成短 id（时间 + 随机后缀） */
function genId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 追加一条 trace 事件。幂等：runId 不存在会自动创建文件。
 * 所有字段都做了 nullish 兜底，保证 trace 记录失败不会阻断主流程。
 */
export function appendTrace(event: Omit<TraceEvent, 'id' | 'timestamp'> & { timestamp?: string }): TraceEvent {
  const fullEvent: TraceEvent = {
    id: genId(),
    timestamp: event.timestamp || new Date().toISOString(),
    ...event,
  };
  try {
    const events = loadTraceFile(fullEvent.runId);
    events.push(fullEvent);
    saveTraceFile(fullEvent.runId, events);
  } catch (err) {
    // trace 是审计附属，失败只记日志，不抛错
    console.warn(`[PipelineTrace] append failed for ${fullEvent.runId}:`, (err as Error)?.message || err);
  }
  return fullEvent;
}

/** 读取单条 run 的全部 trace 事件（按时间升序） */
export function listTraceEvents(runId: string): TraceEvent[] {
  return loadTraceFile(runId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** 列出所有有 trace 记录的 run（用于 trace 总览） */
export function listTraceRuns(): Array<{
  runId: string;
  eventCount: number;
  lastEventAt: string;
  firstEventAt: string;
  types: TraceEventType[];
}> {
  if (!fs.existsSync(TRACE_DIR)) return [];
  const runs: Array<{ runId: string; eventCount: number; lastEventAt: string; firstEventAt: string; types: TraceEventType[] }> = [];
  for (const file of fs.readdirSync(TRACE_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const events = JSON.parse(fs.readFileSync(path.join(TRACE_DIR, file), 'utf-8')) as TraceEvent[];
      if (!Array.isArray(events) || events.length === 0) continue;
      const timestamps = events.map(e => e.timestamp).sort();
      runs.push({
        runId: file.replace(/\.json$/, ''),
        eventCount: events.length,
        firstEventAt: timestamps[0],
        lastEventAt: timestamps[timestamps.length - 1],
        types: [...new Set(events.map(e => e.type))],
      });
    } catch {
      // 损坏的 trace 文件跳过
    }
  }
  return runs.sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));
}

/** 删除单条 run 的全部 trace（与 deleteRelayRun 配套） */
export function deleteTrace(runId: string): boolean {
  const filePath = safeTraceFile(runId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// ========== 便捷构造器：让调用方少写样板 ==========

export function tracePromptGenerated(runId: string, summary: string, detail: Record<string, unknown>): TraceEvent {
  return appendTrace({ runId, type: 'prompt-generated', actor: 'platform', summary, detail });
}

export function traceStageMarkChanged(runId: string, summary: string, detail: Record<string, unknown>): TraceEvent {
  return appendTrace({ runId, type: 'stage-mark-changed', actor: 'user', summary, detail });
}

export function traceExecutorCalled(runId: string, summary: string, detail: Record<string, unknown>, actor: 'executor' | 'platform' = 'executor'): TraceEvent {
  return appendTrace({ runId, type: 'executor-called', actor, summary, detail });
}

export function traceArtifactDependency(runId: string, summary: string, detail: Record<string, unknown>): TraceEvent {
  return appendTrace({ runId, type: 'artifact-dependency', actor: 'platform', summary, detail });
}

export function traceFinalDecision(runId: string, summary: string, detail: Record<string, unknown>): TraceEvent {
  return appendTrace({ runId, type: 'final-decision', actor: 'user', summary, detail });
}
