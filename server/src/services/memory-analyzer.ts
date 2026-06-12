/**
 * 记忆分析器 - 使用 DeepSeek 生成摘要、提取洞察、生成制品
 */
import { v4 as uuidv4 } from 'uuid';
import { chatWithDeepSeek, isDeepSeekAvailable } from './deepseek-client.js';
import {
  type ConversationDetail,
  type ConversationMessage,
  type MemoryInsight,
  type GeneratedArtifact,
  loadConversationDetail,
  updateConversationSummary,
  addInsights,
  addArtifact,
} from './memory-store.js';

// ========== 工具方法 ==========

/** 截取对话内容以适应上下文窗口 */
function truncateMessages(messages: ConversationMessage[], maxTokens = 4000): string {
  // 粗略估算：1 个中文字符 ≈ 1 token
  let total = 0;
  const selected: string[] = [];

  // 优先取用户消息和关键助手回复
  for (let i = 0; i < messages.length && total < maxTokens; i++) {
    const msg = messages[i];
    if (msg.role === 'system') continue;
    if (msg.contentType === 'tool_result') continue;

    let text = '';
    if (msg.role === 'user') {
      text = `[用户]: ${msg.content}`;
    } else if (msg.contentType === 'tool_use') {
      text = `[工具调用]: ${msg.toolName || ''} - ${msg.content.slice(0, 100)}`;
    } else {
      text = `[助手]: ${msg.content}`;
    }

    if (total + text.length > maxTokens) {
      text = text.slice(0, maxTokens - total) + '...';
    }
    selected.push(text);
    total += text.length;
  }

  return selected.join('\n\n');
}

// ========== 生成摘要 ==========

export async function generateConversationSummary(id: string): Promise<string> {
  const detail = loadConversationDetail(id);
  if (!detail) throw new Error('对话不存在');
  if (!isDeepSeekAvailable()) throw new Error('DeepSeek 未配置，无法生成摘要');

  const conversationText = truncateMessages(detail.messages);

  const messages = [
    {
      role: 'system' as const,
      content: '你是一个对话分析助手。请用中文为以下 AI 编码助手的对话生成简洁的摘要（2-3句话），概括：1) 用户的主要目标 2) 完成了什么 3) 关键决策或发现。只输出摘要文本，不要输出其他内容。',
    },
    {
      role: 'user' as const,
      content: `对话标题：${detail.title}\n来源：${detail.source}\n模型：${detail.model}\n\n对话内容：\n${conversationText}`,
    },
  ];

  const response = await chatWithDeepSeek(messages, { temperature: 0.3, maxTokens: 500 });
  const summary = response.content.trim();

  // 更新索引中的摘要
  updateConversationSummary(id, { summary });

  // 同时更新详情文件
  const updatedDetail = loadConversationDetail(id);
  if (updatedDetail) {
    updatedDetail.summary = summary;
    const { saveConversationDetail } = await import('./memory-store.js');
    saveConversationDetail(updatedDetail);
  }

  return summary;
}

// ========== 提取洞察 ==========

const INSIGHT_TYPES = ['preference', 'pattern', 'correction', 'knowledge', 'skill-idea'] as const;

export async function extractInsights(id: string): Promise<MemoryInsight[]> {
  const detail = loadConversationDetail(id);
  if (!detail) throw new Error('对话不存在');
  if (!isDeepSeekAvailable()) throw new Error('DeepSeek 未配置，无法提取洞察');

  const conversationText = truncateMessages(detail.messages, 6000);

  const messages = [
    {
      role: 'system' as const,
      content: `你是一个对话分析专家。请分析以下 AI 编码助手的对话，提取用户的关键洞察。

请严格按以下 JSON 数组格式输出，每个洞察包含：
- type: 类型（preference=用户偏好, pattern=工作模式, correction=纠正/反馈, knowledge=知识/经验, skill-idea=可形成 Skill 的想法）
- content: 洞察内容（中文，简洁明了）
- confidence: 置信度（0-1之间的小数）

只输出 JSON 数组，不要输出其他内容。如果对话中没有值得提取的洞察，输出空数组 []。

示例：
[{"type":"preference","content":"用户偏好使用中文进行交流","confidence":0.9}]`,
    },
    {
      role: 'user' as const,
      content: `对话标题：${detail.title}\n来源：${detail.source}\n\n对话内容：\n${conversationText}`,
    },
  ];

  const response = await chatWithDeepSeek(messages, { temperature: 0.2, maxTokens: 2000 });

  // 解析 LLM 输出的 JSON
  let insights: any[] = [];
  try {
    // 尝试从响应中提取 JSON 数组
    const text = response.content;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      insights = JSON.parse(jsonMatch[0]);
    }
  } catch {
    console.warn('[Memory] 洞察解析失败，跳过');
  }

  const typedInsights: MemoryInsight[] = insights
    .filter(i => i.type && i.content && INSIGHT_TYPES.includes(i.type))
    .map(i => ({
      id: uuidv4(),
      sourceConversationId: id,
      type: i.type,
      content: i.content,
      confidence: Math.min(1, Math.max(0, i.confidence || 0.5)),
      generatedAt: new Date().toISOString(),
      model: response.model,
    }));

  addInsights(typedInsights);
  return typedInsights;
}

