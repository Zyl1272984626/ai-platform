import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { fileURLToPath } from 'url';
import { getProjectById } from './config.js';
import { getTask } from './task-store.js';
import { getTaskGraph, stopTaskGraph, updateGraphWorker } from './task-graph-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.AI_PLATFORM_BASE || 'http://127.0.0.1:3100';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ActiveRunner {
  key: string;
  projectId: string;
  taskId: string;
  workerId: string;
  process: ChildProcessWithoutNullStreams;
  pending: Map<number, PendingRequest>;
  nextId: number;
  stopped: boolean;
  stderrTail: string[];
}

const activeRunners = new Map<string, ActiveRunner>();

function runnerKey(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`;
}

function resolveCodexBinary(): string {
  if (process.platform !== 'win32') return 'codex';
  if (process.env.CODEX_CLI_PATH && fs.existsSync(process.env.CODEX_CLI_PATH)) return process.env.CODEX_CLI_PATH;
  const vendorSuffix = path.join('vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  const projectBinaries = [
    path.resolve(__dirname, '../../node_modules/@openai/codex-win32-x64', vendorSuffix),
    path.resolve(__dirname, '../../node_modules/@openai/codex/node_modules/@openai/codex-win32-x64', vendorSuffix),
  ];
  const projectBinary = projectBinaries.find(candidate => fs.existsSync(candidate));
  if (projectBinary) return projectBinary;
  try {
    const matches = execFileSync('where.exe', ['codex'], { encoding: 'utf-8', windowsHide: true })
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean);
    for (const commandFile of matches.filter(item => item.toLowerCase().endsWith('.cmd'))) {
      const vendorBinary = path.join(
        path.dirname(commandFile),
        'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64',
        'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe',
      );
      if (fs.existsSync(vendorBinary)) return vendorBinary;
    }
    return matches.find(item => item.toLowerCase().endsWith('.exe')) || 'codex';
  } catch {
    return 'codex';
  }
}

function resolveGraphMcpEntry(): string {
  const candidates = [
    path.resolve(__dirname, '../mcp/task-graph-server.js'),
    path.resolve(__dirname, '../../dist/mcp/task-graph-server.js'),
  ];
  const entry = candidates.find(candidate => fs.existsSync(candidate));
  if (!entry) throw new Error('Graph MCP 尚未构建，请先在 server 目录运行 npm run build');
  return entry;
}

function request(runner: ActiveRunner, method: string, params: unknown, timeoutMs = 30_000): Promise<any> {
  const id = runner.nextId++;
  runner.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      runner.pending.delete(id);
      reject(new Error(`${method} 请求超时`));
    }, timeoutMs);
    runner.pending.set(id, { resolve, reject, timer });
  });
}

function notify(runner: ActiveRunner, method: string, params: unknown = {}): void {
  runner.process.stdin.write(`${JSON.stringify({ method, params })}\n`);
}

function supervisorPrompt(projectId: string, taskId: string, workerId: string): string {
  return [
    '你是 AI Platform 动态研发 Graph 的 Codex 主控执行者。',
    `projectId=${projectId}`,
    `taskId=${taskId}`,
    `workerId=${workerId}`,
    '',
    '必须使用 ai-platform-graph MCP 推进任务，不要把最终文字总结当作节点完成。',
    '执行循环：',
    '1. 调用 get_graph 读取任务和 Graph。',
    '2. 调用 claim_node 领取一个 runnable 节点，再调用 get_node_context。',
    '3. 严格在节点范围内读取、修改和验证；任务复杂且有真正独立工作时可以创建子智能体并行处理。',
    '4. 每个节点至少通过 append_node_evidence 回写一条当前机器的真实证据，再调用 complete_node。',
    '5. 失败时调用 fail_node；业务歧义、高风险操作、跨工作区写入、外部部署或权限升级时调用 request_human_decision。',
    '6. 完成后继续 claim_node，直到 Graph 为 completed、waiting_human、failed 或 stopped。',
    '7. 技术门禁只有在证据确实支持时才调用 evaluate_gate；不得调用 accept 接口代替人工验收。',
    '8. 不要修改 AI Platform 自己的 Graph 状态文件；所有控制状态都通过 MCP 写回。',
    '',
    '现在从 get_graph 开始执行。',
  ].join('\n');
}

function threadDisplayName(taskTitle: string): string {
  const normalized = taskTitle.replace(/\s+/g, ' ').trim() || '未命名研发任务';
  const prefix = '[自动研发] ';
  const maxTitleLength = 80;
  const available = maxTitleLength - prefix.length;
  return `${prefix}${normalized.length > available ? `${normalized.slice(0, available - 1)}…` : normalized}`;
}

function finishRunner(runner: ActiveRunner, status: 'completed' | 'failed' | 'stopped', message: string): void {
  if (runner.stopped && status !== 'stopped') return;
  if (status === 'stopped') runner.stopped = true;
  activeRunners.delete(runner.key);
  for (const pending of runner.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(message));
  }
  runner.pending.clear();
  try {
    updateGraphWorker(runner.projectId, runner.taskId, {
      status,
      message,
      endedAt: new Date().toISOString(),
    }, `Codex Worker ${status}：${message}`);
  } catch {
    // Graph may have been archived or removed; process cleanup must still finish.
  }
}

function attachProtocol(runner: ActiveRunner): void {
  const output = readline.createInterface({ input: runner.process.stdout });
  output.on('line', line => {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message.id === 'number' && !message.method) {
      const pending = runner.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      runner.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === 'turn/completed') {
      const graph = getTaskGraph(runner.projectId, runner.taskId);
      finishRunner(runner, 'completed', `Codex turn 已结束；Graph=${graph?.status || 'unknown'}`);
      runner.process.kill();
      return;
    }
    if (message.method === 'turn/failed') {
      const detail = message.params?.turn?.error?.message || 'Codex turn failed';
      finishRunner(runner, 'failed', detail);
      runner.process.kill();
      return;
    }
    if (message.id !== undefined && message.method) {
      runner.process.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: `不支持的服务端请求：${message.method}` } })}\n`);
    }
  });
  runner.process.stderr.on('data', chunk => {
    const lines = String(chunk).split(/\r?\n/).filter(Boolean);
    runner.stderrTail.push(...lines);
    runner.stderrTail = runner.stderrTail.slice(-20);
  });
  runner.process.on('error', error => finishRunner(runner, 'failed', error.message));
  runner.process.on('exit', code => {
    if (!runner.stopped && activeRunners.has(runner.key)) {
      finishRunner(runner, code === 0 ? 'completed' : 'failed', `Codex app-server exit ${code}; ${runner.stderrTail.slice(-3).join(' | ')}`);
    }
  });
}

