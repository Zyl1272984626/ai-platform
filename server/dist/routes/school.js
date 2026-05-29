"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.schoolRouter = void 0;
/**
 * 学校管理路由
 */
const express_1 = require("express");
const school_manager_js_1 = require("../services/school-manager.js");
exports.schoolRouter = (0, express_1.Router)();
// 列表
exports.schoolRouter.get('/', (_req, res) => {
    res.json((0, school_manager_js_1.listSchools)());
});
// 详情
exports.schoolRouter.get('/:code', (req, res) => {
    const school = (0, school_manager_js_1.getSchool)(req.params.code);
    if (!school)
        return res.status(404).json({ error: 'School not found' });
    res.json(school);
});
// 注册新学校
exports.schoolRouter.post('/', (req, res) => {
    try {
        const school = (0, school_manager_js_1.addSchool)(req.body);
        res.status(201).json(school);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// 更新
exports.schoolRouter.put('/:code', (req, res) => {
    try {
        const school = (0, school_manager_js_1.updateSchool)(req.params.code, req.body);
        res.json(school);
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
// 删除
exports.schoolRouter.delete('/:code', (req, res) => {
    const removed = (0, school_manager_js_1.removeSchool)(req.params.code);
    if (!removed)
        return res.status(404).json({ error: 'School not found' });
    res.json({ ok: true });
});
//# sourceMappingURL=school.js.map