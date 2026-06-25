/**
 * 开发流水线引擎
 *
 * 6 阶段固定流水线：需求分析 → 方案设计 → 代码实现 → 测试验证 → 代码审查 → 提交归档
 * 复用 workflow-engine 的模式：EventEmitter、executeStep、parseStepOutput、JSON 持久化
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { AI_PLATFORM_ROOT, getConfig } from './config.js';
import { executeStep } from './claude-client.js';
import { chatWithDeepSeek, isDeepSeekAvailable, initFromPlatformConfig as initDeepSeek } from './deepseek-client.js';
import { tracePromptGenerated, traceStageMarkChanged, traceFinalDecision, traceArtifactDependency } from './pipeline-trace.js';
import { buildWorkflowMemoryContext } from './memory-curator.js';

// ========== 类型 ==========

type StageStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'waiting_confirm';

interface PipelineStageConfig {
  id: string;
  skill: string;
  name: string;
  gate?: { requireConfirmation?: boolean };
}

export type BaseEngine = 'codex' | 'claudecode' | 'zcode';
type RelayStageMark = 'working' | 'rework' | 'accepted' | 'skipped';

export interface PipelineRelayStage {
  id: string;
  name: string;
  owner: 'codex' | 'claudecode-glm' | 'deepseek' | 'human';
  ownerLabel: string;
  purpose: string;
  artifactFile: string;
  promptKind: 'orchestrator' | 'discovery' | 'design' | 'implementation' | 'verification' | 'review' | 'handoff';
}

interface PipelineStageRun {
  stageId: string;
  status: StageStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

interface PipelineRun {
  id: string;
  requirement: string;
  projectId?: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'aborted';
  stages: PipelineStageRun[];
  context: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
  currentStageIndex: number;
  logs: Array<{ time: string; level: string; message: string }>;
}

// ========== 6 阶段固定定义 ==========

const PIPELINE_STAGES: PipelineStageConfig[] = [
  { id: 'requirement-analysis', skill: 'requirement-analysis', name: '需求分析' },
  { id: 'design-generation', skill: 'design-generation', name: '方案设计',
    gate: { requireConfirmation: true } },
  { id: 'code-implementation', skill: 'code-implementation', name: '代码实现',
    gate: { requireConfirmation: true } },
  { id: 'test-verification', skill: 'test-verification', name: '测试验证' },
  { id: 'code-review', skill: 'code-review', name: '代码审查' },
  { id: 'commit-archive', skill: 'commit-archive', name: '提交归档',
    gate: { requireConfirmation: true } },
];

const RELAY_STAGES: PipelineRelayStage[] = [
  {
    id: 'codex-intake',
    name: '需求澄清与总控',
    owner: 'codex',
    ownerLabel: 'Codex / ChatGPT',
    purpose: '追问需求、收敛目标、确定本轮接力计划，不直接进入大段实现。',
    artifactFile: '01-codex-intake.md',
    promptKind: 'orchestrator',
  },
  {
    id: 'code-discovery',
    name: '代码发现与影响分析',
    owner: 'codex',
    ownerLabel: 'Codex / ChatGPT',
    purpose: '在设计前阅读实际代码，定位入口、数据来源、存储方式、加载机制和影响文件。',
    artifactFile: '02-code-discovery.md',
    promptKind: 'discovery',
  },
  {
    id: 'codex-draft-design',
    name: 'Codex 初版设计',
    owner: 'codex',
    ownerLabel: 'Codex / ChatGPT',
    purpose: 'Codex 基于需求澄清和代码发现产物先产出主设计草案，作为后续 GLM/DeepSeek 审阅对象。',
    artifactFile: '03-codex-draft-design.md',
    promptKind: 'design',
  },
  {
    id: 'glm-design-review',
    name: 'GLM 设计审阅',
    owner: 'claudecode-glm',
    ownerLabel: 'ClaudeCode CLI / GLM',
    purpose: '围绕 Codex 初版设计做可实现性、文件计划和项目结构审阅，不另起一套方案。',
    artifactFile: '04-glm-design-review.md',
    promptKind: 'design',
  },
  {
    id: 'deepseek-design-review',
    name: 'DeepSeek 设计审阅',
    owner: 'deepseek',
    ownerLabel: 'DeepSeek',
    purpose: '围绕 Codex 初版设计做风险、边界、安全和遗漏审阅，不另起一套方案。',
    artifactFile: '05-deepseek-design-review.md',
    promptKind: 'design',
  },
  {
    id: 'codex-final-design',
    name: 'Codex 修订定稿',
    owner: 'codex',
    ownerLabel: 'Codex / ChatGPT',
    purpose: 'Codex 读取 GLM/DeepSeek 审阅意见，判断采纳与否，修订出唯一最终实现方案。',
    artifactFile: '06-codex-final-design.md',
    promptKind: 'design',
  },
  {
    id: 'implementation',
    name: '代码实现',
    owner: 'claudecode-glm',
    ownerLabel: 'ClaudeCode / 外部编码平台 / Codex 可选',
    purpose: '按最终方案实现代码；小改动可由 Codex 直接完成，大改动建议外部平台执行。',
    artifactFile: '07-implementation-result.md',
    promptKind: 'implementation',
  },
  {
    id: 'verification',
    name: '测试验证',
    owner: 'claudecode-glm',
    ownerLabel: 'ClaudeCode / 外部执行环境',
    purpose: '运行编译、测试、页面验证或可替代静态检查，记录验证证据。',
    artifactFile: '08-verification-result.md',
    promptKind: 'verification',
  },
  {
    id: 'deepseek-review',
    name: 'DeepSeek 代码审查',
    owner: 'deepseek',
    ownerLabel: 'DeepSeek',
    purpose: '基于最终方案、diff 和验证结果做独立审查。',
    artifactFile: '09-deepseek-review.md',
    promptKind: 'review',
  },
  {
    id: 'codex-final-review',
    name: 'Codex 最终裁判',
    owner: 'codex',
    ownerLabel: 'Codex / ChatGPT',
    purpose: '汇总所有产物，判断是否返工，输出最终交付摘要。',
    artifactFile: '10-codex-final-handoff.md',
    promptKind: 'handoff',
  },
];

const RELAY_STAGES_CLAUDECODE: PipelineRelayStage[] = [
  {
    id: 'claudecode-intake',
    name: '需求澄清与总控',
    owner: 'claudecode-glm',
    ownerLabel: 'ClaudeCode / GLM',
    purpose: '追问需求、收敛目标、确定本轮接力计划，ClaudeCode 作为总控直接执行。',
    artifactFile: '01-cc-intake.md',
    promptKind: 'orchestrator',
  },
  {
    id: 'cc-code-discovery',
    name: '代码发现与影响分析',
    owner: 'claudecode-glm',
    ownerLabel: 'ClaudeCode / GLM',
    purpose: '在设计前阅读实际代码，定位入口、数据来源、存储方式、加载机制和影响文件。',
    artifactFile: '02-cc-code-discovery.md',
    promptKind: 'discovery',
  },
  {
    id: 'claudecode-draft-design',
    name: 'ClaudeCode 初版设计',
    owner: 'claudecode-glm',
    ownerLabel: 'ClaudeCode / GLM',
    purpose: 'ClaudeCode 基于需求澄清和代码发现产物输出主设计草案，交由 DeepSeek 审阅。',
    artifactFile: '03-cc-draft-design.md',
    promptKind: 'design',
  },
  {
    id: 'cc-deepseek-design-review',
    name: 'DeepSeek 设计审阅',
    owner: 'deepseek',
    ownerLabel: 'DeepSeek',
    purpose: '围绕 ClaudeCode 初版设计做风险、边界、安全和遗漏审阅，不另起一套方案。',
    artifactFile: '04-cc-deepseek-design-review.md',
    promptKind: 'design',
  },
  {
    id: 'claudecode-final-design',
    name: 'ClaudeCode 修订定稿',
    owner: 'claudecode-glm',
    ownerLabel: 'ClaudeCode / GLM',
    purpose: 'ClaudeCode 读取 DeepSeek 审阅意见，判断采纳与否，修订出唯一最终实现方案。',
    artifactFile: '05-cc-final-design.md',
    promptKind: 'design',
  },
  {
    id: 'cc-implementation',
    name: '代码实现',
    owner: 'claudecode-glm',
    ownerLabel: 'ClaudeCode / GLM',
    purpose: '按最终方案实现代码，ClaudeCode 直接执行。',
    artifactFile: '06-cc-implementation-result.md',
    promptKind: 'implementation',
  },
  {
    id: 'cc-verification',
    name: '测试验证',
    owner: 'claudecode-glm',
    ownerLabel: 'ClaudeCode / GLM',
    purpose: '运行编译、测试、页面验证或可替代静态检查，记录验证证据。',
    artifactFile: '07-cc-verification-result.md',
    promptKind: 'verification',
  },
  {
    id: 'cc-deepseek-review',
    name: 'DeepSeek 代码审查',
    owner: 'deepseek',
    ownerLabel: 'DeepSeek',
    purpose: '基于最终方案、diff 和验证结果做独立审查。',
    artifactFile: '08-cc-deepseek-review.md',
    promptKind: 'review',
  },
  {
    id: 'claudecode-final-review',
    name: 'ClaudeCode 最终裁判',
    owner: 'claudecode-glm',
    ownerLabel: 'ClaudeCode / GLM',
    purpose: '汇总所有产物，判断是否返工，输出最终交付摘要。',
    artifactFile: '09-cc-final-handoff.md',
    promptKind: 'handoff',
  },
];

/** 根据底座类型获取对应的接力阶段数组。zcode 复用 claudecode 的 9 阶段路线。 */
export function getRelayStages(baseEngine?: BaseEngine): PipelineRelayStage[] {
  return (baseEngine === 'claudecode' || baseEngine === 'zcode') ? RELAY_STAGES_CLAUDECODE : RELAY_STAGES;
}

