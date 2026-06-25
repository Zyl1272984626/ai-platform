/**
 * 接力上下文同步（每个 run 独立 CONTEXT.md，多任务隔离）
 *
 * 设计变更（2026-06-23）：
 * 旧方案把上下文写进全局 AGENTS.md —— 多任务会互相覆盖，已废弃。
 * 新方案：每个 run 的产物目录里放一个 CONTEXT.md，跟产物一起归档，多任务天然隔离。
 *
 * MCP server 是主通道（ZCode 配置后自动获取任务），
 * CONTEXT.md 是兜底（MCP 不可用时手动指给 AI 读）。
 *
 * 绝不碰全局 AGENTS.md。
 */
import fs from 'fs';
import path from 'path';
import { getConfig } from './config.js';
import { recallMemory } from './memory-curator.js';
import {
  getRelayRunDir,
  getRelayStages,
  sanitizeRunId,
  type BaseEngine,
  type PipelineRelayStage,
} from './pipeline-engine.js';

const CONTEXT_FILENAME = 'CONTEXT.md';

/** 单个阶段的进度判定 */
export type StageProgress = 'done' | 'current' | 'pending';

export interface RelayStageStatus {
  index: number;
  id: string;
  name: string;
  ownerLabel: string;
  purpose: string;
  artifactFile: string;
  artifactPath: string;
  exists: boolean;
  quality: 'missing' | 'weak' | 'ok';
  stageMark?: 'working' | 'rework' | 'accepted' | 'skipped';
  progress: StageProgress;
  promptKind: PipelineRelayStage['promptKind'];
}

export interface RelayContextSnapshot {
  runId: string;
  requirement: string;
  baseEngine: BaseEngine;
  projectId?: string;
  artifactRoot: string;
  runDir: string;
  contextPath: string;
  currentStage?: RelayStageStatus;
  currentIndex: number;
  stages: RelayStageStatus[];
  memoryBundle: string;
}

