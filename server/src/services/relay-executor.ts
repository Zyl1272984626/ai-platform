/**
 * 接力流水线执行器（P2）
 *
 * DeepSeek API 执行器：纯 HTTP 调用，无 CLI / 无 GUI。用于设计审阅 / 代码审查阶段。
 * 调用 DeepSeek，读取前序产物作为上下文，把结果写入阶段产物文件。
 *
 * 开关存储在 platform-config.json 的 relayExecutorConfig，默认关闭。
 * 遵守交接文档 §11「不要把产品变回伪自动化」：实现/验证/交付等高风险阶段不接入执行器，
 * 由用户复制提示词到 Codex/ClaudeCode/ZCode 等外部平台执行。
 *
 * Shell 自构建执行器已移除（功能鸡肋：写代码时本来就在终端，再切网页点按钮没有更省事，
 * 且只能跑平台自己的 build，做别的项目需求时用不上）。
 */
import fs from 'fs';
import path from 'path';
import { getConfig, updateConfig } from './config.js';
import { chatWithDeepSeek, isDeepSeekAvailable } from './deepseek-client.js';
import {
  getRelayRunDir,
  getRelayStages,
  type BaseEngine,
  type PipelineRelayStage,
} from './pipeline-engine.js';

// ========== 类型 ==========

export interface RelayExecutorConfig {
  /** DeepSeek 执行器总开关，默认 false */
  deepseekEnabled: boolean;
  /** DeepSeek 单次调用最大 token，默认 4096 */
  deepseekMaxTokens: number;
}

export interface ExecutorResult {
  ok: boolean;
  executor: 'deepseek';
  stageId: string;
  artifactPath?: string;
  output: string;
  durationMs: number;
  error?: string;
  meta?: Record<string, unknown>;
}

// ========== 开关读取（运行时可改，避免每次重启） ==========

let runtimeExecutorConfig: RelayExecutorConfig = {
  deepseekEnabled: false,
  deepseekMaxTokens: 4096,
};

/** 从 platform-config.json 加载执行器开关。启动时调用一次。 */
export function initExecutorConfig(): RelayExecutorConfig {
  const config = getConfig();
  const saved = (config as any).relayExecutorConfig;
  if (saved && typeof saved === 'object') {
    runtimeExecutorConfig = {
      deepseekEnabled: !!saved.deepseekEnabled,
      deepseekMaxTokens: Number(saved.deepseekMaxTokens) || 4096,
    };
  }
  return { ...runtimeExecutorConfig };
}

export function getExecutorConfig(): RelayExecutorConfig {
  return { ...runtimeExecutorConfig };
}

export function updateExecutorConfig(updates: Partial<RelayExecutorConfig>): RelayExecutorConfig {
  runtimeExecutorConfig = { ...runtimeExecutorConfig, ...updates };
  // 持久化到 platform-config.json，重启后保留
  try {
    updateConfig({ relayExecutorConfig: { ...runtimeExecutorConfig } } as any);
  } catch (err) {
    console.warn('[RelayExecutor] persist config failed:', (err as Error)?.message || err);
  }
  return { ...runtimeExecutorConfig };
}

// ========== 工具函数 ==========

function readArtifactContent(runId: string, stage: PipelineRelayStage): string | undefined {
  const filePath = path.join(getRelayRunDir(runId), stage.artifactFile);
  if (!fs.existsSync(filePath)) return undefined;
  return fs.readFileSync(filePath, 'utf-8');
}

/** 收集本阶段前序产物内容作为 DeepSeek 输入上下文 */
function collectDependencyContext(runId: string, stage: PipelineRelayStage, allStages: PipelineRelayStage[]): {
  context: string;
  dependencies: string[];
} {
  const dependencies: string[] = [];
  const parts: string[] = [];

  // 复用 pipeline-engine 的依赖判定逻辑（按 promptKind）
  for (const dep of allStages) {
    if (dep.id === stage.id) continue;
    const isDep = isDependencyOf(stage, dep);
    if (!isDep) continue;
    const content = readArtifactContent(runId, dep);
    dependencies.push(dep.artifactFile);
    parts.push(`### 前序产物：${dep.name} (${dep.artifactFile})\n${content || '（尚未生成）'}`);
  }

  return { context: parts.join('\n\n'), dependencies };
}

