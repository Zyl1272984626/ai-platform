/**
 * 配置文件生成服务
 * 直接读取主系统的真实 YAML 配置文件，解析后覆盖学校差异化字段，再序列化输出。
 * 无需维护模板文件，配置结构随主系统自动同步。
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

/** 根据学校配置生成 YAML 路径 → 值的映射 */
function buildOverrideMap(school: School): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  // --- application.yml ---
  // spring.profiles.active: 根据数据库类型切换
  overrides['spring.profiles.active'] = school.type === 'mysql' ? 'mysql' : 'dameng';

  // topspeeder.auth.*
  if (school.cas) {
    if (school.cas.enableCas !== undefined) overrides['topspeeder.auth.enableCas'] = school.cas.enableCas;
    if (school.cas.enableMobileCas !== undefined) overrides['topspeeder.auth.enableMobileCas'] = school.cas.enableMobileCas;
    if (school.cas.casHost) overrides['topspeeder.auth.casHost'] = school.cas.casHost;
    if (school.cas.loginUrl) overrides['topspeeder.auth.loginUrl'] = school.cas.loginUrl;
    if (school.cas.loginSuccess) overrides['topspeeder.auth.loginSuccess'] = school.cas.loginSuccess;
  }
  // topspeeder.auth.host: 拼接访问地址
  if (school.deploy?.host) {
    overrides['topspeeder.auth.host'] = `http://${school.deploy.host}:${school.port}`;
  }

  // topspeeder.permission.*
  if (school.passwords) {
    if (school.passwords.defaultPassword) overrides['topspeeder.permission.password-default'] = school.passwords.defaultPassword;
    if (school.passwords.superPassword) overrides['topspeeder.permission.password-super'] = school.passwords.superPassword;
    if (school.passwords.salt) overrides['topspeeder.permission.password-salt'] = school.passwords.salt;
  }

  // --- application-mysql.yml / application-dameng.yml ---
  if (school.type === 'mysql') {
    if (school.dbHost) {
      const dbName = school.database || 'agent_portal';
      const dbPort = school.dbPort || 3306;
      overrides['spring.datasource.url'] = `jdbc:mysql://${school.dbHost}:${dbPort}/${dbName}?useUnicode=true&characterEncoding=utf-8&autoReconnect=true&useSSL=true&serverTimezone=UTC&allowMultiQueries=true&rewriteBatchedStatements=true`;
    }
    overrides['spring.datasource.driver-class-name'] = 'com.mysql.cj.jdbc.Driver';
  } else {
    if (school.dbHost) {
      const dbName = school.database || 'AGENT';
      const dbPort = school.dbPort || 5237;
      overrides['spring.datasource.url'] = `jdbc:dm://${school.dbHost}:${dbPort}/${dbName}?zeroDateTimeBehavior=convertToNull&useUnicode=true&characterEncoding=utf-8&clobAsString=true`;
    }
    overrides['spring.datasource.driver-class-name'] = 'dm.jdbc.driver.DmDriver';
  }
  if (school.dbUser) overrides['spring.datasource.username'] = school.dbUser;
  if (school.dbPassword) overrides['spring.datasource.password'] = school.dbPassword;
  if (school.database) overrides['spring.datasource.hibernate-default-schema'] = school.database;
  overrides['server.port'] = school.port;

  // --- application-agent.yml ---
  if (school.sandbox) {
    if (school.sandbox.basePath) overrides['ai.agent.sandbox.base-path'] = school.sandbox.basePath;
    if (school.sandbox.strategy) overrides['ai.agent.sandbox.strategy'] = school.sandbox.strategy;
    if (school.sandbox.sandboxieHome) overrides['ai.agent.sandbox.sandboxie.home'] = school.sandbox.sandboxieHome;
    if (school.sandbox.sandboxieIniPath) overrides['ai.agent.sandbox.sandboxie.ini-path'] = school.sandbox.sandboxieIniPath;
  }

  // --- application-security.yml ---
  if (school.security?.mode) {
    overrides['topspeeder.security.mode'] = school.security.mode;
  }

  // --- application-common.yml ---
  if (school.common) {
    if (school.common.amapKey) overrides['ip-location.amap.api-key'] = school.common.amapKey;
    if (school.common.druidUser) overrides['spring.datasource.druid.stat-view-servlet.login-username'] = school.common.druidUser;
    if (school.common.druidPassword) overrides['spring.datasource.druid.stat-view-servlet.login-password'] = school.common.druidPassword;
  }

  return overrides;
}

/** 对单个文件应用覆盖，返回生成后的 YAML 字符串 */
function applyOverrides(filePath: string, overrides: Record<string, unknown>): string | null {
  if (!fs.existsSync(filePath)) return null;

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
  const overrides = buildOverrideMap(school);
  const result: Record<string, string> = {};

  // 需要处理的文件列表
  const dbFile = school.type === 'mysql' ? 'application-mysql.yml' : 'application-dameng.yml';
  const filesToProcess = [
    { name: 'application.yml', path: path.join(getResourcesDir(), 'application.yml') },
    { name: dbFile, path: path.join(configDir, dbFile) },
    { name: 'application-agent.yml', path: path.join(configDir, 'application-agent.yml') },
    { name: 'application-security.yml', path: path.join(configDir, 'application-security.yml') },
    { name: 'application-common.yml', path: path.join(configDir, 'application-common.yml') },
  ];

  for (const { name, path: fpath } of filesToProcess) {
    const output = applyOverrides(fpath, overrides);
    if (output !== null) {
      result[name] = output;
    }
  }

  return result;
}

/** 生成并写入主系统 config 目录 */
export function generateConfigs(code: string): Record<string, string> {
  const school = getSchool(code);
  if (!school) throw new Error(`School not found: ${code}`);

  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const result = previewConfigs(code);

  for (const [fileName, content] of Object.entries(result)) {
    fs.writeFileSync(path.join(configDir, fileName), content, 'utf-8');
  }

  return result;
}
