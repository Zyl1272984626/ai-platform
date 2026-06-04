export type TestType = 'agent' | 'e2e' | 'frontend' | 'api' | 'codereview';
export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';
export interface StreamBlock {
    type: 'text' | 'tool_use';
    content?: string;
    name?: string;
    input?: any;
    result?: string;
    toolUseId?: string;
}
export interface TestCase {
    id: string;
    name: string;
    type: TestType;
    status: TestStatus;
    duration?: number;
    error?: string;
    output?: string;
    blocks?: StreamBlock[];
}
/** 中断恢复信息（按模块维度记录 session_id） */
export interface ResumeCaseInfo {
    sessionId: string;
    status: 'completed' | 'interrupted';
    partialOutput: string;
}
export interface ResumeInfo {
    cases: Record<string, ResumeCaseInfo>;
}
export interface TestSuite {
    id: string;
    name: string;
    type: TestType;
    status: TestStatus;
    cases: TestCase[];
    startedAt: string;
    finishedAt?: string;
    duration?: number;
    config: Record<string, unknown>;
}
export declare function listTestRuns(type?: TestType): TestSuite[];
export declare function getTestRun(id: string): TestSuite | undefined;
/** 将 vitest JSON 报告转为独立 HTML 报告（固定模板，与代码审查报告风格统一） */
export declare function buildFrontendTestHtml(vitestReport: any, projectSlug: string): string;
/** 扫描报告目录，返回所有 HTML/MD 文件 */
export declare function listReportFiles(projectId: string): {
    reportsDir: string;
    files: {
        name: string;
        path: string;
        type: 'html' | 'md';
        size: number;
        mtime: string;
    }[];
};
/** 从选中的 MD 文件合并生成 HTML 报告 */
export declare function buildHtmlFromMdFiles(projectId: string, mdFiles: string[]): {
    htmlPath: string;
    moduleCount: number;
};
/** 将 Markdown 审查结果转为独立 HTML 报告（服务端渲染，无 CDN 依赖） */
export declare function buildReviewHtml(projectName: string, markdown: string, duration: number): string;
export declare function createTestSuite(type: TestType, config?: Record<string, unknown>): TestSuite;
/** 恢复中断的代码审查 */
export declare function resumeTestRun(originalSuiteId: string): Promise<string>;
/** 人工对话（基于审查上下文） */
export declare function chatWithReview(suiteId: string, message: string): Promise<string>;
export declare function executeTestRun(suiteId: string): Promise<TestSuite>;
export declare function abortTestRun(id: string): boolean;
export declare function deleteTestRun(id: string): boolean;
/** 获取当前运行中的测试列表 */
export declare function listRunningSuites(): TestSuite[];
/** 获取/设置并发配置 */
export declare function getConcurrency(): Record<TestType, number>;
export declare function setConcurrency(type: TestType, val: number): void;
export interface GeneratedPrompt {
    prompt: string;
    cwd: string;
}
/** 注册手动执行产生的报告（让测试页面可见） */
export declare function registerManualReport(params: {
    type: string;
    projectId?: string;
    projectName?: string;
    reportPath?: string;
    reportFile?: string;
}): string;
export declare function generateTestPrompt(type: TestType, config: Record<string, unknown>): GeneratedPrompt;
//# sourceMappingURL=test-runner.d.ts.map