// ========== 持久化 ==========

const DATA_ROOT = path.resolve(AI_PLATFORM_ROOT, 'data');
const RUNS_DIR = path.join(DATA_ROOT, 'pipeline-runs');
const KNOWLEDGE_DIR = path.join(DATA_ROOT, 'pipeline-knowledge');

const activeRuns = new Map<string, PipelineRun>();
const deletedRunIds = new Set<string>();

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getPipelineArtifactRoot(): string {
  const config = getConfig();
  return path.resolve(config.pipelineArtifactRoot || path.join(config.testDataDir || config.e2eDataDir || DATA_ROOT, 'pipeline-artifacts'));
}

export function sanitizeRunId(input: string): string {
  return input
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function createPipelineRelayRunId(requirement: string): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  const slug = sanitizeRunId(requirement.slice(0, 28)) || 'pipeline';
  return `${stamp}-${slug}`;
}

export function getRelayRunDir(runId: string): string {
  return path.join(getPipelineArtifactRoot(), sanitizeRunId(runId) || 'pipeline-run');
}

export function registerPipelineRelayRun(runId: string, requirement?: string, projectId?: string, baseEngine?: BaseEngine): void {
  const id = sanitizeRunId(runId);
  const runDir = getRelayRunDir(id);
  ensureDir(runDir);
  const manifestPath = path.join(runDir, '.manifest.json');
  const existing = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    : {};
  fs.writeFileSync(manifestPath, JSON.stringify({
    ...existing,
    runId: id,
    requirement: requirement || existing.requirement || '',
    projectId: projectId || existing.projectId || '',
    baseEngine: baseEngine || existing.baseEngine || 'zcode',
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, null, 2), 'utf-8');
}

function loadRelayManifest(runId: string): { requirement?: string; projectId?: string; baseEngine?: BaseEngine; stageMarks?: Record<string, RelayStageMark> } {
  const manifestPath = path.join(getRelayRunDir(runId), '.manifest.json');
  if (!fs.existsSync(manifestPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return {};
  }
}

export function updateRelayStageMark(runId: string, stageId: string, mark: RelayStageMark): {
  runId: string;
  stageId: string;
  mark: RelayStageMark;
} {
  const id = sanitizeRunId(runId);
  const manifest = loadRelayManifest(id);
  const stages = getRelayStages(manifest.baseEngine || 'zcode');
  if (!stages.some(stage => stage.id === stageId)) {
    throw new Error(`Unknown relay stage: ${stageId}`);
  }
  registerPipelineRelayRun(id, manifest.requirement, manifest.projectId, manifest.baseEngine);
  const manifestPath = path.join(getRelayRunDir(id), '.manifest.json');
  const current = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    : {};
  const stageMarks = {
    ...(current.stageMarks || {}),
    [stageId]: mark,
  };
  fs.writeFileSync(manifestPath, JSON.stringify({
    ...current,
    stageMarks,
    updatedAt: new Date().toISOString(),
  }, null, 2), 'utf-8');

  // trace：阶段标记变更
  const stage = stages.find(item => item.id === stageId);
  traceStageMarkChanged(id, `阶段「${stage?.name || stageId}」标记为 ${mark}`, {
    stageId,
    stageName: stage?.name,
    mark,
    artifactFile: stage?.artifactFile,
  });

  // trace：通过质量门视为该阶段的最终决策；打回则是返工决策；跳过则记录跳过决策
  if (mark === 'accepted') {
    traceFinalDecision(id, `阶段「${stage?.name || stageId}」通过质量门（人工确认）`, {
      stageId,
      stageName: stage?.name,
      decision: 'accepted',
      artifactFile: stage?.artifactFile,
    });
  } else if (mark === 'rework') {
    traceFinalDecision(id, `阶段「${stage?.name || stageId}」被打回补齐`, {
      stageId,
      stageName: stage?.name,
      decision: 'rework',
    });
  } else if (mark === 'skipped') {
    traceFinalDecision(id, `阶段「${stage?.name || stageId}」被跳过`, {
      stageId,
      stageName: stage?.name,
      decision: 'skipped',
    });
  }

  return { runId: id, stageId, mark };
}

/**
 * 各阶段应读取的前序产物（按依赖顺序）。
 * orchestrator 是第一段，没有前序依赖。
 * 用于提示词生成和质量门检查，让产物之间形成可追溯的证据链。
 */
function getStageDependencies(stage: PipelineRelayStage, allStages: PipelineRelayStage[]): PipelineRelayStage[] {
  switch (stage.promptKind) {
    case 'orchestrator':
      return [];
    case 'discovery':
      return allStages.filter(item => item.promptKind === 'orchestrator');
    case 'design':
      // design 类（初版/审阅/定稿）都基于需求澄清 + 代码发现
      return allStages.filter(item => item.promptKind === 'orchestrator' || item.promptKind === 'discovery');
    case 'implementation':
      return allStages.filter(item => item.id.includes('final-design') || item.promptKind === 'design');
    case 'verification':
      return allStages.filter(item => item.promptKind === 'implementation' || item.id.includes('final-design'));
    case 'review':
      return allStages.filter(item =>
        item.id.includes('final-design') || item.promptKind === 'implementation' || item.promptKind === 'verification');
    case 'handoff':
      // 交付裁判读取全部已有产物
      return allStages.filter(item => item.id !== stage.id);
    default:
      return [];
  }
}

function validateArtifactQuality(stage: PipelineRelayStage, content?: string, allStages?: PipelineRelayStage[]): {
  quality: 'missing' | 'weak' | 'ok';
  issues: string[];
} {
  if (!content?.trim()) return { quality: 'missing', issues: ['未检测到产物文件'] };

  const issues: string[] = [];
  const hasHeading = /^#{1,4}\s+/m.test(content);
  const hasFilePath = /([A-Za-z]:[\\/][^\s`'"]+|[\w.-]+[\\/][\w./-]+\.(ts|tsx|vue|java|js|json|md|xml|yml|yaml))/i.test(content);
  const hasRisk = /(风险|阻塞|block|risk|问题|不确定)/i.test(content);
  const hasNext = /(下一步|建议|后续|next|待办|todo|action)/i.test(content);

  if (!hasHeading) issues.push('缺少 Markdown 章节标题');
  if (!hasRisk) issues.push('缺少风险/阻塞说明');
  if (!hasNext) issues.push('缺少下一步建议');

  // 输入依据检查：非 orchestrator 阶段应说明基于什么输入做的工作
  if (stage.promptKind !== 'orchestrator') {
    const hasInputBasis = /(输入|依据|参考|based on|基于|读取|前提|前序|背景|上下文)/i.test(content);
    if (!hasInputBasis) issues.push('缺少输入依据说明（应说明基于哪些前序产物或需求）');
  }

  // 前序产物引用检查：设计/实现/验证/审查/交付阶段应引用前序产物文件名
  const deps = allStages ? getStageDependencies(stage, allStages) : [];
  if (deps.length > 0 && ['design', 'implementation', 'verification', 'review', 'handoff'].includes(stage.promptKind)) {
    const referencedArtifact = deps.some(dep => {
      // 检测正文是否提及前序产物文件名（去掉扩展名也认）或完整路径
      const bareName = dep.artifactFile.replace(/\.md$/i, '');
      return content.includes(dep.artifactFile) || content.includes(bareName) || content.includes(dep.id);
    });
    if (!referencedArtifact) {
      issues.push(`缺少对前序产物的引用（应读取并引用 ${deps.map(d => d.artifactFile).slice(0, 2).join('、')} 等）`);
    }
  }

  if (stage.promptKind === 'discovery') {
    if (!hasFilePath) issues.push('代码发现阶段缺少真实文件路径证据');
    if (!/(入口|接口|组件|服务|存储|字段|加载|entry|api|service|storage)/i.test(content)) {
      issues.push('代码发现阶段缺少入口/存储/加载机制说明');
    }
  }

  if (stage.id.includes('final-design') || stage.id.includes('final')) {
    if (!/(验收|测试|验证|acceptance|test)/i.test(content)) issues.push('最终设计/交付缺少验收或验证标准');
    if (!/(文件|接口|前端|后端|任务|改动|file|api)/i.test(content)) issues.push('最终设计/交付缺少文件级或接口级计划');
  }

  if (stage.promptKind === 'implementation') {
    if (!/(changed|修改|新增|文件|diff|变更)/i.test(content)) issues.push('实现阶段缺少变更文件或 diff 摘要');
  }

  if (stage.promptKind === 'verification') {
    if (!/(命令|测试|构建|build|test|npm|mvn|pnpm|yarn|验证)/i.test(content)) issues.push('验证阶段缺少命令或验证证据');
  }

  if (stage.promptKind === 'review') {
    if (!/(security|安全|性能|可维护|覆盖|风险|review|审查)/i.test(content)) issues.push('审查阶段缺少审查维度');
  }

  return {
    quality: issues.length === 0 ? 'ok' : 'weak',
    issues,
  };
}

function saveRunState(run: PipelineRun): void {
  if (deletedRunIds.has(run.id)) return;
  ensureDir(RUNS_DIR);
  fs.writeFileSync(path.join(RUNS_DIR, `${run.id}.json`), JSON.stringify(run, null, 2), 'utf-8');
}

function loadRunState(runId: string): PipelineRun | undefined {
  const filePath = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ========== 工具函数（复用 workflow-engine 模式） ==========

function addLog(run: PipelineRun, level: string, message: string): void {
  run.logs.push({ time: new Date().toISOString(), level, message });
}

function parseStepOutput(output: string): Record<string, unknown> {
  const resultMatch = output.match(/<!-- RESULT -->\s*```json\n([\s\S]*?)\n```\s*<!-- \/RESULT -->/);
  if (resultMatch) {
    try {
      const parsed = JSON.parse(resultMatch[1]);
      if (parsed.status === 'success' && parsed.data) return parsed.data;
      if (parsed.status === 'failed') throw new Error(parsed.error || 'Stage failed');
    } catch (e) {
      if (e instanceof Error && !e.message.includes('JSON')) throw e;
    }
  }
  const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch { /* skip */ }
  }
  return { raw: output };
}

export function buildStagePrompt(
  stage: PipelineStageConfig,
  run: PipelineRun,
): string {
  const config = getConfig();
  const projectSourcePath = run.projectId
    ? (config.projects?.find((p: any) => p.id === run.projectId)?.sourcePath || config.projectRoot || '')
    : (config.projectRoot || '');

  // 构建上下文字符串（前面阶段的输出摘要）
  const contextParts: string[] = [];
  for (const [key, value] of Object.entries(run.context)) {
    if (value && typeof value === 'object') {
      contextParts.push(`### ${key} 阶段输出\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
    }
  }
  const contextStr = contextParts.length > 0 ? contextParts.join('\n\n') : '（无，这是第一个阶段）';

  // 跨工作流记忆注入：按阶段类型选择 target 策略
  const stageTarget = stageToMemoryTarget(stage.id);
  const memoryContext = buildWorkflowMemoryContext(stageTarget, run.requirement, projectSourcePath);

  return [
    `你是一个自动化开发流水线执行引擎。请严格按照以下指令执行任务。`,
    ``,
    `## 当前任务`,
    `- 阶段: ${stage.name} (${stage.id})`,
    `- 使用 Skill: ${stage.skill}`,
    ``,
    `## 原始需求`,
    run.requirement,
    memoryContext,
    `## 项目源码路径`,
    projectSourcePath,
    ``,
    `## 前序阶段产出`,
    contextStr,
    ``,
    `## 执行要求`,
    `1. 严格按照 ${stage.skill} Skill 的规范执行`,
    `2. 不要询问用户，根据已有信息直接执行`,
    `3. 执行完成后，在回复末尾用以下格式输出结果：`,
    ``,
    `<!-- RESULT -->`,
    '```json',
    '{',
    '  "status": "success",',
    '  "data": { ... }',
    '}',
    '```',
    `<!-- /RESULT -->`,
    ``,
    `4. 如果执行失败，输出：`,
    `<!-- RESULT -->`,
    '```json',
    '{',
    '  "status": "failed",',
    '  "error": "错误描述"',
    '}',
    '```',
    `<!-- /RESULT -->`,
  ].join('\n');
}

/** 流水线阶段 id → 记忆召回 target */
function stageToMemoryTarget(stageId: string): 'pipeline' | 'test' | 'review' {
  if (stageId.includes('test') || stageId.includes('verification')) return 'test';
  if (stageId.includes('review')) return 'review';
  return 'pipeline';
}

// ========== 知识图谱 ==========

function writeKnowledgeGraph(run: PipelineRun): void {
  ensureDir(KNOWLEDGE_DIR);
  const entry: Record<string, unknown> = {
    runId: run.id,
    requirement: run.requirement,
    completedAt: run.finishedAt,
    success: run.status === 'completed',
    stages: {} as Record<string, unknown>,
  };
  for (const stage of run.stages) {
    if (stage.output) {
      (entry.stages as Record<string, unknown>)[stage.stageId] = stage.output;
    }
  }
  fs.writeFileSync(
    path.join(KNOWLEDGE_DIR, `${run.id}.json`),
    JSON.stringify(entry, null, 2),
    'utf-8'
  );
}

// ========== 核心执行 ==========

async function executeAllStages(run: PipelineRun, emitter: EventEmitter): Promise<void> {
  const config = getConfig();
  const cwd = run.projectId
    ? (config.projects?.find((p: any) => p.id === run.projectId)?.sourcePath || config.projectRoot || process.cwd())
    : (config.projectRoot || process.cwd());

  addLog(run, 'info', `Starting pipeline: ${run.requirement}`);
  emitter.emit('pipeline:start', { runId: run.id, requirement: run.requirement });

  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    if ((run.status as string) === 'aborted') break;

    // 断点恢复：跳过已完成的阶段
    if (run.stages[i].status === 'success') {
      run.currentStageIndex = i;
      continue;
    }

    const stageConfig = PIPELINE_STAGES[i];
    const stageRun = run.stages[i];

    // 执行阶段
    stageRun.status = 'running';
    stageRun.startedAt = new Date().toISOString();
    run.currentStageIndex = i;
    saveRunState(run);

    addLog(run, 'info', `Stage ${i + 1}/${PIPELINE_STAGES.length}: ${stageConfig.name}`);
    emitter.emit('stage:start', { runId: run.id, stageId: stageConfig.id, index: i, name: stageConfig.name });

    try {
      const prompt = buildStagePrompt(stageConfig, run);
      const result = await executeStep(prompt, {
        cwd,
        allowedTools: getStageTools(stageConfig.skill),
        maxTurns: 9999,
      }, emitter);

      const parsed = parseStepOutput(result.output);
      stageRun.output = parsed;
      stageRun.status = 'success';
      run.context[stageConfig.id] = parsed;

      addLog(run, 'info', `Stage ${stageConfig.name} completed`);
      emitter.emit('stage:done', {
        runId: run.id,
        stageId: stageConfig.id,
        index: i,
        status: 'success',
        output: parsed,
      });

      // 多模型交叉审查（仅 code-review 阶段）
      if (stageConfig.id === 'code-review' && isDeepSeekAvailable()) {
        try {
          addLog(run, 'info', `启动 DeepSeek 交叉审查...`);
          emitter.emit('cross-review:start', { runId: run.id, stageId: 'cross-review', model: 'deepseek' });

          const crossReviewPrompt = buildCrossReviewPrompt(run);
          const deepseekResult = await chatWithDeepSeek([
            { role: 'system', content: '你是一个专业的代码审查专家。请对以下代码变更进行严格的安全、性能和可维护性审查。' },
            { role: 'user', content: crossReviewPrompt },
          ]);

          // 将 DeepSeek 结果附加到 stage output
          const crossReviewData = {
            reviewer: 'deepseek',
            model: deepseekResult.model,
            content: deepseekResult.content,
            reviewedAt: new Date().toISOString(),
          };

          if (typeof stageRun.output === 'object' && stageRun.output !== null) {
            (stageRun.output as any).__crossReview = crossReviewData;
          }

          addLog(run, 'info', `DeepSeek 交叉审查完成`);
          emitter.emit('cross-review:done', {
            runId: run.id,
            stageId: 'cross-review',
            model: 'deepseek',
            result: crossReviewData,
          });
        } catch (crossErr) {
          const crossErrorMsg = crossErr instanceof Error ? crossErr.message : String(crossErr);
          addLog(run, 'warn', `DeepSeek 交叉审查失败（不影响主流程）: ${crossErrorMsg}`);
          emitter.emit('cross-review:failed', { runId: run.id, error: crossErrorMsg });
        }
      }

      // Gate 检查：需要确认时暂停
      if (stageConfig.gate?.requireConfirmation) {
        stageRun.status = 'waiting_confirm';
        run.status = 'paused';
        saveRunState(run);
        addLog(run, 'info', `Stage ${stageConfig.name} waiting for confirmation`);
        emitter.emit('stage:gate', { runId: run.id, stageId: stageConfig.id, index: i });

        // 等待确认（通过 confirmPipelineStage 修改状态恢复）
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            const current = activeRuns.get(run.id) || loadRunState(run.id);
            if (!current || current.status === 'running' || current.status === 'aborted') {
              clearInterval(check);
              run.status = current?.status || run.status;
              run.stages[i].status = current?.stages[i]?.status || run.stages[i].status;
              resolve();
            }
          }, 1000);
        });

        if ((run.status as string) === 'aborted') break;
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      stageRun.status = 'failed';
      stageRun.error = errorMsg;
      addLog(run, 'error', `Stage ${stageConfig.name} failed: ${errorMsg}`);
      emitter.emit('stage:done', {
        runId: run.id,
        stageId: stageConfig.id,
        index: i,
        status: 'failed',
        error: errorMsg,
      });
      run.status = 'failed';
      run.finishedAt = new Date().toISOString();
      saveRunState(run);
      emitter.emit('pipeline:failed', { runId: run.id, error: errorMsg });
      return;
    }

    stageRun.finishedAt = new Date().toISOString();
    saveRunState(run);
  }

  // 流水线完成
  if (run.status !== 'aborted') {
    run.status = 'completed';
    run.finishedAt = new Date().toISOString();
    saveRunState(run);
    writeKnowledgeGraph(run);
    addLog(run, 'info', `Pipeline completed`);
    emitter.emit('pipeline:done', { runId: run.id, status: 'completed' });
  }
}

