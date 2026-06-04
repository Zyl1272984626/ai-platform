"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.listSkills = listSkills;
exports.getSkill = getSkill;
exports.getSkillPath = getSkillPath;
/**
 * Skill 注册与发现
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const config_js_1 = require("./config.js");
const SKILLS_DIR = path.resolve(config_js_1.AI_PLATFORM_ROOT, 'skills');
/**
 * 扫描所有 Skill 并返回元数据
 */
function listSkills() {
    const skills = [];
    for (const dirName of ['scenes', 'capabilities', 'tests', 'base']) {
        const typeDir = path.join(SKILLS_DIR, dirName);
        if (!fs.existsSync(typeDir))
            continue;
        const typeMap = {
            scenes: 'scene',
            capabilities: 'capability',
            tests: 'test',
            base: 'base',
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
function getSkill(name) {
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
function getSkillPath(name) {
    const skill = getSkill(name);
    return skill ? path.dirname(skill.path) : undefined;
}
//# sourceMappingURL=skill-registry.js.map