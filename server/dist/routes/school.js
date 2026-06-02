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
exports.schoolRouter = void 0;
/**
 * 学校管理路由
 */
const express_1 = require("express");
const path = __importStar(require("path"));
const school_manager_js_1 = require("../services/school-manager.js");
const deploy_service_js_1 = require("../services/deploy-service.js");
exports.schoolRouter = (0, express_1.Router)();
// 列表
exports.schoolRouter.get('/', (_req, res) => {
    res.json((0, school_manager_js_1.listSchools)());
});
// 部署：生成学校专属 WAR 包并下载
exports.schoolRouter.post('/:code/deploy', async (req, res) => {
    try {
        // 更新状态为 deployed
        (0, school_manager_js_1.updateSchool)(req.params.code, { status: 'deployed', lastDeploy: new Date().toISOString().slice(0, 10) });
        // mvn package + 在 WAR 副本中替换配置（不动原始文件）
        const warPath = await (0, deploy_service_js_1.buildSchoolWar)(req.params.code);
        const fileName = path.basename(warPath);
        res.download(warPath, fileName);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 部署（完整包）：生成 WAR + deploy.sh 打包成 ZIP 下载
exports.schoolRouter.post('/:code/deploy-full', async (req, res) => {
    try {
        const params = req.body;
        (0, school_manager_js_1.updateSchool)(req.params.code, { status: 'deployed', lastDeploy: new Date().toISOString().slice(0, 10) });
        const zipPath = await (0, deploy_service_js_1.buildSchoolDeployPackage)(req.params.code, params);
        const fileName = path.basename(zipPath);
        res.download(zipPath, fileName);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
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