function getStageTools(skillName: string): string[] {
  // 根据不同 skill 返回允许的工具
  const toolMap: Record<string, string[]> = {
    'requirement-analysis': ['Read', 'Glob', 'Grep'],
    'design-generation': ['Read', 'Glob', 'Grep', 'Write'],
    'code-implementation': ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    'test-verification': ['Bash', 'Read', 'Glob', 'Grep'],
    'code-review': ['Read', 'Glob', 'Grep'],
    'commit-archive': ['Bash', 'Read'],
  };
  return toolMap[skillName] || ['Read', 'Glob', 'Grep'];
}

// ========== 导出的 API ==========

export function getPipelineStageDefinitions() {
  return PIPELINE_STAGES.map((s) => ({
    id: s.id,
    skill: s.skill,
    name: s.name,
    gate: s.gate || null,
  }));
}

/** 构建交叉审查提示词 */
function buildCrossReviewPrompt(run: PipelineRun): string {
  const codeOutput = run.context['code-implementation'];
  const designOutput = run.context['design-generation'];
  const reqOutput = run.context['requirement-analysis'];

  return [
    `## 原始需求`,
    run.requirement,
    '',
    `## 需求分析结果`,
    reqOutput ? JSON.stringify(reqOutput, null, 2) : '（无）',
    '',
    `## 设计方案`,
    designOutput ? JSON.stringify(designOutput, null, 2) : '（无）',
    '',
    `## 代码实现`,
    codeOutput ? JSON.stringify(codeOutput, null, 2) : '（无）',
    '',
    `请从以下 5 个维度进行审查，每项给出 0-100 分和具体问题列表：`,
    `1. 安全性（SQL注入、XSS、权限控制）`,
    `2. 性能（数据库查询、缓存、并发）`,
    `3. 可维护性（代码结构、命名、注释）`,
    `4. 代码风格（一致性、最佳实践）`,
    `5. 需求覆盖度（是否完整实现需求）`,
    '',
    `最后给出总评和改进建议。`,
  ].join('\n');
}

