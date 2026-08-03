#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BASE = process.env.AI_PLATFORM_BASE || 'http://127.0.0.1:3100';

async function callApi(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${BASE}/api/tasks${path}`, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AI Platform ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

function post(path: string, body: unknown): Promise<any> {
  return callApi(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const server = new Server(
  { name: 'ai-platform-graph', version: '1.0.0' },
  {
    capabilities: { tools: {} },
    instructions: '这是 AI Platform 动态研发 Graph 的执行协议。先 get_graph，再循环 claim_node -> get_node_context -> 执行 -> append_node_evidence -> complete_node。节点失败必须 fail_node；需要业务拍板必须 request_human_decision。可以用 expand_graph 动态增加必要子节点。技术门禁只能绑定真实证据后调用 evaluate_gate。不得调用任务 accept 接口代替人工验收，不得越过 scope/outOfScope。',
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_graph',
      description: '读取研发任务的动态 Graph、节点状态、依赖、Worker 和任务契约摘要。',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' }, taskId: { type: 'string' } },
        required: ['projectId', 'taskId'],
      },
    },
    {
      name: 'claim_node',
      description: '原子领取一个当前可运行节点。没有可运行节点时返回 node=null。',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' }, taskId: { type: 'string' }, workerId: { type: 'string' }, nodeId: { type: 'string' },
        },
        required: ['projectId', 'taskId', 'workerId'],
      },
    },
    {
      name: 'get_node_context',
      description: '读取节点指令、依赖结果、任务边界、项目工作目录和待通过门禁。',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' }, taskId: { type: 'string' }, nodeId: { type: 'string' } },
        required: ['projectId', 'taskId', 'nodeId'],
      },
    },
    {
      name: 'append_node_evidence',
      description: '追加当前节点的真实执行证据，并同步写入任务证据账本。',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' }, taskId: { type: 'string' }, nodeId: { type: 'string' },
          type: { type: 'string', enum: ['file', 'command', 'test', 'http', 'browser', 'database', 'decision', 'note'] },
          label: { type: 'string' }, summary: { type: 'string' }, source: { type: 'string' }, result: { type: 'string' },
        },
        required: ['projectId', 'taskId', 'nodeId', 'type', 'label', 'summary'],
      },
    },
    {
      name: 'complete_node',
      description: '完成一个已领取节点。节点至少要有一条证据，完成后自动解锁下游节点。',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' }, taskId: { type: 'string' }, nodeId: { type: 'string' }, workerId: { type: 'string' }, summary: { type: 'string' } },
        required: ['projectId', 'taskId', 'nodeId', 'workerId', 'summary'],
      },
    },
    {
      name: 'fail_node',
      description: '记录节点失败事实。可重试失败会在重试预算内回到 runnable，否则 Graph 失败。',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' }, taskId: { type: 'string' }, nodeId: { type: 'string' }, workerId: { type: 'string' }, error: { type: 'string' }, retryable: { type: 'boolean' } },
        required: ['projectId', 'taskId', 'nodeId', 'workerId', 'error'],
      },
    },
    {
      name: 'expand_graph',
      description: '执行中发现必要工作时，为父节点增加最多 8 个有依赖约束的子节点。',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' }, taskId: { type: 'string' }, parentNodeId: { type: 'string' },
          nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string', enum: ['discovery', 'design', 'implementation', 'verification', 'review', 'handoff'] }, agentRole: { type: 'string' }, instructions: { type: 'string' }, dependsOn: { type: 'array', items: { type: 'string' } }, maxRetries: { type: 'number' } }, required: ['name', 'kind', 'agentRole', 'instructions'] } },
        },
        required: ['projectId', 'taskId', 'parentNodeId', 'nodes'],
      },
    },
    {
      name: 'evaluate_gate',
      description: '用任务证据评估技术门禁。pass 必须关联当前任务的真实 evidenceIds。',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' }, taskId: { type: 'string' }, gateId: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'blocked', 'not_applicable'] }, evidenceIds: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } },
        required: ['projectId', 'taskId', 'gateId', 'result', 'evidenceIds'],
      },
    },
    {
      name: 'request_human_decision',
      description: '遇到业务歧义、高风险操作或权限边界时暂停节点，并创建人工待确认事项。',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' }, taskId: { type: 'string' }, nodeId: { type: 'string' }, question: { type: 'string' } },
        required: ['projectId', 'taskId', 'nodeId', 'question'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const args = request.params.arguments || {};
  try {
    let result: any;
    switch (request.params.name) {
      case 'get_graph':
        result = await callApi(`/${args.taskId}/graph?projectId=${encodeURIComponent(args.projectId)}`);
        break;
      case 'claim_node':
        result = await post(`/${args.taskId}/graph/claim`, args);
        break;
      case 'get_node_context':
        result = await callApi(`/${args.taskId}/graph/nodes/${args.nodeId}/context?projectId=${encodeURIComponent(args.projectId)}`);
        break;
      case 'append_node_evidence':
        result = await post(`/${args.taskId}/graph/nodes/${args.nodeId}/evidence`, args);
        break;
      case 'complete_node':
        result = await post(`/${args.taskId}/graph/nodes/${args.nodeId}/complete`, args);
        break;
      case 'fail_node':
        result = await post(`/${args.taskId}/graph/nodes/${args.nodeId}/fail`, args);
        break;
      case 'expand_graph':
        result = await post(`/${args.taskId}/graph/expand`, args);
        break;
      case 'evaluate_gate':
        result = await post(`/${args.taskId}/gates/${args.gateId}/evaluate`, args);
        break;
      case 'request_human_decision':
        result = await post(`/${args.taskId}/graph/nodes/${args.nodeId}/decision`, args);
        break;
      default:
        throw new Error(`未知工具：${request.params.name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    return { isError: true, content: [{ type: 'text', text: error?.message || '工具调用失败' }] };
  }
});

await server.connect(new StdioServerTransport());
console.error(`[ai-platform-graph MCP] started, base=${BASE}`);
