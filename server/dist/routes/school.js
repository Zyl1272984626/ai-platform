/**
 * 学校管理路由
 */
import { Router } from 'express';
import * as path from 'path';
import { listSchools, getSchool, addSchool, updateSchool, removeSchool, } from '../services/school-manager.js';
import { buildSchoolWar, buildSchoolDeployPackage } from '../services/deploy-service.js';
export const schoolRouter = Router();
// 列表
schoolRouter.get('/', (_req, res) => {
    res.json(listSchools());
});
// 部署：生成学校专属 WAR 包并下载
schoolRouter.post('/:code/deploy', async (req, res) => {
    try {
        // 更新状态为 deployed
        updateSchool(req.params.code, { status: 'deployed', lastDeploy: new Date().toISOString().slice(0, 10) });
        // mvn package + 在 WAR 副本中替换配置（不动原始文件）
        const warPath = await buildSchoolWar(req.params.code);
        const fileName = path.basename(warPath);
        res.download(warPath, fileName);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 部署（完整包）：生成 WAR + deploy.sh 打包成 ZIP 下载
schoolRouter.post('/:code/deploy-full', async (req, res) => {
    try {
        const params = req.body;
        updateSchool(req.params.code, { status: 'deployed', lastDeploy: new Date().toISOString().slice(0, 10) });
        const zipPath = await buildSchoolDeployPackage(req.params.code, params);
        const fileName = path.basename(zipPath);
        res.download(zipPath, fileName);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 详情
schoolRouter.get('/:code', (req, res) => {
    const school = getSchool(req.params.code);
    if (!school)
        return res.status(404).json({ error: 'School not found' });
    res.json(school);
});
// 注册新学校
schoolRouter.post('/', (req, res) => {
    try {
        const school = addSchool(req.body);
        res.status(201).json(school);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// 更新
schoolRouter.put('/:code', (req, res) => {
    try {
        const school = updateSchool(req.params.code, req.body);
        res.json(school);
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
// 删除
schoolRouter.delete('/:code', (req, res) => {
    const removed = removeSchool(req.params.code);
    if (!removed)
        return res.status(404).json({ error: 'School not found' });
    res.json({ ok: true });
});
//# sourceMappingURL=school.js.map