/** 获取可用的模型列表 */
export function getAvailableModels(): Array<{ id: string; name: string; provider: string; available: boolean }> {
  initDeepSeek();
  const config = getConfig();
  const models: Array<{ id: string; name: string; provider: string; available: boolean }> = [
    {
      id: 'glm-5.1',
      name: 'GLM-5.1 (Agent)',
      provider: 'zhipu',
      available: !!(config.claudeConfig?.authToken),
    },
    {
      id: config.codexConfig?.model || 'gpt-5-codex',
      name: 'CodeX (执行主流程)',
      provider: 'openai',
      available: !!(config.codexConfig?.apiKey),
    },
    {
      id: 'deepseek-chat',
      name: 'DeepSeek (审查)',
      provider: 'deepseek',
      available: isDeepSeekAvailable(),
    },
  ];
  return models;
}

export function getPipelineRelayPlan(runId?: string, baseEngine?: BaseEngine): {
  artifactRoot: string;
  runDir: string;
  runId: string;
  stages: PipelineRelayStage[];
} {
  const id = runId ? sanitizeRunId(runId) : createPipelineRelayRunId('pipeline');
  return {
    artifactRoot: getPipelineArtifactRoot().replace(/\\/g, '/'),
    runDir: getRelayRunDir(id).replace(/\\/g, '/'),
    runId: id,
    stages: getRelayStages(baseEngine),
  };
}

export function scanPipelineArtifacts(runId: string): {
  runId: string;
  artifactRoot: string;
  runDir: string;
  baseEngine: BaseEngine;
  stages: Array<PipelineRelayStage & {
    path: string;
    exists: boolean;
    size: number;
    updatedAt?: string;
    preview?: string;
    quality: 'missing' | 'weak' | 'ok';
    qualityIssues: string[];
    stageMark?: RelayStageMark;
  }>;
} {
  const id = sanitizeRunId(runId);
  const runDir = getRelayRunDir(id);
  const manifest = loadRelayManifest(id);
  const baseEngine: BaseEngine = manifest.baseEngine || 'zcode';
  const relayStages = getRelayStages(baseEngine);
  const stages = relayStages.map(stage => {
    const filePath = path.join(runDir, stage.artifactFile);
    const exists = fs.existsSync(filePath);
    const stat = exists ? fs.statSync(filePath) : undefined;
    const content = exists ? fs.readFileSync(filePath, 'utf-8') : undefined;
    const preview = content?.slice(0, 1200);
    const quality = validateArtifactQuality(stage, content, relayStages);
    return {
      ...stage,
      path: filePath.replace(/\\/g, '/'),
      exists,
      size: stat?.size || 0,
      updatedAt: stat?.mtime.toISOString(),
      preview,
      quality: quality.quality,
      qualityIssues: quality.issues,
      stageMark: manifest.stageMarks?.[stage.id],
    };
  });
  return {
    runId: id,
    artifactRoot: getPipelineArtifactRoot().replace(/\\/g, '/'),
    runDir: runDir.replace(/\\/g, '/'),
    baseEngine,
    stages,
  };
}

export function listPipelineArtifactRuns(): Array<{
  runId: string;
  runDir: string;
  requirement?: string;
  projectId?: string;
  baseEngine?: BaseEngine;
  updatedAt?: string;
  completedStages: number;
  qualifiedStages: number;
  workingStages: number;
  reworkStages: number;
  acceptedStages: number;
  totalStages: number;
}> {
  const root = getPipelineArtifactRoot();
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const runId = entry.name;
      const runDir = path.join(root, runId);
      const scan = scanPipelineArtifacts(runId);
      const manifestPath = path.join(runDir, '.manifest.json');
      const manifest = fs.existsSync(manifestPath)
        ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
        : {};
      const dirStat = fs.statSync(runDir);
      const timestamps = scan.stages
        .map(stage => stage.updatedAt ? new Date(stage.updatedAt).getTime() : 0)
        .filter(Boolean);
      return {
        runId,
        runDir: runDir.replace(/\\/g, '/'),
        requirement: manifest.requirement,
        projectId: manifest.projectId,
        baseEngine: scan.baseEngine,
        updatedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : (manifest.updatedAt || dirStat.mtime.toISOString()),
        completedStages: scan.stages.filter(stage => stage.exists).length,
        qualifiedStages: scan.stages.filter(stage => stage.quality === 'ok').length,
        workingStages: scan.stages.filter(stage => stage.stageMark === 'working').length,
        reworkStages: scan.stages.filter(stage => stage.stageMark === 'rework').length,
        acceptedStages: scan.stages.filter(stage => stage.stageMark === 'accepted').length,
        totalStages: scan.stages.length,
      };
    })
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