function isDependencyOf(stage: PipelineRelayStage, candidate: PipelineRelayStage): boolean {
  // 与 pipeline-engine.getStageDependencies 的 promptKind 依赖规则对齐
  switch (stage.promptKind) {
    case 'orchestrator':
      return false;
    case 'discovery':
      return candidate.promptKind === 'orchestrator';
    case 'design':
      return candidate.promptKind === 'orchestrator' || candidate.promptKind === 'discovery';
    case 'implementation':
      return candidate.id.includes('final-design') || candidate.promptKind === 'design';
    case 'verification':
      return candidate.promptKind === 'implementation' || candidate.id.includes('final-design');
    case 'review':
      return candidate.id.includes('final-design') || candidate.promptKind === 'implementation' || candidate.promptKind === 'verification';
    case 'handoff':
      return candidate.id !== stage.id;
    default:
      return false;
  }
}

// ========== DeepSeek 执行器 ==========

/**
 * 用 DeepSeek 执行一个 relay 阶段：读取前序产物 → 调用 DeepSeek → 写入阶段产物文件。
 * 仅对设计审阅 / 代码审查类阶段有意义；其他阶段会拒绝（避免滥用）。
 */
export async function executeRelayStageWithDeepSeek(
  runId: string,
  stageId: string,
  requirement: string,
  baseEngine?: BaseEngine,
): Promise<ExecutorResult> {
  const start = Date.now();
  const executor = 'deepseek';

  if (!runtimeExecutorConfig.deepseekEnabled) {
    return fail(executor, stageId, start, 'DeepSeek 执行器未开启（在模型 Tab 打开开关）');
  }
  if (!isDeepSeekAvailable()) {
    return fail(executor, stageId, start, 'DeepSeek API Key 未配置');
  }

  const stages = getRelayStages(baseEngine);
  const stage = stages.find(item => item.id === stageId);
  if (!stage) {
    return fail(executor, stageId, start, `未知阶段: ${stageId}`);
  }

  // 安全门：DeepSeek 只用于审阅类阶段，不替代实现/交付裁判（那些风险更高）
  const allowedKinds = ['design', 'review'] as const;
  if (!allowedKinds.includes(stage.promptKind as typeof allowedKinds[number])) {
    return fail(executor, stageId, start, `DeepSeek 执行器仅支持 design/review 阶段，当前为 ${stage.promptKind}`);
  }

  const { context, dependencies } = collectDependencyContext(runId, stage, stages);

  const prompt = [
    `你是 ${stage.ownerLabel}，负责接力阶段：${stage.name}。`,
    `阶段目的：${stage.purpose}`,
    '',
    '## 原始需求',
    requirement || '（未提供，请从前序产物推断）',
    '',
    '## 前序产物（输入依据）',
    context || '（无前序产物，请说明信息不足）',
    '',
    '## 输出要求',
    `请输出本阶段的审阅/分析结果，使用 Markdown。`,
    '必须包含：结论摘要、输入依据（引用了哪些前序产物）、关键发现、风险/阻塞、下一步建议。',
    '围绕给定产物做审阅，不要另起一套平行方案。',
  ].join('\n');

  try {
    const response = await chatWithDeepSeek(
      [
        { role: 'system', content: '你是一个严格的多平台接力审阅 Agent。只基于给定产物做审阅，不编造未提供的代码细节。' },
        { role: 'user', content: prompt },
      ],
      { maxTokens: runtimeExecutorConfig.deepseekMaxTokens, temperature: 0.2 },
    );

    const artifactPath = path.join(getRelayRunDir(runId), stage.artifactFile);
    const header = [
      `<!-- 由 DeepSeek 执行器生成，${new Date().toISOString()} -->`,
      `# ${stage.name}`,
      '',
      `> 阶段：${stageId} | 执行者：${stage.ownerLabel} | 输入依据：${dependencies.join(', ') || '无'}`,
      '',
    ].join('\n');
    fs.writeFileSync(artifactPath, `${header}\n${response.content}`, 'utf-8');

    return {
      ok: true,
      executor,
      stageId,
      artifactPath: artifactPath.replace(/\\/g, '/'),
      output: response.content,
      durationMs: Date.now() - start,
      meta: {
        model: response.model,
        dependencies,
        usage: response.usage,
      },
    };
  } catch (err) {
    return fail(executor, stageId, start, (err as Error)?.message || String(err));
  }
}

function fail(executor: 'deepseek', stageId: string, start: number, error: string): ExecutorResult {
  return { ok: false, executor, stageId, output: '', durationMs: Date.now() - start, error };
}
