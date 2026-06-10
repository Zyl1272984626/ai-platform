/**
 * DeepSeek API 客户端
 *
 * 使用 OpenAI 兼容格式调用 DeepSeek API
 * 用于代码审查等多模型交叉验证场景
 */
import { getConfig } from './config.js';

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const DEFAULT_CONFIG: DeepSeekConfig = {
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
};

let runtimeConfig: DeepSeekConfig = { ...DEFAULT_CONFIG };

/** 从 platform-config.json 加载配置 */
export function initFromPlatformConfig(): void {
  const config = getConfig();
  if (config.deepseekConfig) {
    runtimeConfig = {
      apiKey: config.deepseekConfig.apiKey || runtimeConfig.apiKey,
      baseUrl: config.deepseekConfig.baseUrl || runtimeConfig.baseUrl,
      model: config.deepseekConfig.model || runtimeConfig.model,
    };
  }
}

export function getDeepSeekConfig(): DeepSeekConfig {
  return { ...runtimeConfig };
}

export function updateDeepSeekConfig(updates: Partial<DeepSeekConfig>): DeepSeekConfig {
  runtimeConfig = { ...runtimeConfig, ...updates };
  return { ...runtimeConfig };
}

export function isDeepSeekAvailable(): boolean {
  return !!runtimeConfig.apiKey;
}

/**
 * 发送聊天请求到 DeepSeek API
 */
export async function chatWithDeepSeek(
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
  },
): Promise<ChatResponse> {
  if (!runtimeConfig.apiKey) {
    throw new Error('DeepSeek API Key 未配置');
  }

  const url = `${runtimeConfig.baseUrl}/chat/completions`;
  const body = {
    model: runtimeConfig.model,
    messages,
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens ?? 4096,
    stream: false,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${runtimeConfig.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as any;
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content || '',
    model: data.model || runtimeConfig.model,
    usage: data.usage,
  };
}

/**
 * 流式聊天（返回 async generator）
 */
export async function* chatWithDeepSeekStream(
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
  },
): AsyncGenerator<string> {
  if (!runtimeConfig.apiKey) {
    throw new Error('DeepSeek API Key 未配置');
  }

  const url = `${runtimeConfig.baseUrl}/chat/completions`;
  const body = {
    model: runtimeConfig.model,
    messages,
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens ?? 4096,
    stream: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${runtimeConfig.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is null');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* skip malformed chunks */ }
    }
  }
}