/** 删除单个阶段的产物文件（保留其余产物和 manifest）。幂等：文件不存在返回 false。 */
export function deleteRelayArtifact(runId: string, stageId: string): boolean {
  const id = sanitizeRunId(runId);
  const manifest = loadRelayManifest(id);
  const stages = getRelayStages(manifest.baseEngine || 'zcode');
  const stage = stages.find(item => item.id === stageId);
  if (!stage) {
    throw new Error(`Unknown relay stage: ${stageId}`);
  }
  const filePath = path.join(getRelayRunDir(id), stage.artifactFile);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/**
 * 删除整条接力 run：删除目录下所有阶段产物 *.md + .manifest.json。
 * 仅当删除后目录为空时移除空目录，保留用户手动放进目录的其他文件。
 * 不删除引擎状态 json（那是 deletePipelineRun 的职责，保持互斥）。
 */
export function deleteRelayRun(runId: string): { ok: boolean; removedFiles: string[] } {
  const id = sanitizeRunId(runId);
  const manifest = loadRelayManifest(id);
  const stages = getRelayStages(manifest.baseEngine || 'zcode');
  const runDir = getRelayRunDir(id);
  const removedFiles: string[] = [];

  if (!fs.existsSync(runDir)) return { ok: true, removedFiles };

  // 删除已知的阶段产物
  for (const stage of stages) {
    const filePath = path.join(runDir, stage.artifactFile);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      removedFiles.push(stage.artifactFile);
    }
  }

  // 删除 manifest
  const manifestPath = path.join(runDir, '.manifest.json');
  if (fs.existsSync(manifestPath)) {
    fs.unlinkSync(manifestPath);
    removedFiles.push('.manifest.json');
  }

  // 仅当目录为空时移除，保留用户其他文件
  try {
    const remaining = fs.readdirSync(runDir);
    if (remaining.length === 0) {
      fs.rmdirSync(runDir);
    }
  } catch {
    // 目录读取失败不阻断删除流程
  }

  return { ok: true, removedFiles };
}

/** 读取单个阶段产物的完整内容（用于前端 Markdown 预览）。文件不存在抛错由路由转 404。 */
export function readRelayStageContent(runId: string, stageId: string): {
  runId: string;
  stageId: string;
  path: string;
  exists: boolean;
  content: string;
} {
  const id = sanitizeRunId(runId);
  const manifest = loadRelayManifest(id);
  const stages = getRelayStages(manifest.baseEngine || 'zcode');
  const stage = stages.find(item => item.id === stageId);
  if (!stage) {
    throw new Error(`Unknown relay stage: ${stageId}`);
  }
  const filePath = path.join(getRelayRunDir(id), stage.artifactFile);
  const exists = fs.existsSync(filePath);
  return {
    runId: id,
    stageId,
    path: filePath.replace(/\\/g, '/'),
    exists,
    content: exists ? fs.readFileSync(filePath, 'utf-8') : '',
  };
}

/** promptKind 到记忆召回 target 的映射：测试类→test，审查/交付→review，其余→pipeline */
function promptKindToMemoryTarget(promptKind: PipelineRelayStage['promptKind']): 'pipeline' | 'test' | 'review' {
  switch (promptKind) {
    case 'verification':
      return 'test';
    case 'review':
    case 'handoff':
      return 'review';
    default:
      return 'pipeline';
  }
}

/** promptKind 到 SKILL.md allowed-tools 的映射，参考 getStageTools 的能力分级。 */
function promptKindToAllowedTools(promptKind: PipelineRelayStage['promptKind']): string[] {
  switch (promptKind) {
    case 'orchestrator':
    case 'design':
      return ['Read', 'Glob', 'Grep'];
    case 'discovery':
      return ['Read', 'Glob', 'Grep'];
    case 'implementation':
      return ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
    case 'verification':
      return ['Bash', 'Read', 'Glob', 'Grep'];
    case 'review':
    case 'handoff':
      return ['Read', 'Glob', 'Grep'];
    default:
      return ['Read', 'Glob', 'Grep'];
  }
}

/**
 * 把单个 relay 阶段导出为 SKILL.md 内容字符串（不写本地文件，满足平台独立于本地 Skill 路径）。
 * 用于让单阶段可被外部平台作为 Skill 加载。
 */
export function exportRelayStageAsSkill(stageId: string, baseEngine?: BaseEngine): { filename: string; content: string } {
  const stages = getRelayStages(baseEngine);
  const stage = stages.find(item => item.id === stageId);
  if (!stage) {
    throw new Error(`Unknown relay stage: ${stageId}`);
  }

  const allowedTools = promptKindToAllowedTools(stage.promptKind);
  const dependencies = getStageDependencies(stage, stages)
    .map(dep => dep.id)
    .filter(depId => depId !== stage.id);
  const tags = ['pipeline', 'relay', baseEngine || 'zcode', stage.promptKind];

  const depSection = dependencies.length
    ? [
        '## 前序依赖',
        '执行本阶段前应先读取以下阶段产物作为输入依据：',
        ...dependencies.map(depId => {
          const dep = stages.find(item => item.id === depId);
          return `- ${dep?.name || depId} (${depId})`;
        }),
        '',
      ].join('\n')
    : '## 前序依赖\n本阶段为流程起点，无前序依赖。\n';

  const content = [
    '---',
    `name: ${stage.id}`,
    `description: ${stage.purpose}`,
    `allowed-tools: ["${allowedTools.join('", "')}"]`,
    `tags: ["${tags.join('", "')}"]`,
    dependencies.length ? `dependencies: ["${dependencies.join('", "')}"]` : '',
    '---',
    '',
    `# ${stage.name}`,
    '',
    `## 角色`,
    `阶段类型：${stage.promptKind}；推荐执行者：${stage.ownerLabel}。`,
    '',
    `## 目的`,
    stage.purpose,
    '',
    depSection,
    '## 产物输出要求',
    '- 产物文件：`{{relayRunDir}}/' + stage.artifactFile + '`（relayRunDir 由接力平台在运行时注入）。',
    '- 使用 Markdown，至少包含：结论摘要、输入依据、关键决策、风险/阻塞、下一步建议。',
    '- 完整结果以产物文件为准，回复正文只给简短摘要。',
    '',
    '## 约束',
    '- 后端 HTTP 接口只使用 GET 或 POST，写操作使用 POST。',
    '- 不要提交、推送、部署或执行破坏性操作，除非用户明确授权。',
    '- 平台只负责提示词和产物扫描，不调用模型；本 Skill 由外部执行平台加载。',
    '',
  ].filter(line => line !== '').join('\n');

  return {
    filename: `${stage.id}.SKILL.md`,
    content,
  };
}

function buildArtifactContract(runId: string, stage: PipelineRelayStage): string[] {
  const runDir = getRelayRunDir(runId).replace(/\\/g, '/');
  const artifactPath = path.join(getRelayRunDir(runId), stage.artifactFile).replace(/\\/g, '/');
  return [
    `## 产物写入要求`,
    `- 本阶段产物目录: ${runDir}`,
    `- 本阶段必须写入文件: ${artifactPath}`,
    `- 如果目录不存在，请先创建目录。`,
    `- 文件内容请使用 Markdown，至少包含：结论摘要、输入依据、关键决策、风险/阻塞、下一步建议。`,
    `- 不要把大段无关日志塞进回复；完整结果以产物文件为准，回复里只给简短摘要。`,
  ];
}

function buildRelayContext(requirement: string, projectId: string | undefined, runId: string) {
  const config = getConfig();
  const project = projectId ? config.projects?.find((p: any) => p.id === projectId) : undefined;
  const projectSourcePath = project?.sourcePath || config.aiPlatformRoot || config.projectRoot || '';
  const runDir = getRelayRunDir(runId).replace(/\\/g, '/');
  return { config, project, projectSourcePath, runDir };
}

