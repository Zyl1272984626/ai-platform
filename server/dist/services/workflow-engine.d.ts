/**
 * 工作流调度引擎（v2）
 *
 * 升级：
 * - 条件分支：if/else/switch 根据上一步结果走不同路径
 * - 并行执行：parallel 组内步骤同时运行
 * - 断点恢复：每步执行后持久化状态，重启后从断点继续
 * - 失败策略：retry / rollback / skip / abort
 * - 上下文传递：${prevStep.output.xxx} 自动解析
 */
import { EventEmitter } from 'events';
type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'waiting_confirm';
interface GateConfig {
    maxFiles?: number;
    compileCheck?: boolean;
    requireConfirmation?: boolean;
    /** 条件表达式，满足时暂停等待确认 */
    confirmWhen?: string;
}
interface RetryConfig {
    maxAttempts: number;
    onFailure: 'rollback' | 'skip' | 'abort';
    /** 重试前等待毫秒 */
    delay?: number;
}
interface WorkflowStep {
    id: string;
    skill: string;
    action?: string;
    input: Record<string, unknown>;
    output?: Record<string, string>;
    gate?: GateConfig;
    retry?: RetryConfig;
    /** 条件：表达式为真时执行此步骤，否则跳过 */
    condition?: string;
    /** 并行组：相同 parallelGroup 的步骤同时执行 */
    parallelGroup?: string;
    /** 超时（毫秒） */
    timeout?: number;
}
interface WorkflowDefinition {
    name: string;
    description: string;
    trigger: {
        command: string;
        params: Array<{
            name: string;
            required: boolean;
            description: string;
        }>;
    };
    steps: WorkflowStep[];
}
interface StepRun {
    stepId: string;
    status: StepStatus;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    attempts: number;
}
interface WorkflowRun {
    id: string;
    workflowName: string;
    triggerParams: Record<string, unknown>;
    status: 'running' | 'completed' | 'failed' | 'paused' | 'aborted';
    steps: StepRun[];
    context: Record<string, unknown>;
    startedAt: string;
    finishedAt?: string;
    currentStepIndex: number;
    /** 执行日志 */
    logs: Array<{
        time: string;
        level: string;
        message: string;
    }>;
}
export declare function loadWorkflowDefinitions(): WorkflowDefinition[];
export declare function getWorkflowDefinition(name: string): WorkflowDefinition | undefined;
export declare function startWorkflow(workflowName: string, params: Record<string, unknown>, emitter: EventEmitter): WorkflowRun;
/**
 * 从断点恢复
 */
export declare function resumeWorkflow(runId: string, emitter: EventEmitter): WorkflowRun;
export declare function getWorkflowRun(runId: string): WorkflowRun | undefined;
export declare function listWorkflowRuns(): WorkflowRun[];
export declare function confirmStep(runId: string): void;
export declare function abortWorkflow(runId: string): void;
export {};
//# sourceMappingURL=workflow-engine.d.ts.map