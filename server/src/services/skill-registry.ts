/**
 * Skill 注册与发现
 */
import * as fs from 'fs';
import * as path from 'path';
import { AI_PLATFORM_ROOT } from './config.js';

export interface SkillMeta {
  name: string;
  description: string;
  type: 'scene' | 'capability' | 'test';
  path: string;
  allowedTools?: string[];
  dependencies?: string[];
  tags?: string[];
  content?: string; // SKILL.md 原文
}

const SKILLS_DIR = path.resolve(AI_PLATFORM_ROOT, 'skills');

/**
 * 扫描所有 Skill 并返回元数据
 */
export function listSkills(): SkillMeta[] {
  const skills: SkillMeta[] = [];

  for (const dirName of ['scenes', 'capabilities', 'tests']) {
    const typeDir = path.join(SKILLS_DIR, dirName);
    if (!fs.existsSync(typeDir)) continue;

    const typeMap: Record<string, 'scene' | 'capability' | 'test'> = {
      scenes: 'scene',
      capabilities: 'capability',
      tests: 'test',
    };
    const skillType = typeMap[dirName];

    for (const name of fs.readdirSync(typeDir)) {
      const skillFile = path.join(typeDir, name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      const content = fs.readFileSync(skillFile, 'utf-8');
      const meta = parseSkillFrontmatter(content, name, skillType, skillFile);
      skills.push(meta);
    }
  }

  return skills;
}

/**
 * 获取单个 Skill 详情（含 SKILL.md 内容）
 */
export function getSkill(name: string): SkillMeta | undefined {
  return listSkills().find((s) => s.name === name);
}

/**
 * 解析 SKILL.md 的 YAML frontmatter
 */
function parseSkillFrontmatter(
  content: string,
  name: string,
  type: 'scene' | 'capability' | 'test',
  filePath: string
): SkillMeta {
  const meta: SkillMeta = {
    name,
    description: '',
    type,
    path: filePath,
    content,
  };

  // 解析 --- 之间的 YAML
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const descMatch = fm.match(/description:\s*(.+)/);
    if (descMatch) meta.description = descMatch[1].trim();

    const toolsMatch = fm.match(/allowed-tools:\s*\[(.+)\]/);
    if (toolsMatch) {
      meta.allowedTools = toolsMatch[1].split(',').map((s) => s.trim().replace(/["']/g, ''));
    }

    const depsMatch = fm.match(/dependencies:\s*\[(.+)\]/);
    if (depsMatch) {
      meta.dependencies = depsMatch[1].split(',').map((s) => s.trim().replace(/["']/g, ''));
    }

    const tagsMatch = fm.match(/tags:\s*\[(.+)\]/);
    if (tagsMatch) {
      meta.tags = tagsMatch[1].split(',').map((s) => s.trim().replace(/["']/g, ''));
    }
  }

  return meta;
}

/**
 * 获取 Skill 的文件路径（供 Agent SDK 加载）
 */
export function getSkillPath(name: string): string | undefined {
  const skill = getSkill(name);
  return skill ? path.dirname(skill.path) : undefined;
}
