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
export async function postToolUseCompileCheck(ctx: HookContext): Promise<void> {
  const { toolName, filePath } = ctx;

  // 只对代码修改类工具触发
  if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit') return;
  if (!filePath) return;

  // 只对后端 Java 文件触发编译
  if (filePath.includes('/backend/src/') && filePath.endsWith('.java')) {
    console.log(`[Hook] Auto compile check after editing: ${filePath}`);
    // 编译检查会在下一步骤中由 code-analyzer Skill 自动执行
  }
}

/**
 * Stop Hook：工作流步骤完成后记录状态
 */
export async function onStopLog(ctx: HookContext): Promise<void> {
  console.log(`[Hook] Step ${ctx.stepId} completed in run ${ctx.runId}`);
}

/**
 * Notification Hook：关键事件转发通知
 */
export async function notificationHook(ctx: HookContext, message: string): Promise<void> {
  // 将关键通知转发给 notifier Skill
  // 在实际实现中，这里会调用企业微信/邮件 API
  console.log(`[Hook] Notification: ${message}`);
}
