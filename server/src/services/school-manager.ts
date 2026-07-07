/**
 * 学校配置管理
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getConfig } from './config.js';

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
  host?: string;
  loginUrl?: string;
  loginSuccess?: string;
}

export interface SandboxConfig {
  basePath?: string;
  /** 是否启用沙箱隔离（false 则使用 LocalStrategy，不做隔离） */
  enabled?: boolean;
  /** 隔离策略：auto / bubblewrap / wsl / sandboxie / local */
  strategy?: string;
  /** Bubblewrap 二进制路径（Linux / WSL），默认 bwrap */
  bubblewrapBinary?: string;
  /** 沙箱并发池大小（同时执行的并发数） */
  poolSize?: number;
  /** 运行时路径列表（只读挂载到沙箱：python/node 等），写回 application-agent.yml 的 runtime-paths */
  runtimePaths?: string[];
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

// ========== 项目(Project)模型 ==========

/** 项目类型：决定脚本模板、yml 模板、构建方式 */
export type ProjectType = 'agent' | 'knowledge-center';

/** 项目状态 */
export type ProjectStatus = 'pending' | 'configured' | 'deployed' | 'error';

/** knowledge-center 专属配置（Milvus/Neo4j/Redis/Embedding/Rerank） */
export interface KnowledgeCenterConfig {
  milvus?: {
    url?: string;
    port?: number;
    userName?: string;
    userPassword?: string;
    dbName?: string;
    embeddingDimension?: number;
  };
  neo4j?: {
    uri?: string;
    username?: string;
    password?: string;
  };
  redis?: {
    host?: string;
    port?: number;
    password?: string;
    database?: number;
  };
  /** Embedding / 聊天 / 图谱 / 视觉 / 语音模型，走 OpenAI 兼容接口 */
  embedding?: {
    baseUrl?: string;
    apiKey?: string;
    modelName?: string;
    chatModelName?: string;
    graphModelName?: string;
    visionModelName?: string;
    audioTranscriptionModelName?: string;
  };
  rerank?: {
    url?: string;
    model?: string;
    minScore?: number;
  };
  /** 外挂配置使用的 profile，dev 或 prod */
  profile?: 'dev' | 'prod';
}

/**
 * 项目的可部署配置。
 * 一个项目 = 一个独立可部署应用（自带数据库/端口/服务器）。
 */
export interface Project {
  /** 项目内唯一编码，如 'agent' / 'knowledge-center' */
  code: string;
  /** 项目显示名 */
  name: string;
  /** 项目类型 */
  type: ProjectType;
  status: ProjectStatus;
  lastDeploy: string | null;

  /** 部署目标（独立基础设施） */
  deploy: {
    host: string;
    user: string;
    serverOs: 'linux' | 'windows';
    windowsDrive?: string;
    /** MySQL root 密码（建库用） */
    dbRootPassword?: string;
    /** Docker MySQL 容器名（可选，不填用宿主机 mysql 命令） */
    mysqlContainer?: string;
    /** 应用端口（agent 9998 / kc 9999） */
    appPort: number;
  };

  /** 数据库配置 */
  dbType: 'mysql' | 'dameng';
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  /** 主库名 */
  database: string;
  /** 业务库名（agent 专有：${database}_business；kc 无） */
  businessDatabase?: string;

  // ----- agent 专属（仅 type==='agent' 时有意义）-----
  cas?: CasConfig;
  sandbox?: SandboxConfig;
  security?: SecurityConfig;
  passwords?: PasswordConfig;
  common?: CommonConfig;
  /** agent 的 OneApi / 知识中心 / 语音 */
  deployConfig?: DeployConfig;

  // ----- knowledge-center 专属（仅 type==='knowledge-center' 时有意义）-----
  knowledgeCenter?: KnowledgeCenterConfig;
}

export interface School {
  code: string;
  name: string;
  status: 'pending' | 'configured' | 'deployed' | 'error';
  lastDeploy: string | null;

  /** 项目列表：每个 project 是一个独立可部署应用 */
  projects: Project[];