export function generateRelayStagePrompt(stageId: string, requirement: string, projectId?: string, runId?: string, baseEngine?: BaseEngine): {
  runId: string;
  stageId: string;
  artifactPath: string;
  prompt: string;
} {
  const stages = getRelayStages(baseEngine);
  const stage = stages.find(item => item.id === stageId);
  if (!stage) throw new Error(`Unknown relay stage: ${stageId}`);

  const id = runId ? sanitizeRunId(runId) : createPipelineRelayRunId(requirement);
  registerPipelineRelayRun(id, requirement, projectId, baseEngine);
  const { project, projectSourcePath, runDir } = buildRelayContext(requirement, projectId, id);
  const artifactPath = path.join(getRelayRunDir(id), stage.artifactFile).replace(/\\/g, '/');

  // 按依赖顺序列出本阶段应读取的前序产物（区分强依赖 vs 全部可读产物）
  const dependencies = getStageDependencies(stage, stages);
  const requiredArtifactLines = dependencies.map(dep => {
    const depPath = path.join(getRelayRunDir(id), dep.artifactFile).replace(/\\/g, '/');
    return `- [必读] ${dep.name} (${dep.id}): ${depPath}`;
  });
  const optionalArtifactLines = stages
    .filter(item => item.id !== stage.id && !dependencies.some(dep => dep.id === item.id))
    .map(item => `- [可选] ${item.name}: ${path.join(getRelayRunDir(id), item.artifactFile).replace(/\\/g, '/')}`);
  const hasDependencies = requiredArtifactLines.length > 0;

  const roleLines: Record<PipelineRelayStage['promptKind'], string[]> = {
    orchestrator: [
      `你是本次多平台开发流程的总控 Agent。先不要直接写代码。`,
      `你的任务是追问需求、整理上下文、判断后续哪些阶段需要交给 GLM/ClaudeCode、DeepSeek 或 Codex。`,
    ],
    discovery: [
      `你是代码发现与影响分析 Agent。请在设计前阅读实际源码，不要只凭需求猜测。`,
      `必须定位相关入口、组件、接口、服务、数据模型、文件存储方式、用户身份字段来源和现有加载机制，并列出读过的关键文件路径。`,
      `本阶段只做代码扫描和影响分析，不修改代码，不输出最终设计。`,
    ],
    design: [
      stage.id === 'codex-draft-design'
        ? `你是主设计 Agent。请基于需求澄清产物和代码发现产物输出一份可审阅的初版设计草案，不要改代码。`
        : stage.id === 'glm-design-review'
          ? `你是 GLM/ClaudeCode 设计审阅 Agent。请围绕 Codex 初版设计做可实现性、项目结构和文件计划审阅，不要另起一套方案。`
          : stage.id === 'deepseek-design-review'
            ? `你是 DeepSeek 设计审阅 Agent。请围绕 Codex 初版设计做风险、边界、安全和遗漏审阅，不要另起一套方案。`
            : stage.id === 'claudecode-draft-design'
              ? `你是 ClaudeCode/GLM 主设计 Agent。请基于需求澄清产物和代码发现产物输出一份可审阅的初版设计草案，不要改代码。`
              : stage.id === 'cc-deepseek-design-review'
                ? `你是 DeepSeek 设计审阅 Agent。请围绕 ClaudeCode 初版设计做风险、边界、安全和遗漏审阅，不要另起一套方案。`
                : stage.id === 'claudecode-final-design'
                  ? `你是 ClaudeCode/GLM 最终设计 Agent。请读取初版设计和 DeepSeek 审阅意见，判断采纳与否，修订出唯一最终实现方案。`
                  : `你是最终设计 Agent。请读取初版设计和审阅意见，判断采纳与否，修订出唯一最终实现方案。`,
      `设计审阅阶段只提出问题、补充和修改建议；最终设计阶段才输出后续实现的唯一依据。`,
      `最终设计不要在正文里反复解释旧版哪里不够，直接呈现最终方案。变更说明可放在附录。`,
    ],
    implementation: [
      `你是代码实现 Agent。请严格按照修订定稿后的最终设计方案实现，不要扩大范围。`,
      `实现后记录 changed files、关键 diff 摘要、验证命令和失败/阻塞信息。`,
    ],
    verification: [
      `你是测试验证 Agent。请运行能覆盖本次改动的编译、单测、接口或页面验证。`,
      `如果环境无法运行，说明具体原因，并给出替代静态检查结果。`,
    ],
    review: [
      `你是独立代码审查 Agent。请基于需求、最终方案、实现结果和验证结果审查。`,
      `重点检查安全、性能、可维护性、需求覆盖和回归风险。`,
    ],
    handoff: [
      `你是最终裁判和交付负责人。请读取所有已有产物，合并判断是否需要返工。`,
      `最终输出给用户审批/Pull 的交付摘要。`,
    ],
  };

  // 跨工作流记忆注入：按 promptKind 选择 target 策略
  const memoryTarget = promptKindToMemoryTarget(stage.promptKind);
  const memoryContext = buildWorkflowMemoryContext(memoryTarget, requirement, projectSourcePath);

  const prompt = [
    ...roleLines[stage.promptKind],
    ``,
    `## 当前阶段`,
    `- 阶段: ${stage.name} (${stage.id})`,
    `- 推荐执行者: ${stage.ownerLabel}`,
    `- 阶段目的: ${stage.purpose}`,
    ``,
    `## 原始需求`,
    requirement,
    memoryContext,
    `## 项目`,
    `- 项目名称: ${project?.name || 'AI Platform'}`,
    `- 源码路径: ${projectSourcePath}`,
    `- 接力运行 ID: ${id}`,
    `- 接力产物目录: ${runDir}`,
    ``,
    `## 本阶段应读取的前序产物（按依赖顺序，必读项缺失时先说明）`,
    ...(hasDependencies ? requiredArtifactLines : ['- 本阶段是流程起点，没有必读的前序产物。']),
    ``,
    `## 其他可参考的产物路径`,
    ...(optionalArtifactLines.length ? optionalArtifactLines : ['- 无']),
    ``,
    ...buildArtifactContract(id, stage),
    ``,
    `## 输入依据要求`,
    hasDependencies
      ? `- 回复开头或对应章节必须写明读取了哪些前序产物（文件名），作为本次工作的输入依据。`
      : `- 本阶段是流程起点，可基于原始需求直接开始，但需要在产物中记录已澄清的需求要点。`,
    ``,
    `## 项目约束`,
    `- 平台本身不调用模型，本提示词由用户复制到对应平台执行。`,
    `- 后端 HTTP 接口只使用 GET 或 POST，写操作使用 POST。`,
    `- 生成文档放在 doc/ 或本次接力产物目录中。`,
    `- 保留用户已有改动，不要回退未确认的变更。`,
    `- 提交、推送、部署、删除文件等动作必须得到用户明确授权。`,
  ].join('\n');

  // trace：提示词生成
  tracePromptGenerated(id, `生成阶段提示词：${stage.name} (${stageId})`, {
    stageId,
    stageName: stage.name,
    promptKind: stage.promptKind,
    artifactPath,
    baseEngine: baseEngine || 'zcode',
  });

  // trace：产物依赖（本阶段应读取哪些前序产物）
  if (dependencies.length > 0) {
    traceArtifactDependency(id, `阶段「${stage.name}」依赖前序产物`, {
      stageId,
      dependencies: dependencies.map(dep => dep.artifactFile),
      promptKind: stage.promptKind,
    });
  }

  return { runId: id, stageId, artifactPath, prompt };
}