/** 读取 manifest（requirement / stageMarks），失败返回空对象 */
function loadManifest(runId: string): { requirement?: string; projectId?: string; baseEngine?: BaseEngine; stageMarks?: Record<string, 'working' | 'rework' | 'accepted' | 'skipped'> } {
  const manifestPath = path.join(getRelayRunDir(runId), '.manifest.json');
  if (!fs.existsSync(manifestPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return {};
  }
}

/** 扫描一条 run 的全部阶段状态，并标记哪个是 current */
function scanStages(runId: string, baseEngine: BaseEngine, stageMarks?: Record<string, 'working' | 'rework' | 'accepted' | 'skipped'>): RelayStageStatus[] {
  const runDir = getRelayRunDir(runId);
  const stages = getRelayStages(baseEngine);
  const result: RelayStageStatus[] = stages.map((stage, index) => {
    const filePath = path.join(runDir, stage.artifactFile);
    const exists = fs.existsSync(filePath);
    const content = exists ? fs.readFileSync(filePath, 'utf-8') : undefined;
    const quality = quickQuality(stage, content);
    const mark = stageMarks?.[stage.id];
    const passed = quality === 'ok' || mark === 'accepted';
    return {
      index,
      id: stage.id,
      name: stage.name,
      ownerLabel: stage.ownerLabel,
      purpose: stage.purpose,
      artifactFile: stage.artifactFile,
      artifactPath: filePath.replace(/\\/g, '/'),
      exists,
      quality,
      stageMark: mark,
      progress: (passed ? 'done' : 'pending') as StageProgress,
      promptKind: stage.promptKind,
    };
  });
  // current = 第一个未通过的
  const firstUnpassed = result.find(s => s.progress !== 'done');
  if (firstUnpassed) firstUnpassed.progress = 'current';
  return result;
}

/** 轻量质量判定（与 pipeline-engine 的 validateArtifactQuality 对齐但不依赖它，避免循环引用） */
function quickQuality(stage: PipelineRelayStage, content?: string): 'missing' | 'weak' | 'ok' {
  if (!content?.trim()) return 'missing';
  const hasHeading = /^#{1,4}\s+/m.test(content);
  const hasRisk = /(风险|阻塞|block|risk|问题|不确定)/i.test(content);
  const hasNext = /(下一步|建议|后续|next|待办|todo|action)/i.test(content);
  if (!hasHeading || !hasRisk || !hasNext) return 'weak';
  if (stage.promptKind !== 'orchestrator') {
    if (!/(输入|依据|参考|based on|基于|读取|前提|前序|背景|上下文)/i.test(content)) return 'weak';
  }
  return 'ok';
}

/** 召回冷库记忆作为上下文（用需求作为查询） */
function recallMemoryBundle(requirement: string, projectPath: string): string {
  try {
    const result = recallMemory({
      query: requirement,
      projectPath,
      limit: 8,
      includeCandidates: false,
      recordUsage: false,
    });
    return result.items.length > 0 ? result.bundle : '';
  } catch (err) {
    console.warn('[RelayContext] recall memory skipped:', (err as Error)?.message || err);
    return '';
  }
}

/** 按 promptKind 计算阶段依赖 */
function computeStageDeps(stages: RelayStageStatus[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const stage of stages) {
    const deps: string[] = [];
    for (const candidate of stages) {
      if (candidate.id === stage.id) continue;
      let isDep = false;
      const isDesignReview = stage.promptKind === 'design' && stage.id.includes('review');
      const isFinalDesign = stage.id.includes('final-design');

      if (stage.promptKind === 'orchestrator') {
        isDep = false;
      } else if (stage.promptKind === 'discovery') {
        isDep = candidate.promptKind === 'orchestrator';
      } else if (isDesignReview) {
        isDep = candidate.id.includes('draft-design') || candidate.id.includes('discovery') || candidate.promptKind === 'orchestrator';
      } else if (isFinalDesign) {
        isDep = candidate.promptKind === 'design' || candidate.promptKind === 'discovery' || candidate.promptKind === 'orchestrator';
      } else if (stage.promptKind === 'design') {
        isDep = candidate.promptKind === 'orchestrator' || candidate.promptKind === 'discovery';
      } else if (stage.promptKind === 'implementation') {
        isDep = candidate.id.includes('final-design');
      } else if (stage.promptKind === 'verification') {
        isDep = candidate.promptKind === 'implementation' || candidate.id.includes('final-design');
      } else if (stage.promptKind === 'review') {
        isDep = candidate.id.includes('final-design') || candidate.promptKind === 'implementation' || candidate.promptKind === 'verification';
      } else if (stage.promptKind === 'handoff') {
        isDep = true;
      }
      if (isDep) deps.push(candidate.artifactFile);
    }
    map.set(stage.id, deps);
  }
  return map;
}

/** 生成 CONTEXT.md 的内容 */
function renderContextMarkdown(snap: RelayContextSnapshot): string {
  const lines: string[] = [
    `# 接力任务上下文 · ${snap.runId}`,
    '',
    `> 本文件由 ai-platform 的 \`/pipelines\` 页面生成，是当前接力任务的完整上下文。`,
    `> ZCode/Codex/ClaudeCode 读本文件即可知道：当前该做哪个阶段、产物写到哪、读哪些前序产物、冷库记忆。`,
    `> MCP 配置后可自动获取，本文件是兜底。`,
    '',
    `- **接力运行 ID**：\`${snap.runId}\``,
    `- **底座引擎**：${snap.baseEngine === 'claudecode' ? 'ClaudeCode (GLM)' : 'Codex / ChatGPT'}`,
    `- **产物目录**：\`${snap.runDir}\``,
    `- **当前进度**：${snap.currentIndex >= 0 ? `第 ${snap.currentIndex + 1} 阶段 / 共 ${snap.stages.length} 阶段` : '尚未开始'}`,
    '',
    '## 原始需求',
    '',
    snap.requirement || '（未填写，请向用户确认）',
    '',
    '## 当前阶段（下一步要做的事）',
    '',
  ];

  if (snap.currentStage) {
    const s = snap.currentStage;
    lines.push(
      `- **阶段**：第 ${s.index + 1} 步 · ${s.name}（\`${s.id}\`）`,
      `- **推荐执行者**：${s.ownerLabel}`,
      `- **阶段目的**：${s.purpose}`,
      `- **必须写入产物文件**：\`${s.artifactPath}\``,
      `- **产物状态**：${s.exists ? (s.quality === 'ok' ? '已生成且合格' : '已生成，质量待补强') : '尚未生成'}`,
      '',
      '**做这一步前**：',
      '1. 先读本节下方「全阶段产物清单」中标记为「必读」的前序产物文件，作为输入依据。',
      '2. 按 ai-platform 的质量门要求组织产物：至少含 Markdown 章节标题、输入依据、关键决策、风险/阻塞、下一步建议。',
      '3. 写入上述产物文件后，回 `/pipelines` 页面点「重新检测」或「通过质量门」。',
      '',
    );
  } else {
    lines.push('所有阶段已通过质量门。可以进入最终交付确认（回 `/pipelines` → 审计 Tab 记录最终决策）。', '');
  }

  lines.push('## 全阶段产物清单', '');
  const stageDeps = computeStageDeps(snap.stages);
  for (const s of snap.stages) {
    const deps = stageDeps.get(s.id) || [];
    const statusIcon = s.progress === 'done' ? '✅' : s.progress === 'current' ? '▶️' : '⬜';
    lines.push(`- ${statusIcon} **${s.index + 1}. ${s.name}**（${s.ownerLabel}）→ \`${s.artifactFile}\``);
    if (deps.length > 0) {
      lines.push(`  - 必读前序：${deps.map(d => `\`${d}\``).join('、')}`);
    }
  }

  if (snap.memoryBundle) {
    lines.push('', '## 冷库记忆（背景上下文，当前需求和代码优先级更高）', '', snap.memoryBundle);
  }

  return lines.join('\n');
}

/** 生成当前接力快照（不写文件），供 MCP 和路由共用 */
export function buildRelaySnapshot(runId: string): RelayContextSnapshot {
  const id = sanitizeRunId(runId);
  const manifest = loadManifest(id);
  const baseEngine: BaseEngine = manifest.baseEngine || 'codex';
  const requirement = manifest.requirement || '';
  const stages = scanStages(id, baseEngine, manifest.stageMarks);
  const config = getConfig();
  const project = manifest.projectId ? config.projects?.find((p: any) => p.id === manifest.projectId) : undefined;
  const projectPath = project?.sourcePath || config.aiPlatformRoot || config.projectRoot || '';
  const runDir = getRelayRunDir(id).replace(/\\/g, '/');

  const firstUnpassed = stages.find(s => s.progress === 'current');
  const currentIndex = firstUnpassed ? firstUnpassed.index : (stages.length > 0 ? stages.length - 1 : -1);

  return {
    runId: id,
    requirement,
    baseEngine,
    projectId: manifest.projectId,
    artifactRoot: path.dirname(runDir),
    runDir,
    contextPath: path.join(getRelayRunDir(id), CONTEXT_FILENAME).replace(/\\/g, '/'),
    currentStage: firstUnpassed,
    currentIndex,
    stages,
    memoryBundle: recallMemoryBundle(requirement, projectPath),
  };
}

/**
 * 生成 CONTEXT.md 到产物目录（兜底文件）。
 * 每个 run 独立，多任务隔离。绝不碰全局 AGENTS.md。
 */
export function syncRelayContext(runId: string): RelayContextSnapshot {
  const snap = buildRelaySnapshot(runId);
  const runDir = getRelayRunDir(snap.runId);
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }
  const contextPath = path.join(runDir, CONTEXT_FILENAME);
  fs.writeFileSync(contextPath, renderContextMarkdown(snap), 'utf-8');
  return snap;
}

/** 读取 CONTEXT.md 是否已生成 */
export function readRelayContext(runId: string): { synced: boolean; contextPath: string } {
  const id = sanitizeRunId(runId);
  const contextPath = path.join(getRelayRunDir(id), CONTEXT_FILENAME).replace(/\\/g, '/');
  return {
    synced: fs.existsSync(contextPath),
    contextPath,
  };
}
