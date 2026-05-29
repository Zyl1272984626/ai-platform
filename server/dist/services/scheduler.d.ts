/**
 * 定时任务调度器
 *
 * 支持 Cron 表达式触发工作流
 * 如：每日 09:00 自动执行 daily-check 工作流
 */
import { EventEmitter } from 'events';
interface ScheduledJob {
    name: string;
    cron: string;
    workflowName: string;
    params: Record<string, unknown>;
    enabled: boolean;
    lastRun?: string;
    nextRun?: string;
}
/**
 * 初始化所有定时任务
 */
export declare function initScheduler(workflowStarter: (name: string, params: Record<string, unknown>, emitter: EventEmitter) => void): void;
/**
 * 列出所有定时任务
 */
export declare function listScheduledJobs(): ScheduledJob[];
/**
 * 启用/禁用定时任务
 */
export declare function toggleJob(name: string, enabled: boolean): void;
export {};
//# sourceMappingURL=scheduler.d.ts.map