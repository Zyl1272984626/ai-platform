interface SchoolDeploy {
    host: string;
    user: string;
    ymlDir?: string;
    sshKey?: string;
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
    amapKey?: string;
    dbHost?: string;
    dbPort?: number;
    dbUser?: string;
    dbPassword?: string;
}
export declare function listSchools(): School[];
export declare function getSchool(code: string): School | undefined;
export declare function addSchool(school: School): School;
export declare function updateSchool(code: string, updates: Partial<School>): School;
export declare function removeSchool(code: string): boolean;
export {};
//# sourceMappingURL=school-manager.d.ts.map