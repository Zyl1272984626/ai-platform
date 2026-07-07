/**
 * 配置文件生成服务
 * 直接读取项目源码里的真实 YAML 配置文件，解析后按 project 覆盖差异化字段，再序列化输出。
 * 按 ProjectType 分发：agent 与 knowledge-center 各自一套覆盖点。
 * 每个配置文件只接收属于自己的覆盖项，遵循 Spring Boot profiles 分离原则。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getConfig, getDefaultProject, getProjectById } from './config.js';
import { getSchool } from './school-manager.js';
import type { School, Project, ProjectType } from './school-manager.js';

// ========== 源码定位 ==========

/**
 * 按 project 类型解析其源码根目录。
 * - agent：沿用平台默认项目（getDefaultProject().sourcePath）
 * - knowledge-center：从 platform-config 的 projects 注册表里按约定 id 查找
 */
const PROJECT_SOURCE_BY_TYPE: Record<ProjectType, string> = {
  'agent': 'agent-main',
  'knowledge-center': 'knowledge-center',
};

function getProjectSourceRoot(type: ProjectType): string {
  const registeredId = PROJECT_SOURCE_BY_TYPE[type];
  const registered = getProjectById(registeredId);
  if (registered?.sourcePath) return registered.sourcePath;
  // 回退：agent 用默认项目；其它类型必须已注册，否则报错
  if (type === 'agent') return getDefaultProject()?.sourcePath || getConfig().projectRoot;
  throw new Error(`项目类型 "${type}" 未在设置中注册源码路径（缺少 id=${registeredId} 的项目）。请在设置页注册该项目的 sourcePath。`);
}

/** 获取某类型项目的 resources 根目录 */
function getResourcesDir(type: ProjectType): string {
  return path.resolve(getProjectSourceRoot(type), 'backend', 'src', 'main', 'resources');
}

/** 获取 config 子目录 */
function getConfigDir(type: ProjectType): string {
  return path.join(getResourcesDir(type), 'config');
}

// ========== 通用工具 ==========

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

function getServerOs(project: Project): 'linux' | 'windows' {
  return project.deploy.serverOs === 'windows' ? 'windows' : 'linux';
}

function getWindowsDrive(project: Project): string {
  const raw = project.deploy.windowsDrive || 'D:';
  const normalized = raw.trim().replace(/\\+$/, '');
  return /^[A-Za-z]:$/.test(normalized) ? normalized : 'D:';
}

/** agent 部署目录（按 project 的服务器系统/盘符派生） */
function joinAgentDeployPath(project: Project, child: string): string {
  if (getServerOs(project) === 'windows') {
    return `${getWindowsDrive(project)}/fskj/workspace/agent/${child}`;
  }
  return `/fskj/workspace/agent/${child}`;
}

/** 按 profile 文件分组的覆盖映射（agent 专用） */
interface AgentProfileOverrides {
  application: Record<string, unknown>;
  db: Record<string, unknown>;
  agent: Record<string, unknown>;
  security: Record<string, unknown>;
  common: Record<string, unknown>;
}

