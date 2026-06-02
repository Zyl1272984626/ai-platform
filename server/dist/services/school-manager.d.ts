interface SchoolDeploy {
    host: string;
    user: string;
    ymlDir?: string;
    sshKey?: string;
}
export interface CasConfig {
    enableCas?: boolean;
    enableMobileCas?: boolean;
    casHost?: string;
    loginUrl?: string;
    loginSuccess?: string;
}
export interface SandboxConfig {
    basePath?: string;
    strategy?: string;
    sandboxieHome?: string;
    sandboxieIniPath?: string;
}
export interface SecurityConfig {
    mode?: string;
}
export interface PasswordConfig {
    username?: string;
    defaultPassword?: string;
    superPassword?: string;
    salt?: string;
}
export interface CommonConfig {
    /** @deprecated use deployConfig.serverOs */
    serverOs?: 'linux' | 'windows';
    /** @deprecated use deployConfig.windowsDrive */
    windowsDrive?: string;
    amapKey?: string;
    druidUser?: string;
    druidPassword?: string;
}
export interface DeployConfig {
    serverOs?: 'linux' | 'windows';
    windowsDrive?: string;
    dbRootPassword?: string;
    mysqlContainer?: string;
    oneapiHost?: string;
    oneapiPort?: number;
    oneapiKey?: string;
    knowledgeBaseUrl?: string;
    knowledgeAppId?: string;
    knowledgeApiKey?: string;
    voiceApiUrl?: string;
}
export interface School {
    code: string;
    name: string;
    type: 'mysql' | 'dameng';
    port: number;
    database: string;
    deploy: SchoolDeploy;
    status: 'pending' | 'configured' | 'deployed' | 'error';
    lastDeploy: string | null;
    dbHost?: string;
    dbPort?: number;
    dbUser?: string;
    dbPassword?: string;
    cas?: CasConfig;
    sandbox?: SandboxConfig;
    security?: SecurityConfig;
    passwords?: PasswordConfig;
    common?: CommonConfig;
    deployConfig?: DeployConfig;
}
export declare function listSchools(): School[];
export declare function getSchool(code: string): School | undefined;
export declare function addSchool(school: School): School;
export declare function updateSchool(code: string, updates: Partial<School>): School;
export declare function removeSchool(code: string): boolean;
export {};
//# sourceMappingURL=school-manager.d.ts.map