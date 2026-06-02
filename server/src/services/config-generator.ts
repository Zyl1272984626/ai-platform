/**
 * 配置文件生成服务
 * 直接读取主系统的真实 YAML 配置文件，解析后覆盖学校差异化字段，再序列化输出。
 * 每个配置文件只接收属于自己的覆盖项，遵循 Spring Boot profiles 分离原则。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getConfig } from './config.js';
import { getSchool } from './school-manager.js';
import type { School } from './school-manager.js';

/** 获取主系统 resources 根目录 */
function getResourcesDir(): string {
  return path.resolve(getConfig().projectRoot, 'backend', 'src', 'main', 'resources');
}

/** 获取 config 子目录 */
function getConfigDir(): string {
  return path.join(getResourcesDir(), 'config');
}

/**
 * 深度设置对象中指定路径的值
 * pathStr 格式: "spring.datasource.username"（点分隔）
 */
function setDeepValue(obj: any, pathStr: string, value: unknown): void {
  const keys = pathStr.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

/** 按 profile 文件分组的覆盖映射 */
interface ProfileOverrides {
  application: Record<string, unknown>;
  db: Record<string, unknown>;
  agent: Record<string, unknown>;
  security: Record<string, unknown>;
  common: Record<string, unknown>;
}

function getServerOs(school: School): 'linux' | 'windows' {
  const serverOs = school.deployConfig?.serverOs || school.common?.serverOs;
  return serverOs === 'windows' ? 'windows' : 'linux';
}

function getWindowsDrive(school: School): string {
  const raw = school.deployConfig?.windowsDrive || school.common?.windowsDrive || 'D:';
  const normalized = raw.trim().replace(/\\+$/, '');
  return /^[A-Za-z]:$/.test(normalized) ? normalized : 'D:';
}

function joinDeployPath(school: School, child: string): string {
  if (getServerOs(school) === 'windows') {
    return `${getWindowsDrive(school)}/fskj/workspace/agent/${child}`;
  }
  return `/fskj/workspace/agent/${child}`;
}

/** 根据学校配置生成按 profile 分组的覆盖项 */
function buildProfileOverrides(school: School): ProfileOverrides {
  const app: Record<string, unknown> = {};
  const db: Record<string, unknown> = {};
  const agent: Record<string, unknown> = {};
  const security: Record<string, unknown> = {};
  const common: Record<string, unknown> = {};

  // === application.yml ===
  // 只管：profiles.active、topspeeder.auth.*、topspeeder.permission.*
  app['spring.profiles.active'] = school.type === 'mysql' ? 'mysql' : 'dameng';
  app['app.script-dir'] = joinDeployPath(school, 'tool-script');

  if (school.cas) {
    if (school.cas.enableCas !== undefined) app['topspeeder.auth.enableCas'] = school.cas.enableCas;
    if (school.cas.enableMobileCas !== undefined) app['topspeeder.auth.enableMobileCas'] = school.cas.enableMobileCas;
    if (school.cas.casHost) {
      app['topspeeder.auth.casHost'] = school.cas.casHost;
      // 从 casHost 自动拼接 loginUrl、loginSuccess、host（保留原始项目中的路径后缀）
      app['topspeeder.auth.loginUrl'] = school.cas.casHost + '/index/index.html#/login';
      app['topspeeder.auth.loginSuccess'] = school.cas.casHost + '/index/index.html#/';
      app['topspeeder.auth.host'] = school.cas.casHost;
    }
  }

  if (school.passwords) {
    if (school.passwords.defaultPassword) app['topspeeder.permission.password-default'] = school.passwords.defaultPassword;
    if (school.passwords.superPassword) app['topspeeder.permission.password-super'] = school.passwords.superPassword;
    if (school.passwords.salt) app['topspeeder.permission.password-salt'] = school.passwords.salt;
  }

  // === application-mysql.yml / application-dameng.yml ===
  // 只管：数据库连接、端口
  if (school.type === 'mysql') {
    if (school.dbHost) {
      const dbName = school.database || 'agent_portal';
      const dbPort = school.dbPort || 3306;
      db['spring.datasource.url'] = `jdbc:mysql://${school.dbHost}:${dbPort}/${dbName}?useUnicode=true&characterEncoding=utf-8&autoReconnect=true&useSSL=true&serverTimezone=UTC&allowMultiQueries=true&rewriteBatchedStatements=true`;
    }
    db['spring.datasource.driver-class-name'] = 'com.mysql.cj.jdbc.Driver';
  } else {
    if (school.dbHost) {
      const dbName = school.database || 'AGENT';
      const dbPort = school.dbPort || 5237;
      db['spring.datasource.url'] = `jdbc:dm://${school.dbHost}:${dbPort}/${dbName}?zeroDateTimeBehavior=convertToNull&useUnicode=true&characterEncoding=utf-8&clobAsString=true`;
    }
    db['spring.datasource.driver-class-name'] = 'dm.jdbc.driver.DmDriver';
  }
  if (school.dbUser) db['spring.datasource.username'] = school.dbUser;
  if (school.dbPassword) db['spring.datasource.password'] = school.dbPassword;
  if (school.database) db['spring.datasource.hibernate-default-schema'] = school.database;
  db['server.port'] = school.port;

  // === application-agent.yml ===
  // 沙箱路径跟随部署脚本创建的目录，确保 WAR 配置和服务器目录一致。
  agent['ai.agent.sandbox.base-path'] = joinDeployPath(school, 'sandbox');
  if (school.sandbox) {
    if (school.sandbox.strategy) agent['ai.agent.sandbox.strategy'] = school.sandbox.strategy;
    if (school.sandbox.sandboxieHome) agent['ai.agent.sandbox.sandboxie.home'] = school.sandbox.sandboxieHome;
    if (school.sandbox.sandboxieIniPath) agent['ai.agent.sandbox.sandboxie.ini-path'] = school.sandbox.sandboxieIniPath;
  }

  // === application-security.yml ===
  // 只管：安全模式
  if (school.security?.mode) {
    security['topspeeder.security.mode'] = school.security.mode;
  }

  // === application-common.yml ===
  // 只管：通用配置（AMap、Druid）
  if (school.common) {
    if (school.common.amapKey) common['ip-location.amap.api-key'] = school.common.amapKey;
    if (school.common.druidUser) common['spring.datasource.druid.stat-view-servlet.login-username'] = school.common.druidUser;
    if (school.common.druidPassword) common['spring.datasource.druid.stat-view-servlet.login-password'] = school.common.druidPassword;
  }

  return { application: app, db, agent, security, common };
}

/** 对单个文件应用覆盖，返回生成后的 YAML 字符串 */
function applyOverrides(filePath: string, overrides: Record<string, unknown>): string | null {
  if (!fs.existsSync(filePath)) return null;
  if (Object.keys(overrides).length === 0) return null; // 没有覆盖项就跳过

  const content = fs.readFileSync(filePath, 'utf-8');
  const doc = yaml.load(content) as Record<string, unknown> || {};

  for (const [pathStr, value] of Object.entries(overrides)) {
    setDeepValue(doc, pathStr, value);
  }

  return yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true });
}

/** 预览生成结果（不写文件） */
export function previewConfigs(code: string): Record<string, string> {
  const school = getSchool(code);
  if (!school) throw new Error(`School not found: ${code}`);

  const configDir = getConfigDir();
  const po = buildProfileOverrides(school);
  const result: Record<string, string> = {};

  const dbFile = school.type === 'mysql' ? 'application-mysql.yml' : 'application-dameng.yml';

  // 每个文件只接收属于自己的覆盖项
  const filesToProcess = [
    { name: 'application.yml', path: path.join(getResourcesDir(), 'application.yml'), overrides: po.application },
    { name: dbFile, path: path.join(configDir, dbFile), overrides: po.db },
    { name: 'application-agent.yml', path: path.join(configDir, 'application-agent.yml'), overrides: po.agent },
    { name: 'application-security.yml', path: path.join(configDir, 'application-security.yml'), overrides: po.security },
    { name: 'application-common.yml', path: path.join(configDir, 'application-common.yml'), overrides: po.common },
  ];

  for (const { name, path: fpath, overrides } of filesToProcess) {
    const output = applyOverrides(fpath, overrides);
    if (output !== null) {
      result[name] = output;
    }
  }

  return result;
}

