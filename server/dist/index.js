"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * AI 工程平台 - Server 入口
 */
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const session_js_1 = require("./routes/session.js");
const school_js_1 = require("./routes/school.js");
const workflow_js_1 = require("./routes/workflow.js");
const skill_js_1 = require("./routes/skill.js");
const test_js_1 = require("./routes/test.js");
const workflow_engine_js_1 = require("./services/workflow-engine.js");
const scheduler_js_1 = require("./services/scheduler.js");
const config_js_1 = require("./services/config.js");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3100;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// 静态文件（Web UI 构建产物）
app.use(express_1.default.static('../web/dist'));
// API 路由
app.use('/api/sessions', session_js_1.sessionRouter);
app.use('/api/schools', school_js_1.schoolRouter);
app.use('/api/workflows', workflow_js_1.workflowRouter);
app.use('/api/skills', skill_js_1.skillRouter);
app.use('/api/tests', test_js_1.testRouter);
// 健康检查
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', projectRoot: config_js_1.PROJECT_ROOT, version: '0.1.0' });
});
app.listen(PORT, () => {
    console.log(`[AI Platform] Server running on http://localhost:${PORT}`);
    console.log(`[AI Platform] Project root: ${config_js_1.PROJECT_ROOT}`);
    // 初始化定时任务调度器
    (0, scheduler_js_1.initScheduler)((workflowName, params, emitter) => {
        (0, workflow_engine_js_1.startWorkflow)(workflowName, params, emitter);
    });
});
//# sourceMappingURL=index.js.map