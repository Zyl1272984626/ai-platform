"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skillRouter = void 0;
/**
 * Skill 管理路由
 */
const express_1 = require("express");
const skill_registry_js_1 = require("../services/skill-registry.js");
exports.skillRouter = (0, express_1.Router)();
// Skill 列表
exports.skillRouter.get('/', (_req, res) => {
    const skills = (0, skill_registry_js_1.listSkills)().map((s) => ({
        name: s.name,
        description: s.description,
        type: s.type,
        tags: s.tags,
        dependencies: s.dependencies,
    }));
    res.json(skills);
});
// Skill 详情
exports.skillRouter.get('/:name', (req, res) => {
    const skill = (0, skill_registry_js_1.getSkill)(req.params.name);
    if (!skill)
        return res.status(404).json({ error: 'Skill not found' });
    res.json(skill);
});
//# sourceMappingURL=skill.js.map