/**
 * 学校配置管理
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AI_PLATFORM_ROOT } from './config.js';

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

interface SchoolsData {
  schools: School[];
}

const DATA_DIR = path.resolve(AI_PLATFORM_ROOT, 'data');
const SCHOOLS_FILE = path.join(DATA_DIR, 'schools.yaml');

function readSchools(): SchoolsData {
  if (!fs.existsSync(SCHOOLS_FILE)) return { schools: [] };
  const content = fs.readFileSync(SCHOOLS_FILE, 'utf-8');
  return yaml.load(content) as SchoolsData;
}

function writeSchools(data: SchoolsData): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCHOOLS_FILE, yaml.dump(data, { indent: 2 }), 'utf-8');
}

export function listSchools(): School[] {
  return readSchools().schools;
}

export function getSchool(code: string): School | undefined {
  return readSchools().schools.find((s) => s.code === code);
}

export function addSchool(school: School): School {
  const data = readSchools();
  if (data.schools.some((s) => s.code === school.code)) {
    throw new Error(`School already exists: ${school.code}`);
  }
  data.schools.push(school);
  writeSchools(data);
  return school;
}

export function updateSchool(code: string, updates: Partial<School>): School {
  const data = readSchools();
  const index = data.schools.findIndex((s) => s.code === code);
  if (index === -1) throw new Error(`School not found: ${code}`);
  data.schools[index] = { ...data.schools[index], ...updates, code }; // code 不可改
  writeSchools(data);
  return data.schools[index];
}

export function removeSchool(code: string): boolean {
  const data = readSchools();
  const index = data.schools.findIndex((s) => s.code === code);
  if (index === -1) return false;
  data.schools.splice(index, 1);
  writeSchools(data);
  return true;
}