// ========== 生成制品 ==========

export async function generateArtifactFromConversation(
  id: string,
  type: 'skill' | 'prompt' | 'memory-note',
): Promise<GeneratedArtifact> {
  const detail = loadConversationDetail(id);
  if (!detail) throw new Error('对话不存在');
  if (!isDeepSeekAvailable()) throw new Error('DeepSeek 未配置');

  const conversationText = truncateMessages(detail.messages, 6000);

  let systemPrompt = '';
  let userPrompt = '';

  if (type === 'skill') {
    systemPrompt = `你是一个 Skill 生成专家。请根据对话内容生成一个 SKILL.md 格式的 Skill。

格式要求：
---
name: {{skill名称}}
description: {{一句话描述}}
type: scene | capability | base
tags:
  - {{标签1}}
  - {{标签2}}
allowedTools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
---

# Skill 标题

## 使用场景
描述何时使用此 Skill

## 执行步骤
1. 具体步骤...

## 注意事项
- 注意事项...

请直接输出 SKILL.md 的完整内容，不要输出其他说明。`;
    userPrompt = `请根据以下对话内容生成一个可复用的 Skill：\n\n${conversationText}`;
  } else if (type === 'prompt') {
    systemPrompt = `你是一个提示词工程专家。请根据对话内容提取一个高质量的、可复用的提示词模板。

提示词模板应该：
1. 有明确的目标
2. 包含上下文占位符（如 {{变量名}}）
3. 结构清晰，步骤明确
4. 适合类似场景复用

请直接输出提示词内容，不要额外解释。`;
    userPrompt = `请从以下对话中提取可复用的提示词模板：\n\n${conversationText}`;
  } else {
    // memory-note
    systemPrompt = `你是一个知识管理专家。请根据对话内容生成一条简洁的记忆笔记。

记忆笔记格式：
---
name: {{记忆名称}}
description: {{一句话描述}}
type: feedback | project | reference
---

## 核心内容
- 关键知识点

**Why:** 原因
**How to apply:** 如何应用

请直接输出记忆笔记内容。`;
    userPrompt = `请从以下对话中提取值得记住的知识或经验：\n\n${conversationText}`;
  }

  const response = await chatWithDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.3, maxTokens: 2000 });

  // 从内容中提取标题
  let title = `${type === 'skill' ? 'Skill' : type === 'prompt' ? '提示词' : '记忆'} - ${detail.title.slice(0, 30)}`;
  const nameMatch = response.content.match(/name:\s*(.+)/);
  if (nameMatch) title = nameMatch[1].trim();

  const artifact: GeneratedArtifact = {
    id: uuidv4(),
    sourceConversationId: id,
    type,
    title,
    content: response.content,
    generatedAt: new Date().toISOString(),
    applied: false,
  };

  addArtifact(artifact);
  return artifact;
}

// ========== 应用制品 ==========

export async function applyArtifact(artifactId: string): Promise<{ path: string }> {
  const { loadArtifacts, updateArtifact } = await import('./memory-store.js');
  const artifacts = loadArtifacts();
  const artifact = artifacts.find(a => a.id === artifactId);
  if (!artifact) throw new Error('制品不存在');
  if (artifact.applied) throw new Error('制品已应用');

  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  let filePath = '';

  if (artifact.type === 'skill') {
    // 写入 skills/ 目录，归类为 generated
    const skillsDir = path.resolve(process.cwd(), 'skills/generated');
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });

    // 从内容提取 name，或用标题做文件名
    const safeName = artifact.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 50);
    filePath = path.join(skillsDir, `${safeName}/SKILL.md`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, artifact.content, 'utf-8');
  } else if (artifact.type === 'memory-note') {
    // 写入 Claude Code 项目的 memory 目录
    const claudeDir = path.join(os.homedir(), '.claude');
    // 使用默认项目（ai-platform）
    const memoryDir = path.join(claudeDir, 'projects/C--FengSuKeJi-ai-platform/memory');
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });

    const safeName = artifact.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 50);
    filePath = path.join(memoryDir, `${safeName}.md`);
    fs.writeFileSync(filePath, artifact.content, 'utf-8');
  } else {
    // prompt 类型 - 写入 server/data/memory/artifacts/ 作为参考
    const artifactsDir = path.resolve(process.cwd(), 'server/data/memory/artifacts');
    const safeName = artifact.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 50);
    filePath = path.join(artifactsDir, `${safeName}.md`);
    fs.writeFileSync(filePath, artifact.content, 'utf-8');
  }

  updateArtifact(artifactId, { applied: true });
  return { path: filePath };
}
