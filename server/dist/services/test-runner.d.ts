export type TestType = 'agent' | 'e2e' | 'frontend' | 'api';
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
export declare function createTestSuite(type: TestType, config?: Record<string, unknown>): TestSuite;
export declare function executeTestRun(suiteId: string): Promise<TestSuite>;
export declare function abortTestRun(id: string): boolean;
export declare function deleteTestRun(id: string): boolean;
/** 获取当前运行中的测试列表 */
export declare function listRunningSuites(): TestSuite[];
/** 获取/设置并发配置 */
export declare function getConcurrency(): Record<TestType, number>;
export declare function setConcurrency(type: TestType, val: number): void;
//# sourceMappingURL=test-runner.d.ts.map