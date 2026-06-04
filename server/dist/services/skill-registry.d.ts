export interface SkillMeta {
    name: string;
    description: string;
    type: 'scene' | 'capability' | 'test' | 'base';
    path: string;
    allowedTools?: string[];
    dependencies?: string[];
    tags?: string[];
    usage?: string;
    constraints?: string[];
    content?: string;
}
/**
 * 扫描所有 Skill 并返回元数据
 */
export declare function listSkills(): SkillMeta[];
/**
 * 获取单个 Skill 详情（含 SKILL.md 内容）
 */
export declare function getSkill(name: string): SkillMeta | undefined;
/**
 * 获取 Skill 的文件路径（供 Agent SDK 加载）
 */
export declare function getSkillPath(name: string): string | undefined;
//# sourceMappingURL=skill-registry.d.ts.map