export function generateRelayContinuationPrompt(runId: string, stageIds: string[], requirement?: string, projectId?: string): {
  runId: string;
  stageIds: string[];
  prompt: string;
} {
  const id = sanitizeRunId(runId);
  const manifest = loadRelayManifest(id);
  const req = requirement || manifest.requirement || '请先读取已有产物，恢复本次需求上下文。';
  const pid = projectId || manifest.projectId || undefined;
  const baseEngine: BaseEngine = manifest.baseEngine || 'zcode';
  const relayStages = getRelayStages(baseEngine);
  registerPipelineRelayRun(id, req, pid, baseEngine);

  const selected = stageIds
    .map(stageId => relayStages.find(stage => stage.id === stageId))
    .filter((stage): stage is PipelineRelayStage => !!stage);
  selected.sort((a, b) => relayStages.findIndex(stage => stage.id === a.id) - relayStages.findIndex(stage => stage.id === b.id));
  if (!selected.length) throw new Error('请选择至少一个接力阶段');

  const { project, projectSourcePath, runDir } = buildRelayContext(req, pid, id);
  const allArtifacts = relayStages.map(stage => {
    const filePath = path.join(getRelayRunDir(id), stage.artifactFile).replace(/\\/g, '/');
    return `- ${stage.name} (${stage.id}): ${filePath}`;
  });
  const selectedLines = selected.map((stage, index) => {
    const filePath = path.join(getRelayRunDir(id), stage.artifactFile).replace(/\\/g, '/');
    return `${index + 1}. ${stage.name} (${stage.id}) -> ${filePath}`;
  });

  const prompt = [
    `你将继续一个已经中断或分阶段执行的多平台接力任务。请不要从头重开需求。`,
    ``,
    `## 继续执行目标`,
    `按顺序完成我选中的阶段，并把每个阶段的结果写入对应产物文件。`,
    ``,
    `## 项目`,
    `- 项目名称: ${project?.name || 'AI Platform'}`,
    `- 源码路径: ${projectSourcePath}`,
    `- 接力运行 ID: ${id}`,
    `- 产物目录: ${runDir}`,
    ``,
    `## 原始需求`,
    req,
    ``,
    `## 本次选中阶段`,
    ...selectedLines,
    ``,
    `## 全部阶段产物路径`,
    ...allArtifacts,
    ``,
    `## 执行规则`,
    `1. 先读取已有产物，恢复上下文；不要重复已经完成且不在本次选中列表里的阶段。`,
    `2. 每个选中阶段开始前，先读取它的前序产物（设计阶段读需求澄清+代码发现；实现读最终设计；验证读实现+最终设计；审查读最终设计+实现+验证；交付读全部），在回复里写明读取了哪些产物文件名作为输入依据。`,
    `3. 严格按“本次选中阶段”的顺序执行。`,
    `4. 如果某个选中阶段依赖的前序产物缺失，请先说明缺失项；能补足则补足，不能补足则写入阻塞说明。`,
    `5. 每完成一个阶段，都必须写入对应 Markdown 产物文件。`,
    `6. 如果当前环境不能写文件，请输出完整 Markdown 产物内容，并标明应保存到哪个路径。`,
    `7. 不要提交、推送、部署或执行破坏性操作，除非用户明确授权。`,
    `8. 后端 HTTP 接口只使用 GET 或 POST，写操作使用 POST。`,
    ``,
    `## 结束输出`,
    `最后用简短列表说明：已完成哪些阶段、写入了哪些文件、哪些阶段仍阻塞或待继续。`,
  ].join('\n');

  // trace：续跑提示词生成
  tracePromptGenerated(id, `生成续跑提示词：${selected.length} 个阶段`, {
    mode: 'continuation',
    stageIds: selected.map(stage => stage.id),
    baseEngine,
  });

  return { runId: id, stageIds: selected.map(stage => stage.id), prompt };
}

/** 为前端生成可直接交给 Codex 的主流程提示词 */
export function generateCodexHandoffPrompt(requirement: string, projectId?: string, relayRunId?: string): string {
  const config = getConfig();
  const project = projectId
    ? config.projects?.find((p: any) => p.id === projectId)
    : undefined;
  const runId = relayRunId ? sanitizeRunId(relayRunId) : createPipelineRelayRunId(requirement);
  const relayPlan = getPipelineRelayPlan(runId);
  const projectSourcePath = project?.sourcePath || config.aiPlatformRoot || config.projectRoot || '';

  return [
    `你将接手一个新的多平台接力开发需求。请先不要直接写代码。`,
    ``,
    `## 需求`,
    requirement,
    ``,
    `## 项目`,
    `- 项目名称: ${project?.name || 'AI Platform'}`,
    `- 源码路径: ${projectSourcePath}`,
    `- 接力运行 ID: ${runId}`,
    `- 产物目录: ${relayPlan.runDir}`,
    ``,
    `## 上下文读取`,
    `启动后请先读项目根的 AGENTS.md（接力上下文已自动写入其中），里面记录了当前阶段、产物路径和冷库记忆。`,
    `如果 AGENTS.md 没有接力上下文区块，以本提示词为准。`,
    ``,
    `## 工作方式`,
    `1. 先进入“需求澄清模式”：根据我的原始需求，连续提出必要问题。`,
    `2. 信息足够后，写入 ${path.join(getRelayRunDir(runId), '01-codex-intake.md').replace(/\\/g, '/')}。`,
    `3. 不要把平台当成模型调用器；平台只负责提示词、配置和扫描产物目录。`,
    `4. 需求澄清后先做代码发现与影响分析，必须阅读实际源码并写入 02-code-discovery.md。`,
    `5. 设计阶段由 Codex 基于需求澄清和代码发现先产出初版设计，再把初版交给 GLM/ClaudeCode 和 DeepSeek 做小轮审阅，最后由 Codex 修订定稿。`,
    `6. GLM/DeepSeek 的设计阶段职责是审阅 Codex 初稿，不是另起一套平行方案。`,
    `7. 代码实现可由 Codex 直接做小改动；大改动优先生成交接包给 ClaudeCode/外部平台。`,
    `8. 代码审查由 DeepSeek 独立审查，Codex 最终裁判和交付。`,
    ``,
    `## 澄清问题覆盖范围`,
    `- 目标用户和使用场景`,
    `- 页面/交互/状态/权限要求`,
    `- 数据来源、字段、存储和兼容要求`,
    `- 后端接口、错误处理和边界条件`,
    `- 测试和验收标准`,
    `- 是否需要文档、迁移、部署或回滚说明`,
    ``,
    `## 约束`,
    `- 不要提交、推送、部署或创建 PR，除非用户在当前会话明确要求。`,
    `- 后端 HTTP 接口只使用 GET 或 POST。`,
    `- 生成文档放在 doc/ 目录。`,
    `- 保留用户已有改动，不要回退未确认的变更。`,
    `- 如果本地环境无法运行某项验证，说明原因，并用可替代的静态检查或局部验证补足。`,
    ``,
    `## 接力阶段产物`,
    ...relayPlan.stages.map(stage => `- ${stage.name} (${stage.ownerLabel}): ${relayPlan.runDir}/${stage.artifactFile}`),
  ].join('\n');
}

/** 为前端生成可直接交给 ClaudeCode/GLM 的主流程提示词 */
export function generateClaudeCodeHandoffPrompt(requirement: string, projectId?: string, relayRunId?: string): string {
  const config = getConfig();
  const project = projectId
    ? config.projects?.find((p: any) => p.id === projectId)
    : undefined;
  const runId = relayRunId ? sanitizeRunId(relayRunId) : createPipelineRelayRunId(requirement);
  registerPipelineRelayRun(runId, requirement, projectId, 'claudecode');
  const relayPlan = getPipelineRelayPlan(runId, 'claudecode');
  const projectSourcePath = project?.sourcePath || config.aiPlatformRoot || config.projectRoot || '';

  return [
    `你将接手一个新的 ClaudeCode/GLM 接力开发需求。请先不要直接写代码。`,
    ``,
    `## 需求`,
    requirement,
    ``,
    `## 项目`,
    `- 项目名称: ${project?.name || 'AI Platform'}`,
    `- 源码路径: ${projectSourcePath}`,
    `- 接力运行 ID: ${runId}`,
    `- 产物目录: ${relayPlan.runDir}`,
    `- 底座引擎: ClaudeCode (GLM)`,
    ``,
    `## 上下文读取`,
    `启动后请先读项目根的 AGENTS.md（接力上下文已自动写入其中），里面记录了当前阶段、产物路径和冷库记忆。`,
    `如果 AGENTS.md 没有接力上下文区块，以本提示词为准。`,
    ``,
    `## 工作方式`,
    `1. 先进入"需求澄清模式"：根据我的原始需求，连续提出必要问题。`,
    `2. 信息足够后，写入 ${path.join(getRelayRunDir(runId), '01-cc-intake.md').replace(/\\/g, '/')}。`,
    `3. 不要把平台当成模型调用器；平台只负责提示词、配置和扫描产物目录。`,
    `4. 需求澄清后先做代码发现与影响分析，必须阅读实际源码并写入 02-cc-code-discovery.md。`,
    `5. ClaudeCode/GLM 基于需求澄清和代码发现产出初版设计，再把初版交给 DeepSeek 做风险/边界审阅。`,
    `6. 注意：本模式下 ClaudeCode/GLM 既是总控也是执行者，不需要单独的 GLM 设计审阅。`,
    `7. DeepSeek 审阅后，ClaudeCode/GLM 修订定稿，然后直接进入代码实现。`,
    `8. 代码审查由 DeepSeek 独立审查，ClaudeCode/GLM 最终裁判和交付。`,
    ``,
    `## 澄清问题覆盖范围`,
    `- 目标用户和使用场景`,
    `- 页面/交互/状态/权限要求`,
    `- 数据来源、字段、存储和兼容要求`,
    `- 后端接口、错误处理和边界条件`,
    `- 测试和验收标准`,
    `- 是否需要文档、迁移、部署或回滚说明`,
    ``,
    `## 约束`,
    `- 不要提交、推送、部署或创建 PR，除非用户在当前会话明确要求。`,
    `- 后端 HTTP 接口只使用 GET 或 POST。`,
    `- 生成文档放在 doc/ 目录。`,
    `- 保留用户已有改动，不要回退未确认的变更。`,
    `- 如果本地环境无法运行某项验证，说明原因，并用可替代的静态检查或局部验证补足。`,
    ``,
    `## 接力阶段产物`,
    ...relayPlan.stages.map(stage => `- ${stage.name} (${stage.ownerLabel}): ${relayPlan.runDir}/${stage.artifactFile}`),
  ].join('\n');
}