/** 根据 agent project 生成按 profile 分组的覆盖项 */
function buildAgentOverrides(project: Project): AgentProfileOverrides {
  const app: Record<string, unknown> = {};
  const db: Record<string, unknown> = {};
  const agent: Record<string, unknown> = {};
  const security: Record<string, unknown> = {};
  const common: Record<string, unknown> = {};

  // === application.yml ===
  // 只管：profiles.active、topspeeder.auth.*、topspeeder.permission.*
  app['spring.profiles.active'] = project.dbType === 'mysql' ? 'mysql' : 'dameng';
  app['app.script-dir'] = joinAgentDeployPath(project, 'tool-script');

  if (project.cas) {
    if (project.cas.enableCas !== undefined) app['topspeeder.auth.enableCas'] = project.cas.enableCas;
    if (project.cas.enableMobileCas !== undefined) app['topspeeder.auth.enableMobileCas'] = project.cas.enableMobileCas;
    // casHost 单独对应 topspeeder.auth.casHost
    if (project.cas.casHost) {
      app['topspeeder.auth.casHost'] = project.cas.casHost;
    }
    // host 派生 topspeeder.auth.host / loginUrl / loginSuccess（保留原始项目中的路径后缀）
    if (project.cas.host) {
      app['topspeeder.auth.host'] = project.cas.host;
      app['topspeeder.auth.loginUrl'] = project.cas.host + '/index/index.html#/login';
      app['topspeeder.auth.loginSuccess'] = project.cas.host + '/index/index.html#/';
    }
  }

  if (project.passwords) {
    if (project.passwords.defaultPassword) app['topspeeder.permission.password-default'] = project.passwords.defaultPassword;
    if (project.passwords.superPassword) app['topspeeder.permission.password-super'] = project.passwords.superPassword;
    if (project.passwords.salt) app['topspeeder.permission.password-salt'] = project.passwords.salt;
  }

  // === application-mysql.yml / application-dameng.yml ===
  // 只管：数据库连接、端口
  if (project.dbType === 'mysql') {
    if (project.dbHost) {
      const dbName = project.database || 'agent_portal';
      const dbPort = project.dbPort || 3306;
      db['spring.datasource.url'] = `jdbc:mysql://${project.dbHost}:${dbPort}/${dbName}?useUnicode=true&characterEncoding=utf-8&autoReconnect=true&useSSL=true&serverTimezone=UTC&allowMultiQueries=true&rewriteBatchedStatements=true`;
    }
    db['spring.datasource.driver-class-name'] = 'com.mysql.cj.jdbc.Driver';
  } else {
    if (project.dbHost) {
      const dbName = project.database || 'AGENT';
      const dbPort = project.dbPort || 5237;
      db['spring.datasource.url'] = `jdbc:dm://${project.dbHost}:${dbPort}/${dbName}?zeroDateTimeBehavior=convertToNull&useUnicode=true&characterEncoding=utf-8&clobAsString=true`;
    }
    db['spring.datasource.driver-class-name'] = 'dm.jdbc.driver.DmDriver';
  }
  if (project.dbUser) db['spring.datasource.username'] = project.dbUser;
  if (project.dbPassword) db['spring.datasource.password'] = project.dbPassword;
  if (project.database) db['spring.datasource.hibernate-default-schema'] = project.database;
  db['server.port'] = project.deploy.appPort;

  // === application-agent.yml ===
  // 沙箱路径跟随部署脚本创建的目录，确保 WAR 配置和服务器目录一致。
  agent['ai.agent.sandbox.base-path'] = joinAgentDeployPath(project, 'sandbox');
  agent['ai.agent.onestop.hyper-agent.working-directory'] = joinAgentDeployPath(project, 'hyperagent/workdir');
  agent['ai.agent.onestop.hyper-agent.runtime-directory'] = joinAgentDeployPath(project, 'hyperagent/runtime');
  if (project.sandbox) {
    if (project.sandbox.enabled !== undefined) agent['ai.agent.sandbox.enabled'] = project.sandbox.enabled;
    if (project.sandbox.strategy) agent['ai.agent.sandbox.strategy'] = project.sandbox.strategy;
    if (project.sandbox.bubblewrapBinary) agent['ai.agent.sandbox.bubblewrap-binary'] = project.sandbox.bubblewrapBinary;
    if (project.sandbox.poolSize !== undefined) agent['ai.agent.sandbox.pool-size'] = project.sandbox.poolSize;
    // runtime-paths 为空数组时不覆盖，保留原始 yml 的 []
    if (project.sandbox.runtimePaths && project.sandbox.runtimePaths.length > 0) {
      agent['ai.agent.sandbox.runtime-paths'] = project.sandbox.runtimePaths;
    }
    if (project.sandbox.sandboxieHome) agent['ai.agent.sandbox.sandboxie.home'] = project.sandbox.sandboxieHome;
    if (project.sandbox.sandboxieIniPath) agent['ai.agent.sandbox.sandboxie.ini-path'] = project.sandbox.sandboxieIniPath;
  }

  // === application-security.yml ===
  // 只管：安全模式
  if (project.security?.mode) {
    security['topspeeder.security.mode'] = project.security.mode;
  }

  // === application-common.yml ===
  // 只管：通用配置（AMap、Druid）
  if (project.common) {
    if (project.common.amapKey) common['ip-location.amap.api-key'] = project.common.amapKey;
    if (project.common.druidUser) common['spring.datasource.druid.stat-view-servlet.login-username'] = project.common.druidUser;
    if (project.common.druidPassword) common['spring.datasource.druid.stat-view-servlet.login-password'] = project.common.druidPassword;
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

/** 预览生成结果（不写文件）—— 按 project 分发 */
export function previewProjectConfigs(school: School, project: Project): Record<string, string> {
  switch (project.type) {
    case 'agent':
      return buildAgentConfigFiles(project);
    case 'knowledge-center':
      return buildKnowledgeCenterConfigFiles(project);
    default:
      throw new Error(`不支持的项目类型: ${(project as Project).type}`);
  }
}

/** 兼容旧调用：默认取学校的 agent project */
export function previewConfigs(code: string): Record<string, string> {
  const school = getSchool(code);
  if (!school) throw new Error(`School not found: ${code}`);
  const agentProject = school.projects.find((p) => p.type === 'agent') || school.projects[0];
  if (!agentProject) throw new Error(`School ${code} 没有可部署的项目`);
  return previewProjectConfigs(school, agentProject);
}

/** agent 配置文件生成（覆盖 5 个 yml，进 WAR） */
function buildAgentConfigFiles(project: Project): Record<string, string> {
  const configDir = getConfigDir('agent');
  const po = buildAgentOverrides(project);
  const result: Record<string, string> = {};

  const dbFile = project.dbType === 'mysql' ? 'application-mysql.yml' : 'application-dameng.yml';

  const filesToProcess = [
    { name: 'application.yml', path: path.join(getResourcesDir('agent'), 'application.yml'), overrides: po.application },
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

// ========== knowledge-center 配置生成 ==========

/**
 * knowledge-center 配置覆盖点。
 * kc 不像 agent 有"启动后回写系统表"，所有差异化配置必须在 yml 里覆盖。
 * 覆盖点来源：knowledge-center/backend/src/main/resources/application*.yml 实地勘察。
 */
function buildKnowledgeCenterOverrides(project: Project): {
  application: Record<string, unknown>;
  devOrProd: Record<string, unknown>;
  embedding: Record<string, unknown>;
  neo4j: Record<string, unknown>;
} {
  const app: Record<string, unknown> = {};
  const devOrProd: Record<string, unknown> = {};
  const embeddingOv: Record<string, unknown> = {};
  const neo4jOv: Record<string, unknown> = {};
  const kc = project.knowledgeCenter;

  // === application.yml（根）：auth + 权限密码 ===
  if (project.cas?.casHost) app['topspeeder.auth.casHost'] = project.cas.casHost;
  if (project.cas?.host) {
    // kc 前端访问路径带 /knowledge-center 前缀（与 Dockerfile 部署上下文一致）
    app['topspeeder.auth.host'] = project.cas.host;
  }
  if (project.cas?.enableCas !== undefined) app['topspeeder.auth.enableCas'] = project.cas.enableCas;
  if (project.cas?.enableMobileCas !== undefined) app['topspeeder.auth.enableMobileCas'] = project.cas.enableMobileCas;
  if (project.passwords?.defaultPassword) app['topspeeder.permission.password-default'] = project.passwords.defaultPassword;
  if (project.passwords?.superPassword) app['topspeeder.permission.password-super'] = project.passwords.superPassword;
  if (project.passwords?.salt) app['topspeeder.permission.password-salt'] = project.passwords.salt;

  // === application-dev.yml / application-prod.yml：数据源 + 端口 ===
  const dbName = project.database || 'knowledge_center';
  const dbPort = project.dbPort || 3306;
  if (project.dbHost) {
    devOrProd['spring.datasource.url'] = `jdbc:mysql://${project.dbHost}:${dbPort}/${dbName}?useUnicode=true&characterEncoding=utf-8&useSSL=true&serverTimezone=UTC`;
  }
  if (project.dbUser) devOrProd['spring.datasource.username'] = project.dbUser;
  if (project.dbPassword) devOrProd['spring.datasource.password'] = project.dbPassword;
  if (dbName) devOrProd['spring.datasource.hibernate-default-schema'] = dbName;
  devOrProd['server.port'] = project.deploy.appPort;

  // === application-embedding.yml：Embedding 模型 + Milvus 向量库 ===
  if (kc?.embedding) {
    const e = kc.embedding;
    if (e.baseUrl) embeddingOv['embedding.openai.baseUrl'] = e.baseUrl;
    if (e.apiKey) embeddingOv['embedding.openai.apiKey'] = e.apiKey;
    if (e.modelName) embeddingOv['embedding.openai.modelName'] = e.modelName;
    if (e.chatModelName) embeddingOv['embedding.openai.chatModelName'] = e.chatModelName;
    if (e.graphModelName) embeddingOv['embedding.openai.graphModelName'] = e.graphModelName;
    if (e.visionModelName) embeddingOv['embedding.openai.visionModelName'] = e.visionModelName;
    if (e.audioTranscriptionModelName) embeddingOv['embedding.openai.audioTranscriptionModelName'] = e.audioTranscriptionModelName;
  }
  if (kc?.milvus) {
    const m = kc.milvus;
    if (m.url) embeddingOv['embedding.milvus.url'] = m.url;
    if (m.port !== undefined) embeddingOv['embedding.milvus.port'] = m.port;
    if (m.userName) embeddingOv['embedding.milvus.userName'] = m.userName;
    if (m.userPassword) embeddingOv['embedding.milvus.userPassword'] = m.userPassword;
    if (m.dbName) embeddingOv['embedding.milvus.dbName'] = m.dbName;
    if (m.embeddingDimension !== undefined) embeddingOv['embedding.milvus.embeddingDimension'] = m.embeddingDimension;
  }

  // === application-neo4j.yml：Neo4j + Redis + Rerank ===
  if (kc?.neo4j) {
    const n = kc.neo4j;
    if (n.uri) neo4jOv['spring.neo4j.uri'] = n.uri;
    if (n.username) neo4jOv['spring.neo4j.authentication.username'] = n.username;
    if (n.password) neo4jOv['spring.neo4j.authentication.password'] = n.password;
  }
  if (kc?.redis) {
    const r = kc.redis;
    if (r.host) neo4jOv['spring.data.redis.host'] = r.host;
    if (r.port !== undefined) neo4jOv['spring.data.redis.port'] = r.port;
    if (r.password !== undefined) neo4jOv['spring.data.redis.password'] = r.password;
    if (r.database !== undefined) neo4jOv['spring.data.redis.database'] = r.database;
  }
  if (kc?.rerank) {
    const rr = kc.rerank;
    if (rr.url) neo4jOv['knowledge.rerank.url'] = rr.url;
    if (rr.model) neo4jOv['knowledge.rerank.model'] = rr.model;
    if (rr.minScore !== undefined) neo4jOv['knowledge.rerank.min-score'] = rr.minScore;
  }

  return { application: app, devOrProd, embedding: embeddingOv, neo4j: neo4jOv };
}

/**
 * knowledge-center 配置文件生成。
 * kc 走"外挂 /opt/config/*.yml"模式，不进 WAR，所以每个文件即使无覆盖也要返回原内容。
 */
function buildKnowledgeCenterConfigFiles(project: Project): Record<string, string> {
  const resourcesDir = getResourcesDir('knowledge-center');
  const configDir = getConfigDir('knowledge-center');
  const ov = buildKnowledgeCenterOverrides(project);
  const result: Record<string, string> = {};

  const profile = project.knowledgeCenter?.profile || 'dev';
  const profileFile = `application-${profile}.yml`;

  // kc 外挂文件清单（docker-compose 挂载 application.yml + application-dev.yml 两个）
  // 但部署包把覆盖后的全部 config/*.yml 都带上，保证现场完整。
  const filesToProcess = [
    { name: 'application.yml', path: path.join(resourcesDir, 'application.yml'), overrides: ov.application },
    { name: profileFile, path: path.join(configDir, profileFile), overrides: ov.devOrProd },
    { name: 'application-embedding.yml', path: path.join(configDir, 'application-embedding.yml'), overrides: ov.embedding },
    { name: 'application-neo4j.yml', path: path.join(configDir, 'application-neo4j.yml'), overrides: ov.neo4j },
    { name: 'application-common.yml', path: path.join(configDir, 'application-common.yml'), overrides: {} },
  ];

  for (const { name, path: fpath, overrides } of filesToProcess) {
    if (!fs.existsSync(fpath)) {
      console.warn(`[Config] knowledge-center 缺少模板文件: ${fpath}，跳过`);
      continue;
    }
    // kc 外挂：即使无覆盖项也要输出原文件内容（供外挂使用）
    const content = fs.readFileSync(fpath, 'utf-8');
    if (Object.keys(overrides).length === 0) {
      result[name] = content;
      continue;
    }
    const doc = (yaml.load(content) as Record<string, unknown>) || {};
    for (const [pathStr, value] of Object.entries(overrides)) {
      setDeepValue(doc, pathStr, value);
    }
    result[name] = yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true });
  }

  return result;
}

