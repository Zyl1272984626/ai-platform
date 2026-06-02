export interface PageConfig {
    id: string;
    name: string;
    url: string;
    path: string;
    description?: string;
}
export interface PageSet {
    id: string;
    name: string;
    description?: string;
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
    pageSets: PageSet[];
    discoveredAt?: string;
    discoveryResult?: any;
    status: 'active' | 'inactive';
}
export interface PlatformConfig {
    projectRoot: string;
    aiPlatformRoot: string;
    e2eDataDir: string;
    mainFrontendPort: number;
    mainBackendPort: number;
    apiTestBaseUrl: string;
    projects: TestProject[];
    defaultProjectId: string;
}
/** 运行时配置缓存 */
declare let config: PlatformConfig;
/** 从文件加载配置 */
export declare function loadConfig(): PlatformConfig;
/** 获取当前配置 */
export declare function getConfig(): PlatformConfig;
/** 更新基础配置（部分更新）并持久化 */
export declare function updateConfig(partial: Partial<PlatformConfig>): PlatformConfig;
/** 获取所有项目 */
export declare function getProjects(): TestProject[];
/** 根据 ID 获取项目 */
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
/** 更新项目的页面集（发现后更新） */
export declare function updateProjectPages(id: string, pageSets: PageSet[], discoveryResult?: any): TestProject | null;
/** 检查配置项是否有效 */
export declare function checkConfig(): Promise<Record<string, {
    ok: boolean;
    msg: string;
}>>;
export declare const PROJECT_ROOT: string;
export declare const AI_PLATFORM_ROOT: string;
export { config as _runtimeConfig };
//# sourceMappingURL=config.d.ts.map