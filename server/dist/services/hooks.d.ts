/**
 * Hook 自动化处理器
 *
 * 在工作流执行过程中自动触发：
 * - 代码修改后自动编译检查
 * - 步骤完成后自动通知
 * - 工具调用拦截和日志
 */
export interface HookContext {
    runId: string;
    stepId: string;
    toolName?: string;
    filePath?: string;
    result?: unknown;
}
/**
 * PostToolUse Hook：代码修改后自动编译检查
 */
export declare function postToolUseCompileCheck(ctx: HookContext): Promise<void>;
/**
 * Stop Hook：工作流步骤完成后记录状态
 */
export declare function onStopLog(ctx: HookContext): Promise<void>;
/**
 * Notification Hook：关键事件转发通知
 */
export declare function notificationHook(ctx: HookContext, message: string): Promise<void>;
//# sourceMappingURL=hooks.d.ts.map