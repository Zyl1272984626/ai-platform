export interface PageConfig {
    id: string;
    name: string;
    url: string;
    path: string;
    description?: string;
    hasDynamicParams?: boolean;
    params?: Record<string, string[]>;
}
export interface PageSet {
    id: string;
    name: string;
    description?: string;
    entry?: string;
    relatedEntries?: string[];
    suggestSplit?: boolean;
    pages: PageConfig[];
}
export interface TestProject {
    id: string;
    name: string;
    baseUrl: string;
    apiBaseUrl: string;
    loginUrl: string;
    username: string;
    password: string;
    sourcePath?: string;
    skillPath?: string;
    status: 'active' | 'inactive';
    pageSets?: PageSet[];
    discoveredAt?: string;
    globalParams?: Record<string, string[]>;
}
export interface ClaudeConfig {
    authToken: string;
    baseUrl: string;
    model: string;
}
export interface PlatformConfig {
    projectRoot: string;
    aiPlatformRoot: string;
    e2eDataDir: string;
    testDataDir: string;
    mainFrontendPort: number;
    mainBackendPort: number;
    apiTestBaseUrl: string;
    projects: TestProject[];
    defaultProjectId: string;
    claudeConfig?: ClaudeConfig;
}
/** 运行时配置缓存 */
declare let config: PlatformConfig;
/** 项目页面数据结构 */
export interface ProjectPageData {
    pageSets: PageSet[];
    discoveredAt?: string;
    totalPages?: number;
    globalParams?: Record<string, string[]>;
}
/** 从独立文件读取项目页面数据 */
export declare function loadProjectPages(projectId: string): ProjectPageData;
/** 将项目页面数据写入独立文件 */
export declare function saveProjectPages(projectId: string, data: ProjectPageData): void;
/** 读取项目公共参数 */
export declare function getGlobalParams(projectId: string): Record<string, string[]>;
/** 保存项目公共参数 */
export declare function saveGlobalParams(projectId: string, params: Record<string, string[]>): void;
/** 保存原始发现数据到独立文件 */
export declare function saveDiscoveryResult(projectId: string, discoveryResult: any): void;
/** 将 claudeConfig 同步到 process.env，让 SDK 和子进程能读取 */
export declare function applyClaudeConfig(): void;
/** 从文件加载配置 */
export declare function loadConfig(): PlatformConfig;
/** 获取当前配置 */
export declare function getConfig(): PlatformConfig;
/** 更新基础配置（部分更新）并持久化 */
export declare function updateConfig(partial: Partial<PlatformConfig>): PlatformConfig;
/** 获取所有项目（动态合并页面数据） */
export declare function getProjects(): TestProject[];
/** 根据 ID 获取项目（动态合并页面数据） */
export declare function getProjectById(id: string): TestProject | undefined;
/** 获取默认项目 */
export declare function getDefaultProject(): TestProject | undefined;
/** 添加项目 */
export declare function addProject(project: Omit<TestProject, 'id' | 'pageSets'>): TestProject;
/** 更新项目 */
export declare function updateProject(id: string, updates: Partial<TestProject>): TestProject | null;
/** 删除项目 */
export declare function deleteProject(id: string): boolean;
/** 设置默认项目 */
export declare function setDefaultProject(id: string): boolean;
/** 更新项目的页面集（发现后更新，写入独立文件） */
export declare function updateProjectPages(id: string, pageSets: PageSet[], discoveryResult?: any): TestProject | null;
/** 仅更新页面集数据（不更新发现结果，用于手动编辑） */
export declare function saveProjectPageSets(id: string, pageSets: PageSet[]): PageSet[] | null;
/** 检查配置项是否有效 */
export declare function checkConfig(): Promise<Record<string, {
    ok: boolean;
    msg: string;
}>>;
export declare const PROJECT_ROOT: string;
export declare const AI_PLATFORM_ROOT: string;
export { config as _runtimeConfig };
//# sourceMappingURL=config.d.ts.map