/** 为前端生成指定阶段的提示词（用于复制） */
export function generateStagePrompt(stageId: string, requirement: string, projectId?: string): string {
  const stage = PIPELINE_STAGES.find(s => s.id === stageId);
  if (!stage) throw new Error(`Unknown stage: ${stageId}`);

  const mockRun: PipelineRun = {
    id: '__preview__',
    requirement,
    projectId,
    status: 'running',
    stages: PIPELINE_STAGES.map(s => ({
      stageId: s.id,
      status: 'pending' as StageStatus,
      input: {},
      output: {},
    })),
    context: {},
    startedAt: new Date().toISOString(),
    currentStageIndex: 0,
    logs: [],
  };

  return buildStagePrompt(stage, mockRun);
}

export function startPipeline(
  requirement: string,
  projectId: string | undefined,
  emitter: EventEmitter
): PipelineRun {
  const run: PipelineRun = {
    id: uuid(),
    requirement,
    projectId,
    status: 'running',
    stages: PIPELINE_STAGES.map((s) => ({
      stageId: s.id,
      status: 'pending' as StageStatus,
      input: {},
      output: {},
    })),
    context: {},
    startedAt: new Date().toISOString(),
    currentStageIndex: 0,
    logs: [],
  };

  deletedRunIds.delete(run.id);
  activeRuns.set(run.id, run);
  saveRunState(run);

  executeAllStages(run, emitter).catch((err) => {
    run.status = 'failed';
    run.finishedAt = new Date().toISOString();
    addLog(run, 'error', `Pipeline crashed: ${err}`);
    saveRunState(run);
    emitter.emit('pipeline:failed', { runId: run.id, error: String(err) });
  });

  return run;
}

export function confirmPipelineStage(runId: string): void {
  const run = activeRuns.get(runId) || loadRunState(runId);
  if (!run || run.status !== 'paused') return;

  const stageRun = run.stages[run.currentStageIndex];
  if (stageRun) stageRun.status = 'success';
  run.status = 'running';
  saveRunState(run);
}

export function abortPipeline(runId: string): void {
  const run = activeRuns.get(runId);
  if (run) {
    run.status = 'aborted';
    run.finishedAt = new Date().toISOString();
    saveRunState(run);
  }
}

export function deletePipelineRun(runId: string): boolean {
  deletedRunIds.add(runId);
  const active = activeRuns.get(runId);
  if (active) {
    active.status = 'aborted';
    active.finishedAt = new Date().toISOString();
    activeRuns.delete(runId);
  }

  const filePath = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(filePath)) return !!active;

  fs.unlinkSync(filePath);
  return true;
}

export function resumePipeline(runId: string, emitter: EventEmitter): PipelineRun {
  const run = loadRunState(runId);
  if (!run) throw new Error(`Pipeline run not found: ${runId}`);
  if (run.status !== 'paused' && run.status !== 'failed') {
    throw new Error(`Cannot resume run in status: ${run.status}`);
  }

  run.status = 'running';
  saveRunState(run);
  activeRuns.set(run.id, run);

  addLog(run, 'info', `Resuming from stage ${run.currentStageIndex}`);

  executeAllStages(run, emitter).catch((err) => {
    run.status = 'failed';
    run.finishedAt = new Date().toISOString();
    addLog(run, 'error', `Resume failed: ${err}`);
    saveRunState(run);
    emitter.emit('pipeline:failed', { runId: run.id, error: String(err) });
  });

  return run;
}

export function getPipelineRun(runId: string): PipelineRun | undefined {
  return activeRuns.get(runId) || loadRunState(runId);
}

export function listPipelineRuns(): PipelineRun[] {
  const diskRuns: PipelineRun[] = [];
  if (fs.existsSync(RUNS_DIR)) {
    for (const f of fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json'))) {
      try {
        diskRuns.push(JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf-8')));
      } catch { /* skip */ }
    }
  }
  const memoryIds = new Set(activeRuns.keys());
  return [...activeRuns.values(), ...diskRuns.filter((r) => !memoryIds.has(r.id))]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export function listKnowledgeEntries(): Array<{ runId: string; requirement: string; success: boolean; completedAt?: string }> {
  ensureDir(KNOWLEDGE_DIR);
  const entries: Array<{ runId: string; requirement: string; success: boolean; completedAt?: string }> = [];
  for (const f of fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf-8'));
      entries.push({ runId: data.runId, requirement: data.requirement, success: data.success, completedAt: data.completedAt });
    } catch { /* skip */ }
  }
  return entries;
}

/**
 * 生成交付报告：汇总需求、阶段完成情况、变更文件、风险、验收标准。
 * 读所有阶段产物 + trace + 质量门状态，输出一份 Markdown。
 * 同时写入产物目录 DELIVERY-REPORT.md。
 */
export function generateDeliveryReport(runId: string): { reportPath: string; content: string } {
  const id = sanitizeRunId(runId);
  const scan = scanPipelineArtifacts(id);
  const manifest = loadRelayManifest(id);
  const runDir = getRelayRunDir(id);

  const lines: string[] = [
    `# 交付报告 · ${id}`,
    '',
    `> 生成时间：${new Date().toISOString()}`,
    `> 底座引擎：${scan.baseEngine}`,
    `> 产物目录：${scan.runDir}`,
    '',
    '## 需求',
    '',
    manifest.requirement || '（未填写）',
    '',
    '## 阶段完成情况',
    '',
    '| # | 阶段 | 执行者 | 状态 | 质量 | 标记 |',
    '|---|---|---|---|---|---|',
  ];

  let doneCount = 0;
  let skippedCount = 0;
  scan.stages.forEach((stage: any, i: number) => {
    const status = stage.exists ? '✅ 已生成' : '⬜ 未生成';
    const mark = stage.stageMark || '-';
    if (stage.quality === 'ok' || stage.stageMark === 'accepted') doneCount++;
    if (!stage.exists) skippedCount++;
    lines.push(`| ${i + 1} | ${stage.name} | ${stage.ownerLabel} | ${status} | ${stage.quality} | ${mark} |`);
  });

  lines.push('', '## 质量门摘要', '');
  lines.push(`- 合格阶段：${scan.stages.filter(s => s.quality === 'ok').length} / ${scan.stages.length}`);
  lines.push(`- 通过/跳过：${doneCount} 通过，${skippedCount} 跳过`);
  lines.push(`- 待补齐：${scan.stages.filter(s => s.quality !== 'ok' && s.stageMark !== 'accepted' && s.stageMark !== 'skipped').length}`);

  // 从实现阶段产物提取变更文件
  const implStage = scan.stages.find(s => s.promptKind === 'implementation');
  if (implStage?.exists) {
    const content = fs.readFileSync(path.join(runDir, implStage.artifactFile), 'utf-8');
    const fileMatches = content.match(/[\w./\\-]+\.(ts|tsx|vue|java|js|json|xml|sql|md)/gi);
    if (fileMatches && fileMatches.length > 0) {
      const unique = [...new Set(fileMatches)].slice(0, 20);
      lines.push('', '## 涉及文件', '');
      unique.forEach(f => lines.push(`- \`${f}\``));
    }
  }

  // 风险收集（从各阶段产物提取风险关键词）
  const risks: string[] = [];
  for (const stage of scan.stages) {
    if (!stage.exists) continue;
    const content = fs.readFileSync(path.join(runDir, stage.artifactFile), 'utf-8');
    const riskMatches = content.match(/(风险|阻塞|block|注意|待确认|TODO)[^\n]{0,80}/gi);
    if (riskMatches) risks.push(...riskMatches.slice(0, 3));
  }
  if (risks.length > 0) {
    lines.push('', '## 风险与待办', '');
    [...new Set(risks)].slice(0, 10).forEach(r => lines.push(`- ${r}`));
  }

  lines.push('', '## 验收建议', '');
  lines.push('- [ ] 编译/构建通过');
  lines.push('- [ ] 核心功能验证');
  lines.push('- [ ] 边界条件检查');
  lines.push('- [ ] 无破坏性变更（不影响现有功能）');

  const content = lines.join('\n');

  // 写入产物目录
  if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
  const reportPath = path.join(runDir, 'DELIVERY-REPORT.md');
  fs.writeFileSync(reportPath, content, 'utf-8');

  return { reportPath: reportPath.replace(/\\/g, '/'), content };
}