  // ===== 以下为旧字段（@deprecated），仅用于兼容迁移期的数据回填 =====
  /** @deprecated 迁移到 projects[0] (agent) */
  type?: 'mysql' | 'dameng';
  /** @deprecated 迁移到 projects[0].deploy.appPort */
  port?: number;
  /** @deprecated 迁移到 projects[0].database */
  database?: string;
  /** @deprecated 迁移到 projects[0].deploy */
  deploy?: SchoolDeploy;
  /** @deprecated 迁移到 projects[0].db* */
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

interface SchoolsData {
  schools: School[];
}

// ========== 旧数据 → Project 迁移 ==========

/**
 * 把旧 School 字段打包成 agent project。
 * 旧 School 只对应一个 agent 部署，所以恒迁出单个 agent project。
 */
function legacySchoolToAgentProject(raw: any): Project {
  const database = raw.database || 'agent_portal';
  const deployCfg = raw.deployConfig || {};
  const common = raw.common || {};
  const serverOs = deployCfg.serverOs || common.serverOs || 'linux';
  const windowsDrive = deployCfg.windowsDrive || common.windowsDrive || 'D:';
  const deploy = raw.deploy || { host: '', user: 'root' };

  return {
    code: 'agent',
    name: 'Agent 智能体平台',
    type: 'agent',
    status: raw.status || 'pending',
    lastDeploy: raw.lastDeploy ?? null,
    deploy: {
      host: deploy.host || '',
      user: deploy.user || 'root',
      serverOs: serverOs === 'windows' ? 'windows' : 'linux',
      windowsDrive,
      dbRootPassword: deployCfg.dbRootPassword,
      mysqlContainer: deployCfg.mysqlContainer,
      appPort: raw.port ?? 9998,
    },
    dbType: raw.type === 'dameng' ? 'dameng' : 'mysql',
    dbHost: raw.dbHost || '',
    dbPort: raw.dbPort ?? (raw.type === 'dameng' ? 5237 : 3306),
    dbUser: raw.dbUser || '',
    dbPassword: raw.dbPassword || '',
    database,
    // agent 业务库 = 主库 + _business（约定，deploy-script-generator 依赖此命名）
    businessDatabase: `${database}_business`,
    cas: raw.cas,
    sandbox: raw.sandbox,
    security: raw.security,
    passwords: raw.passwords,
    common: raw.common,
    deployConfig: raw.deployConfig,
  };
}

/**
 * 惰性归一化：读出口统一把任意 School 转成"含 projects[]"的新形态。
 * - 新数据（已有 projects[]）→ 直接返回（清理可能的内部 undefined）
 * - 旧数据（字段挂在 school 上）→ 包装成单个 agent project
 */
function normalizeSchool(raw: any): School {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid school data');
  }

  // 新格式：已有 projects 数组
  if (Array.isArray(raw.projects) && raw.projects.length > 0) {
    return {
      code: raw.code,
      name: raw.name,
      status: raw.status || 'pending',
      lastDeploy: raw.lastDeploy ?? null,
      projects: raw.projects,
    };
  }

  // 旧格式：把挂在 school 上的字段迁移成 agent project
  const project = legacySchoolToAgentProject(raw);
  return {
    code: raw.code,
    name: raw.name,
    status: raw.status || 'pending',
    lastDeploy: raw.lastDeploy ?? null,
    projects: [project],
  };
}

/** 判断 School 是否为旧格式（字段挂在顶层而非 projects[]），用于决定写回策略 */
function isLegacySchool(raw: any): boolean {
  return !Array.isArray(raw.projects) || raw.projects.length === 0;
}

function getDataDir(): string {
  return path.resolve(getConfig().aiPlatformRoot, 'data');
}

function getSchoolsFile(): string {
  return path.join(getDataDir(), 'schools.yaml');
}

function readSchools(): SchoolsData {
  const schoolsFile = getSchoolsFile();
  if (!fs.existsSync(schoolsFile)) return { schools: [] };
  const content = fs.readFileSync(schoolsFile, 'utf-8');
  return yaml.load(content) as SchoolsData;
}

function writeSchools(data: SchoolsData): void {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(getSchoolsFile(), yaml.dump(data, { indent: 2 }), 'utf-8');
}

