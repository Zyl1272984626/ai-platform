/**
 * 定时任务调度器
 *
 * 支持 Cron 表达式触发工作流
 * 如：每日 09:00 自动执行 daily-check 工作流
 */
import { EventEmitter } from 'events';
import * as cron from 'node-cron';

interface ScheduledJob {
  name: string;
  cron: string;
  workflowName: string;
  params: Record<string, unknown>;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

// 预置定时任务
const DEFAULT_JOBS: ScheduledJob[] = [
  {
    name: '日常巡检',
    cron: '3 9 * * 1-5',        // 工作日 09:03
    workflowName: '日常巡检',
    params: {},
    enabled: true,
  },
];

const activeCronJobs = new Map<string, cron.ScheduledTask>();

/**
 * 初始化所有定时任务
 */
export function initScheduler(
  workflowStarter: (name: string, params: Record<string, unknown>, emitter: EventEmitter) => void
): void {
  for (const job of DEFAULT_JOBS) {
    if (!job.enabled) continue;

    // 计算下次运行时间
    const task = cron.schedule(job.cron, () => {
      console.log(`[Scheduler] Triggering: ${job.name}`);
      job.lastRun = new Date().toISOString();

      const emitter = new EventEmitter();

      emitter.on('workflow:done', () => {
        console.log(`[Scheduler] ${job.name} completed`);
      });

      emitter.on('workflow:failed', (data) => {
        console.error(`[Scheduler] ${job.name} failed:`, data);
      });

      try {
        workflowStarter(job.workflowName, job.params, emitter);
      } catch (err) {
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
export function listScheduledJobs(): ScheduledJob[] {
  return DEFAULT_JOBS;
}

/**
 * 启用/禁用定时任务
 */
export function toggleJob(name: string, enabled: boolean): void {
  const job = DEFAULT_JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Job not found: ${name}`);

  job.enabled = enabled;

  if (enabled && !activeCronJobs.has(name)) {
    // 启动
  } else if (!enabled && activeCronJobs.has(name)) {
    activeCronJobs.get(name)?.stop();
    activeCronJobs.delete(name);
  }
}
