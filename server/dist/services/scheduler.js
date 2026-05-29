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
exports.initScheduler = initScheduler;
exports.listScheduledJobs = listScheduledJobs;
exports.toggleJob = toggleJob;
/**
 * 定时任务调度器
 *
 * 支持 Cron 表达式触发工作流
 * 如：每日 09:00 自动执行 daily-check 工作流
 */
const events_1 = require("events");
const cron = __importStar(require("node-cron"));
// 预置定时任务
const DEFAULT_JOBS = [
    {
        name: '日常巡检',
        cron: '3 9 * * 1-5', // 工作日 09:03
        workflowName: '日常巡检',
        params: {},
        enabled: true,
    },
];
const activeCronJobs = new Map();
/**
 * 初始化所有定时任务
 */
function initScheduler(workflowStarter) {
    for (const job of DEFAULT_JOBS) {
        if (!job.enabled)
            continue;
        // 计算下次运行时间
        const task = cron.schedule(job.cron, () => {
            console.log(`[Scheduler] Triggering: ${job.name}`);
            job.lastRun = new Date().toISOString();
            const emitter = new events_1.EventEmitter();
            emitter.on('workflow:done', () => {
                console.log(`[Scheduler] ${job.name} completed`);
            });
            emitter.on('workflow:failed', (data) => {
                console.error(`[Scheduler] ${job.name} failed:`, data);
            });
            try {
                workflowStarter(job.workflowName, job.params, emitter);
            }
            catch (err) {
                console.error(`[Scheduler] Failed to start ${job.name}:`, err);
            }
        });
        activeCronJobs.set(job.name, task);
        console.log(`[Scheduler] Registered: ${job.name} (${job.cron})`);
    }
}
/**
 * 列出所有定时任务
 */
function listScheduledJobs() {
    return DEFAULT_JOBS;
}
/**
 * 启用/禁用定时任务
 */
function toggleJob(name, enabled) {
    const job = DEFAULT_JOBS.find((j) => j.name === name);
    if (!job)
        throw new Error(`Job not found: ${name}`);
    job.enabled = enabled;
    if (enabled && !activeCronJobs.has(name)) {
        // 启动
    }
    else if (!enabled && activeCronJobs.has(name)) {
        activeCronJobs.get(name)?.stop();
        activeCronJobs.delete(name);
    }
}
//# sourceMappingURL=scheduler.js.map