/** 读出口：所有 School 统一归一化为含 projects[] 的新形态 */
export function listSchools(): School[] {
  return readSchools().schools.map(normalizeSchool);
}

/** 读出口：单个 School 归一化 */
export function getSchool(code: string): School | undefined {
  const raw = readSchools().schools.find((s) => s.code === code);
  return raw ? normalizeSchool(raw) : undefined;
}

/** 读取原始数据（用于写路径，保留旧字段双写） */
function getRawSchool(code: string): any | undefined {
  return readSchools().schools.find((s: any) => s.code === code);
}

export function addSchool(school: School): School {
  const data = readSchools();
  if (data.schools.some((s) => s.code === school.code)) {
    throw new Error(`School already exists: ${school.code}`);
  }
  // 只持久化新格式（顶层不再带 deprecated 字段）
  const clean: School = {
    code: school.code,
    name: school.name,
    status: school.status || 'pending',
    lastDeploy: school.lastDeploy ?? null,
    projects: school.projects || [],
  };
  data.schools.push(clean);
  writeSchools(data);
  return clean;
}

/**
 * 更新学校。接收新格式（含 projects[]）。
 * 旧数据被更新时，原顶层的 deprecated 字段一并清除（迁移落定）。
 */
export function updateSchool(code: string, updates: Partial<School>): School {
  const data = readSchools();
  const index = data.schools.findIndex((s) => s.code === code);
  if (index === -1) throw new Error(`School not found: ${code}`);
  const prev = data.schools[index];

  const next: School = {
    code,
    name: updates.name ?? prev.name,
    status: updates.status ?? prev.status ?? 'pending',
    lastDeploy: updates.lastDeploy ?? prev.lastDeploy ?? null,
    projects: updates.projects ?? (prev.projects && prev.projects.length > 0 ? prev.projects : normalizeSchool(prev).projects),
  };
  data.schools[index] = next;
  writeSchools(data);
  return next;
}

export function removeSchool(code: string): boolean {
  const data = readSchools();
  const index = data.schools.findIndex((s) => s.code === code);
  if (index === -1) return false;
  data.schools.splice(index, 1);
  writeSchools(data);
  return true;
}

// ========== 项目级 CRUD ==========

/** 取学校下指定 project（已 normalize） */
export function getProject(code: string, projectCode: string): Project | undefined {
  const school = getSchool(code);
  if (!school) return undefined;
  return school.projects.find((p) => p.code === projectCode);
}

/** 给学校添加一个 project */
export function addProject(code: string, project: Project): School {
  const data = readSchools();
  const index = data.schools.findIndex((s: any) => s.code === code);
  if (index === -1) throw new Error(`School not found: ${code}`);

  const school = normalizeSchool(data.schools[index]);
  if (school.projects.some((p) => p.code === project.code)) {
    throw new Error(`Project already exists: ${project.code}`);
  }
  school.projects.push(project);
  data.schools[index] = school;
  writeSchools(data);
  return school;
}

/** 更新学校下指定 project */
export function updateProject(code: string, projectCode: string, updates: Partial<Project>): School {
  const data = readSchools();
  const index = data.schools.findIndex((s: any) => s.code === code);
  if (index === -1) throw new Error(`School not found: ${code}`);

  const school = normalizeSchool(data.schools[index]);
  const pIdx = school.projects.findIndex((p) => p.code === projectCode);
  if (pIdx === -1) throw new Error(`Project not found: ${projectCode}`);

  const prev = school.projects[pIdx];
  school.projects[pIdx] = { ...prev, ...updates, code: projectCode } as Project;
  data.schools[index] = school;
  writeSchools(data);
  return school;
}

/** 移除学校下指定 project */
export function removeProject(code: string, projectCode: string): School {
  const data = readSchools();
  const index = data.schools.findIndex((s: any) => s.code === code);
  if (index === -1) throw new Error(`School not found: ${code}`);

  const school = normalizeSchool(data.schools[index]);
  const before = school.projects.length;
  school.projects = school.projects.filter((p) => p.code !== projectCode);
  if (school.projects.length === before) {
    throw new Error(`Project not found: ${projectCode}`);
  }
  data.schools[index] = school;
  writeSchools(data);
  return school;
}
