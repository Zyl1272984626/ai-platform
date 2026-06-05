/**
 * Skill 注册与发现
 */
import * as fs from 'fs';
import * as path from 'path';
import { AI_PLATFORM_ROOT } from './config.js';
const SKILLS_DIR = path.resolve(AI_PLATFORM_ROOT, 'skills');
/**
 * 扫描所有 Skill 并返回元数据
 */
export function listSkills() {
    const skills = [];
<<<<<<< Updated upstream
    for (const dirName of ['scenes', 'capabilities', 'tests', 'base']) {
=======
    for (const dirName of ['scenes', 'capabilities', 'tests']) {
>>>>>>> Stashed changes
        const typeDir = path.join(SKILLS_DIR, dirName);
        if (!fs.existsSync(typeDir))
            continue;
        const typeMap = {
            scenes: 'scene',
            capabilities: 'capability',
            tests: 'test',
<<<<<<< Updated upstream
            base: 'base',
=======
>>>>>>> Stashed changes
        };
        const skillType = typeMap[dirName];
        for (const name of fs.readdirSync(typeDir)) {
            const skillFile = path.join(typeDir, name, 'SKILL.md');
            if (!fs.existsSync(skillFile))
                continue;
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
export function getSkill(name) {
    return listSkills().find((s) => s.name === name);
}
/**
 * 解析 SKILL.md 的 YAML frontmatter
 */
function parseSkillFrontmatter(content, name, type, filePath) {
    const meta = {
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
        if (descMatch)
            meta.description = descMatch[1].trim();
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
        const usageMatch = fm.match(/usage:\s*(.+)/);
        if (usageMatch)
            meta.usage = usageMatch[1].trim();
        // constraints 是 YAML 列表格式（每行 - xxx）
        const constraintsMatch = fm.match(/constraints:\s*\n((?:\s+- .+\n?)+)/);
        if (constraintsMatch) {
            meta.constraints = constraintsMatch[1]
                .split('\n')
                .map((s) => s.replace(/^\s+-\s*/, '').trim())
                .filter(Boolean);
        }
    }
    return meta;
}
/**
 * 获取 Skill 的文件路径（供 Agent SDK 加载）
 */
export function getSkillPath(name) {
    const skill = getSkill(name);
    return skill ? path.dirname(skill.path) : undefined;
}
//# sourceMappingURL=skill-registry.js.map