export async function startCodexGraphRunner(projectId: string, taskId: string): Promise<ReturnType<typeof getTaskGraph>> {
  const key = runnerKey(projectId, taskId);
  if (activeRunners.has(key)) throw new Error('该任务的 Codex Worker 已在运行');
  const task = getTask(projectId, taskId);
  const project = getProjectById(projectId);
  const graph = getTaskGraph(projectId, taskId);
  if (!task || !project || !graph) throw new Error('任务、项目或执行图不存在');
  if (!project.sourcePath || !fs.existsSync(project.sourcePath)) throw new Error('项目 sourcePath 不存在，无法启动 Codex');
  const mcpEntry = resolveGraphMcpEntry();
  const codexBinary = resolveCodexBinary();
  const workerId = `codex-${graph.id.slice(0, 8)}`;
  const configArgs = [
    `mcp_servers.ai_platform_graph.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.ai_platform_graph.args=${JSON.stringify([mcpEntry])}`,
    `mcp_servers.ai_platform_graph.env={AI_PLATFORM_BASE=${JSON.stringify(API_BASE)}}`,
    'mcp_servers.ai_platform_graph.required=true',
    'mcp_servers.ai_platform_graph.default_tools_approval_mode="approve"',
  ];
  const args = ['app-server', '--stdio'];
  for (const config of configArgs) args.push('-c', config);
  const child = spawn(codexBinary, args, {
    cwd: project.sourcePath,
    env: { ...process.env },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const runner: ActiveRunner = {
    key,
    projectId,
    taskId,
    workerId,
    process: child,
    pending: new Map(),
    nextId: 1,
    stopped: false,
    stderrTail: [],
  };
  activeRunners.set(key, runner);
  attachProtocol(runner);
  updateGraphWorker(projectId, taskId, {
    status: 'starting',
    pid: child.pid,
    message: '正在初始化 Codex app-server 与 Graph MCP',
    startedAt: new Date().toISOString(),
  }, 'Codex Worker 正在启动');

  try {
    await request(runner, 'initialize', {
      clientInfo: { name: 'ai-platform', version: '0.2.0' },
      capabilities: { experimentalApi: true },
    });
    notify(runner, 'initialized');
    const threadResult = await request(runner, 'thread/start', {
      cwd: path.resolve(project.sourcePath),
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      ephemeral: false,
      developerInstructions: '你由 AI Platform 动态 Graph 调度。必须遵守项目 AGENTS.md、任务范围、MCP 证据协议和人工验收边界。',
      config: {
        mcp_servers: {
          ai_platform_graph: {
            command: process.execPath,
            args: [mcpEntry],
            env: { AI_PLATFORM_BASE: API_BASE },
            required: true,
            default_tools_approval_mode: 'approve',
          },
        },
      },
    }, 60_000);
    const threadId = threadResult?.thread?.id;
    if (!threadId) throw new Error('Codex 未返回 threadId');
    await request(runner, 'thread/name/set', {
      threadId,
      name: threadDisplayName(task.title),
    });
    await request(runner, 'thread/metadata/update', {
      threadId,
      isPinned: true,
    });
    const turnResult = await request(runner, 'turn/start', {
      threadId,
      input: [{ type: 'text', text: supervisorPrompt(projectId, taskId, workerId) }],
    }, 60_000);
    const turnId = turnResult?.turn?.id;
    updateGraphWorker(projectId, taskId, {
      status: 'running',
      threadId,
      turnId,
      message: 'Codex 主控正在通过 MCP 执行 Graph',
    }, `Codex Worker 已启动：${threadId}`);
    return getTaskGraph(projectId, taskId);
  } catch (error: any) {
    finishRunner(runner, 'failed', error?.message || 'Codex Worker 启动失败');
    child.kill();
    throw error;
  }
}

export function stopCodexGraphRunner(projectId: string, taskId: string): ReturnType<typeof stopTaskGraph> {
  const key = runnerKey(projectId, taskId);
  const runner = activeRunners.get(key);
  if (runner) {
    runner.stopped = true;
    runner.process.kill();
    activeRunners.delete(key);
  }
  return stopTaskGraph(projectId, taskId, '用户停止自动研发');
}

export function getCodexRunnerStatus(projectId: string, taskId: string) {
  const runner = activeRunners.get(runnerKey(projectId, taskId));
  return {
    active: Boolean(runner),
    pid: runner?.process.pid,
    workerId: runner?.workerId,
    stderrTail: runner?.stderrTail || [],
  };
}
