#!/usr/bin/env node
/**
 * 接力流水线 MCP Server（stdio 模式）
 *
 * 让 ZCode/ClaudeCode 通过 MCP 自动获取接力任务，不用手动复制提示词。
 * 通过 HTTP 调用现有 Express server（localhost:3100），复用所有已有路由，
 * MCP server 只是薄包装。
 *
 * ZCode 配置（~/.zcode/cli/config.json 的 mcp.servers）：
 *   "ai-platform-relay": {
 *     "type": "stdio",
 *     "command": "node",
 *     "args": ["C:/FengSuKeJi/ai-platform/server/dist/mcp/relay-server.js"],
 *     "env": { "AI_PLATFORM_BASE": "http://localhost:3100" }
 *   }
 *
 * 暴露的工具：
 *   - list_relay_tasks: 列出所有接力 run（简表）
 *   - get_relay_task: 拿某个 run 的完整上下文（当前阶段、产物路径、前序依赖、冷库）
 *   - scan_artifacts: 扫描某 run 的产物进度
 *   - mark_stage: 标记阶段状态（working/rework/accepted）
 *   - generate_stage_prompt: 生成某阶段的提示词
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BASE = process.env.AI_PLATFORM_BASE || 'http://localhost:3100';

/** 调用现有 Express server 的辅助函数 */
async function callApi(path: string, init?: RequestInit): Promise<unknown> {
  const url = path.startsWith('http') ? path : `${BASE}/api/pipelines${path}`;
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} 返回 ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

const server = new Server(
  { name: 'ai-platform-relay', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// 注册工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_relay_task',
      description: '创建一个新的接力开发任务（run）。当用户说"启动接力任务做xx"或"用接力流程做xx"时调用。会生成 runId、分配阶段、创建产物目录。返回 runId 和第一阶段的提示词。',
      inputSchema: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '原始需求描述（自然语言）' },
          baseEngine: { type: 'string', enum: ['codex', 'claudecode', 'zcode'], description: '底座引擎，默认 zcode（ZCode 复用 ClaudeCode 9 阶段路线）' },
          projectId: { type: 'string', description: '目标项目 ID（可选，不填默认本平台）' },
        },
        required: ['requirement'],
      },
    },
    {
      name: 'list_relay_tasks',
      description: '列出所有接力任务（run）及其进度。用于查看当前有哪些进行中的开发接力任务。',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_relay_task',
      description: '获取某个接力任务的完整上下文：当前阶段、推荐执行者、产物路径、必读前序产物、冷库记忆。AI 开始干活前先调这个。',
      inputSchema: {
        type: 'object',
        properties: { runId: { type: 'string', description: '接力运行 ID' } },
        required: ['runId'],
      },
    },
    {
      name: 'scan_artifacts',
      description: '扫描某个接力任务的产物进度（哪些阶段已生成、质量门状态）。',
      inputSchema: {
        type: 'object',
        properties: { runId: { type: 'string', description: '接力运行 ID' } },
        required: ['runId'],
      },
    },
    {
      name: 'mark_stage',
      description: '标记某阶段的状态：working（执行中）/ rework（打回）/ accepted（通过质量门）。',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: '接力运行 ID' },
          stageId: { type: 'string', description: '阶段 ID' },
          mark: { type: 'string', enum: ['working', 'rework', 'accepted'], description: '标记状态' },
        },
        required: ['runId', 'stageId', 'mark'],
      },
    },
    {
      name: 'generate_stage_prompt',
      description: '生成某个阶段的提示词（复制给执行平台用）。',
      inputSchema: {
        type: 'object',
        properties: {
          stageId: { type: 'string', description: '阶段 ID' },
          requirement: { type: 'string', description: '原始需求' },
          runId: { type: 'string', description: '接力运行 ID' },
          baseEngine: { type: 'string', enum: ['codex', 'claudecode', 'zcode'], description: '底座引擎' },
        },
        required: ['stageId', 'requirement'],
      },
    },
    {
      name: 'generate_delivery_report',
      description: '为某个接力任务生成交付报告：汇总阶段完成情况、涉及文件、风险与待办、验收建议。同时写入产物目录 DELIVERY-REPORT.md。最后阶段完成时调用。',
      inputSchema: {
        type: 'object',
        properties: { runId: { type: 'string', description: '接力运行 ID' } },
        required: ['runId'],
      },
    },
  ],
}));

// 注册工具调用
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case 'create_relay_task': {
        if (!args?.requirement) throw new Error('requirement 必填');
        // zcode/claudecode 走 claudecode 的提示词路由（zcode 复用 claudecode 9 阶段）
        const engine = args.baseEngine === 'codex' ? 'codex' : (args.baseEngine || 'zcode');
        const useClaudeCodePrompt = engine !== 'codex';
        // 调用现有 relay-run-id 路由建任务
        const createResult: any = await callApi('/relay-run-id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requirement: args.requirement,
            projectId: args.projectId,
            baseEngine: engine,
          }),
        });
        const runId = createResult.runId;
        // 生成总控提示词，让 AI 拿到就能开始
        const promptResult: any = await callApi(
          useClaudeCodePrompt ? '/generate-claudecode-prompt' : '/generate-codex-prompt',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requirement: args.requirement,
              projectId: args.projectId,
              runId,
            }),
          },
        );
        result = {
          runId,
          requirement: args.requirement,
          baseEngine: engine,
          message: `任务已创建（底座：${engine}）。第一阶段是"需求澄清与总控"。下面是总控提示词，请按它开始追问需求：`,
          masterPrompt: promptResult.prompt,
        };
        break;
      }
      case 'list_relay_tasks': {
        result = await callApi('/artifact-runs');
        break;
      }
      case 'get_relay_task': {
        if (!args?.runId) throw new Error('runId 必填');
        result = await callApi(`/relay-context/${args.runId}/snapshot`);
        break;
      }
      case 'scan_artifacts': {
        if (!args?.runId) throw new Error('runId 必填');
        result = await callApi(`/artifacts/${args.runId}`);
        break;
      }
      case 'mark_stage': {
        if (!args?.runId || !args?.stageId || !args?.mark) {
          throw new Error('runId、stageId、mark 必填');
        }
        result = await callApi(`/artifacts/${args.runId}/stage-mark`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stageId: args.stageId, mark: args.mark }),
        });
        break;
      }
      case 'generate_stage_prompt': {
        if (!args?.stageId || !args?.requirement) {
          throw new Error('stageId、requirement 必填');
        }
        result = await callApi('/generate-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stageId: args.stageId,
            requirement: args.requirement,
            runId: args.runId,
            mode: 'relay',
            baseEngine: args.baseEngine,
          }),
        });
        break;
      }
      case 'generate_delivery_report': {
        if (!args?.runId) throw new Error('runId 必填');
        result = await callApi(`/delivery-report/${args.runId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        break;
      }
      default:
        throw new Error(`未知工具: ${name}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `工具调用失败: ${(err as Error).message}` }],
    };
  }
});

// 启动 stdio 传输
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[ai-platform-relay MCP] stdio server started, base=' + BASE);
