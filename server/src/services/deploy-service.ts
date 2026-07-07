/**
 * 部署服务：将 project 配置注入 WAR 包 / 打包部署脚本
 * 按 ProjectType 分发：agent 走 WAR 配置注入；knowledge-center 走 Docker 镜像 + 外挂配置。
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import AdmZip from 'adm-zip';
import { getConfig, getDefaultProject, getProjectById } from './config.js';
import { getSchool, getProject } from './school-manager.js';
import type { School, Project, ProjectType } from './school-manager.js';
import { previewConfigs, previewProjectConfigs } from './config-generator.js';
import { generateDeployScripts, type DeployScriptParams } from './deploy-script-generator.js';

/** 各项目类型的 WAR 产物文件名（来自对应项目 pom.xml 的 finalName 或 artifactId） */
const WAR_FILE_NAMES: Record<ProjectType, string> = {
  'agent': 'agent-1.0.war',
  'knowledge-center': 'knowledge-center.war',
};

/**
 * 按 project type 解析其源码根目录。
 * agent 用平台默认项目；其它类型从 platform-config 的 projects 注册表查（按 type 对应的 id）。
 */
const PROJECT_TYPE_TO_CONFIG_ID: Record<ProjectType, string> = {
  'agent': 'agent-main',
  'knowledge-center': 'knowledge-center',
};

function getProjectSourceRoot(type: ProjectType): string {
  // 复用 config-generator 的同名逻辑，避免重复实现
  // 此处直接读 config 注册表
  const registered = getProjectById(PROJECT_TYPE_TO_CONFIG_ID[type]);
  if (registered?.sourcePath) return registered.sourcePath;
  if (type === 'agent') return getDefaultProject()?.sourcePath || getConfig().projectRoot;
  throw new Error(`项目类型 "${type}" 未在设置中注册源码路径（缺少 id=${PROJECT_TYPE_TO_CONFIG_ID[type]} 的项目）。`);
}

/** 获取某 project 的 backend 目录 */
function getBackendDir(type: ProjectType): string {
  return path.resolve(getProjectSourceRoot(type), 'backend');
}

/** 获取某 project 的 frontend 目录 */
function getFrontendDir(type: ProjectType): string {
  return path.resolve(getProjectSourceRoot(type), 'frontend');
}

/** 获取某 project 的 WAR 路径 */
function getSourceWarPath(type: ProjectType): string {
  return path.resolve(getBackendDir(type), 'target', WAR_FILE_NAMES[type]);
}

/** 输出目录 */
function getOutputDir(): string {
  const dir = path.resolve(getConfig().aiPlatformRoot, 'data', 'deploy');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 可选部署资源：企微工具脚本包 */
function getToolScriptZipPath(): string | null {
  const filePath = path.resolve(getConfig().aiPlatformRoot, 'assets', 'deploy', 'tool-script.zip');
  return fs.existsSync(filePath) ? filePath : null;
}

function getDeployAssetPath(fileName: string): string | null {
  const filePath = path.resolve(getConfig().aiPlatformRoot, 'assets', 'deploy', fileName);
  return fs.existsSync(filePath) ? filePath : null;
}

interface FrontendBuildPlan {
  configPath: string | null;
  entryNames: string[];
}

function findOnPath(fileName: string): string | null {
  const pathValue = process.env.PATH || process.env.Path || '';
  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry.replace(/^"|"$/g, ''), fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findWindowsCommandShell(): string {
  const candidates = [
    process.env.ComSpec,
    process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'cmd.exe') : '',
    process.env.windir ? path.join(process.env.windir, 'System32', 'cmd.exe') : '',
    'C:\\Windows\\System32\\cmd.exe',
  ].filter(Boolean) as string[];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('未找到 Windows 命令解释器 cmd.exe，请检查 ComSpec/SystemRoot 环境变量。');
  }
  return found;
}

function findMavenCommand(backendDir: string): string {
  const wrapper = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
  const wrapperPath = path.join(backendDir, wrapper);
  if (fs.existsSync(wrapperPath)) return wrapperPath;

  const command = process.platform === 'win32'
    ? findOnPath('mvn.cmd') || findOnPath('mvn.bat')
    : findOnPath('mvn') || 'mvn';

  if (!command) {
    throw new Error('未找到 Maven 命令，请安装 Maven 并确保 mvn.cmd 在 PATH 中，或在项目 backend 目录提供 mvnw.cmd。');
  }
  return command;
}

function findNpmCommand(): string {
  const command = process.platform === 'win32'
    ? findOnPath('npm.cmd') || findOnPath('npm.bat')
    : findOnPath('npm') || 'npm';

  if (!command) {
    throw new Error('未找到 npm 命令，请安装 Node.js 并确保 npm 在 PATH 中。');
  }
  return command;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  label: string,
  maxBuffer = 10 * 1024 * 1024,
): Promise<{ stdout: string; stderr: string }> {
  const isWindowsBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const actualCommand = isWindowsBatch ? findWindowsCommandShell() : command;
  const actualArgs = isWindowsBatch ? ['/d', '/c', 'call', command, ...args] : args;

  return new Promise((resolve, reject) => {
    execFile(actualCommand, actualArgs, {
      cwd,
      maxBuffer,
      env: { ...process.env },
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr?.toString().trim() || stdout?.toString().trim() || error.message).slice(-2000);
        reject(new Error(`${label}失败: ${detail}`));
      } else {
        resolve({ stdout: stdout?.toString() || '', stderr: stderr?.toString() || '' });
      }
    });
  });
}

function runMaven(
  command: string,
  commandArgs: string[],
  backendDir: string,
  label: string,
): Promise<{ stdout: string; stderr: string }> {
  return runCommand(command, commandArgs, backendDir, `Maven ${label}`);
}

function splitMavenExtraArgs(extraArgs: string): string[] {
  return extraArgs.match(/"[^"]+"|'[^']+'|\S+/g)?.map(arg => arg.replace(/^['"]|['"]$/g, '')) || [];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createMavenSettingsFile(backendDir: string, repositoryUrl: string): string {
  const settingsPath = path.join(backendDir, '.ai-platform-maven-settings.xml');
  const safeUrl = escapeXml(repositoryUrl.trim());
  fs.writeFileSync(settingsPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"',
    '          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">',
    '  <mirrors>',
    '    <mirror>',
    '      <id>ai-platform-configured-repository</id>',
    '      <name>AI Platform Configured Repository</name>',
    `      <url>${safeUrl}</url>`,
    '      <mirrorOf>*</mirrorOf>',
    '    </mirror>',
    '  </mirrors>',
    '</settings>',
    '',
  ].join('\n'), 'utf-8');
  return settingsPath;
}

function createMavenCommandArgs(backendDir: string, args: string[]): { args: string[]; cleanupPath?: string } {
  const mavenConfig = getConfig().mavenConfig;
  if (!mavenConfig) return { args };

  const commandArgs = [...args];
  const localRepository = mavenConfig.localRepository?.trim();
  const settingsPath = mavenConfig.settingsPath?.trim();
  const repositoryUrl = mavenConfig.repositoryUrl?.trim();
  const extraArgs = mavenConfig.extraArgs?.trim();
  let cleanupPath: string | undefined;

  if (localRepository) {
    commandArgs.push(`-Dmaven.repo.local=${localRepository}`);
  }

  if (settingsPath) {
    commandArgs.push('-s', settingsPath);
  } else if (repositoryUrl) {
    cleanupPath = createMavenSettingsFile(backendDir, repositoryUrl);
    commandArgs.push('-s', cleanupPath);
  }

  if (extraArgs) {
    commandArgs.push(...splitMavenExtraArgs(extraArgs));
  }

  return { args: commandArgs, cleanupPath };
}

function isMavenCleanDeleteFailure(error: Error): boolean {
  return /Failed to delete|Unable to delete|Cannot delete/i.test(error.message);
}

function execFileAsync(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      env: options.env || { ...process.env },
      timeout: options.timeout,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr?.toString().trim() || stdout?.toString().trim() || error.message).slice(-1000)));
      } else {
        resolve({ stdout: stdout?.toString() || '', stderr: stderr?.toString() || '' });
      }
    });
  });
}

async function releaseWindowsBuildResources(backendDir: string): Promise<void> {
  if (process.platform !== 'win32') return;

  const targetDir = path.join(backendDir, 'target');
  const script = [
    '$backend = [IO.Path]::GetFullPath($env:BACKEND_DIR).TrimEnd("\\").ToLowerInvariant()',
    '$target = [IO.Path]::GetFullPath($env:TARGET_DIR).TrimEnd("\\").ToLowerInvariant()',
    '$matched = Get-CimInstance Win32_Process | Where-Object {',
    '  ($_.Name -eq "java.exe" -or $_.Name -eq "javaw.exe") -and $_.CommandLine -and (',
    '    $_.CommandLine.Replace("/", "\\").ToLowerInvariant().Contains($target) -or',
    '    $_.CommandLine.Replace("/", "\\").ToLowerInvariant().Contains($backend)',
    '  )',
    '}',
    'foreach ($p in $matched) {',
    '  Write-Output ("Stopping process {0} {1}" -f $p.ProcessId, $p.Name)',
    '  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue',
    '}',
  ].join('; ');

  try {
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      env: {
        ...process.env,
        BACKEND_DIR: backendDir,
        TARGET_DIR: targetDir,
      },
      timeout: 10000,
    });
    const output = result.stdout.trim();
    if (output) console.log(`[Deploy] 已尝试释放 Java 构建资源:\n${output}`);
  } catch (error) {
    console.warn(`[Deploy] 释放 Java 构建资源失败，继续执行 Maven clean: ${(error as Error).message}`);
  }
}

function prepareBuildWorkspace(backendDir: string): void {
  const targetDir = path.join(backendDir, 'target');
  if (!fs.existsSync(targetDir)) return;

  try {
    fs.rmSync(targetDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 300,
    });
    console.log(`[Deploy] 已清理构建目录: ${targetDir}`);
    return;
  } catch (error) {
    console.warn(`[Deploy] 构建目录被占用，无法完整删除，尝试隔离: ${(error as Error).message}`);
  }

  const staleDir = path.join(backendDir, `target.stale-${Date.now()}`);
  try {
    fs.renameSync(targetDir, staleDir);
    console.log(`[Deploy] 已隔离被占用的构建目录: ${staleDir}`);
  } catch (error) {
    console.warn(`[Deploy] 构建目录仍被占用，跳过 clean，直接增量 package: ${(error as Error).message}`);
  }
}

function createFrontendBuildPlan(frontendDir: string): FrontendBuildPlan {
  const viteConfigPath = path.join(frontendDir, 'vite.config.ts');
  const defaultEntries = ['index', 'setting-app', 'setting-system'];
  if (!fs.existsSync(viteConfigPath)) return { configPath: null, entryNames: defaultEntries };

  const original = fs.readFileSync(viteConfigPath, 'utf-8');
  const entryPattern = /^(\s*)(['"]?[\w-]+['"]?)\s*:\s*resolve\(['"]([^'"]+)['"]\),?\s*$/gm;
  const entryNames: string[] = [];
  let removed = false;

  const nextConfig = original.replace(entryPattern, (line, _indent, rawName, entryPath) => {
    const cleanName = String(rawName).replace(/^['"]|['"]$/g, '');
    const htmlPath = path.resolve(frontendDir, entryPath);
    if (!fs.existsSync(htmlPath)) {
      removed = true;
      console.warn(`[Deploy] 前端入口不存在，临时跳过: ${cleanName} -> ${entryPath}`);
      return '';
    }
    entryNames.push(cleanName);
    return line;
  });

  if (!removed) return { configPath: null, entryNames: entryNames.length ? entryNames : defaultEntries };

  const configPath = path.join(frontendDir, '.ai-platform.vite.config.ts');
  fs.writeFileSync(configPath, nextConfig, 'utf-8');
  return { configPath, entryNames: entryNames.length ? entryNames : defaultEntries };
}

/**
 * 构建项目前端，产物由 Vite 写入 backend/src/main/resources/static。
 */
async function buildFrontendAssets(type: ProjectType): Promise<void> {
  const frontendDir = getFrontendDir(type);
  const backendDir = getBackendDir(type);
  const staticDir = path.join(backendDir, 'src', 'main', 'resources', 'static');

  if (!fs.existsSync(frontendDir)) {
    throw new Error(`项目 ${type} 的 frontend 目录不存在: ${frontendDir}。请在设置页注册该项目的源码路径。`);
  }
  if (!fs.existsSync(path.join(frontendDir, 'package.json'))) {
    throw new Error(`项目 ${type} 的 frontend 缺少 package.json: ${frontendDir}`);
  }
  if (!fs.existsSync(path.join(frontendDir, 'node_modules'))) {
    throw new Error(`项目 ${type} 的 frontend 尚未安装依赖: ${frontendDir}\\node_modules。请先在 frontend 目录执行 npm install。`);
  }

  console.log(`[Deploy] 构建前端静态资源 (${type})...`);
  const buildPlan = createFrontendBuildPlan(frontendDir);
  try {
    const args = buildPlan.configPath
      ? ['run', 'build-only', '--', '--config', buildPlan.configPath]
      : ['run', 'build-only'];
    await runCommand(findNpmCommand(), args, frontendDir, '前端构建', 50 * 1024 * 1024);
  } finally {
    if (buildPlan.configPath && fs.existsSync(buildPlan.configPath)) {
      fs.unlinkSync(buildPlan.configPath);
    }
  }

  const requiredFiles = buildPlan.entryNames.map((entryName) => path.join(staticDir, entryName, 'index.html'));
  const missing = requiredFiles.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    throw new Error(`前端构建完成但缺少静态入口文件: ${missing.join(', ')}`);
  }
}

/**
 * 构建 WAR。平台先清理/隔离 target，再执行 package，避免 Maven clean 因 Windows 文件占用直接失败。
 */
async function mvnPackage(type: ProjectType): Promise<void> {
  const backendDir = getBackendDir(type);

  if (!fs.existsSync(backendDir)) {
    throw new Error(`项目 ${type} 的 backend 目录不存在: ${backendDir}。请在设置页注册该项目的源码路径。`);
  }

  const mavenCommand = findMavenCommand(backendDir);
  const command = mavenCommand;
  await releaseWindowsBuildResources(backendDir);
  prepareBuildWorkspace(backendDir);

  try {
    const commandArgs = createMavenCommandArgs(backendDir, ['clean', 'package', '-DskipTests']);
    try {
      await runMaven(command, commandArgs.args, backendDir, 'clean 构建');
    } finally {
      if (commandArgs.cleanupPath && fs.existsSync(commandArgs.cleanupPath)) {
        fs.unlinkSync(commandArgs.cleanupPath);
      }
    }
  } catch (error) {
    if (!isMavenCleanDeleteFailure(error as Error)) throw error;
    throw new Error(`Maven clean 删除 target 文件失败，可能仍有 Java/Tomcat/IDE 占用 ${path.join(backendDir, 'target')}。已尝试释放相关 Java 进程，请关闭占用后重试。原始错误: ${(error as Error).message}`);
  }
}

/**
 * 清理已从源码中删除、但可能残留在 target 中的历史 class。
 * 仅 agent 有此需求（ai/agent 包迁移留下的孤儿 class）。
 */
function cleanupStaleClasses(type: ProjectType): void {
  if (type !== 'agent') return; // knowledge-center 无此历史包袱
  const backendDir = getBackendDir(type);
  const sourceRoot = path.join(backendDir, 'src', 'main', 'java');
  const targetRoots = [
    path.join(backendDir, 'target', 'classes', 'cn', 'topspeeder', 'ai', 'agent'),
    path.join(backendDir, 'target', 'agent-1.0', 'WEB-INF', 'classes', 'cn', 'topspeeder', 'ai', 'agent'),
  ];

  for (const targetRoot of targetRoots) {
    if (!fs.existsSync(targetRoot)) continue;

    for (const classPath of walkFiles(targetRoot, '.class')) {
      if (!hasSourceForClass(classPath, targetRoot, sourceRoot)) {
        fs.unlinkSync(classPath);
        console.log(`[Deploy] 已清理历史 class: ${classPath}`);
      }
    }
  }
}

function cleanupWarEntries(zip: AdmZip): void {
  const backendDir = getBackendDir('agent');
  const sourceRoot = path.join(backendDir, 'src', 'main', 'java');
  const classPrefix = 'WEB-INF/classes/cn/topspeeder/ai/agent/';

  for (const entry of zip.getEntries()) {
    const entryName = entry.entryName;
    if (!entryName.startsWith(classPrefix) || !entryName.endsWith('.class')) continue;

    if (!hasSourceForWarEntry(entryName, classPrefix, sourceRoot)) {
      zip.deleteFile(entryName);
      console.log(`[Deploy] 已从 WAR 移除历史 class: ${entryName}`);
    }
  }
}

function walkFiles(dir: string, ext: string): string[] {
  const result: string[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      result.push(...walkFiles(fullPath, ext));
    } else if (item.isFile() && item.name.endsWith(ext)) {
      result.push(fullPath);
    }
  }
  return result;
}

function sourcePathForClass(relativeClassPath: string, sourceRoot: string): string {
  const withoutExt = relativeClassPath.replace(/\.class$/, '');
  const outerClass = withoutExt.replace(/\$.*$/, '');
  return path.join(sourceRoot, 'cn', 'topspeeder', 'ai', 'agent', `${outerClass}.java`);
}

function hasSourceForClass(classPath: string, classRoot: string, sourceRoot: string): boolean {
  const relativeClassPath = path.relative(classRoot, classPath);
  return fs.existsSync(sourcePathForClass(relativeClassPath, sourceRoot));
}

function hasSourceForWarEntry(entryName: string, classPrefix: string, sourceRoot: string): boolean {
  const relativeClassPath = entryName.slice(classPrefix.length).replace(/\//g, path.sep);
  return fs.existsSync(sourcePathForClass(relativeClassPath, sourceRoot));
}

/**
 * 生成项目专属 WAR 包（按 project 驱动）。
 * agent：替换 WAR 内配置文件；knowledge-center：仅构建 WAR（配置走外挂）。
 * 1. 前端构建 + Maven clean 构建
 * 2. 注入学校专属配置（仅 agent）
 * 3. 输出到 data/deploy/{schoolCode}-{projectCode}.war
 */
export async function buildProjectWar(code: string, projectCode: string): Promise<string> {
  const school = getSchool(code);
  if (!school) throw new Error(`School not found: ${code}`);
  const project = school.projects.find((p) => p.code === projectCode);
  if (!project) throw new Error(`Project not found: ${code}/${projectCode}`);

  // 1. 每次部署都先构建前端，再执行 Maven clean 构建，确保 WAR 内前后端都是最新。
  await buildFrontendAssets(project.type);
  console.log(`[Deploy] 执行 Maven clean 构建 (${project.type})...`);
  cleanupStaleClasses(project.type);
  await mvnPackage(project.type);

  const sourceWar = getSourceWarPath(project.type);
  if (!fs.existsSync(sourceWar)) {
    throw new Error(`Maven 构建完成但未找到 WAR: ${sourceWar}`);
  }

  const zip = new AdmZip(sourceWar);

  if (project.type === 'agent') {
    // agent：生成配置并替换 WAR 内文件
    cleanupWarEntries(zip);
    const configs = previewProjectConfigs(school, project);
    const warPathMap: Record<string, string> = {
      'application.yml': 'WEB-INF/classes/application.yml',
      'application-mysql.yml': 'WEB-INF/classes/config/application-mysql.yml',
      'application-dameng.yml': 'WEB-INF/classes/config/application-dameng.yml',
      'application-agent.yml': 'WEB-INF/classes/config/application-agent.yml',
      'application-security.yml': 'WEB-INF/classes/config/application-security.yml',
      'application-common.yml': 'WEB-INF/classes/config/application-common.yml',
    };

    for (const [configName, content] of Object.entries(configs)) {
      const warPath = warPathMap[configName];
      if (!warPath) continue;
      const buffer = Buffer.from(content, 'utf-8');
      if (zip.getEntry(warPath)) {
        zip.updateFile(warPath, buffer);
      } else {
        zip.addFile(warPath, buffer);
        console.warn(`[Deploy] WAR 中缺少配置文件，已新增: ${warPath}`);
      }
      console.log(`[Deploy] 已替换配置: ${configName} -> ${warPath}`);
    }
  }
  // knowledge-center：配置不进 WAR，由 buildProjectDeployPackage 作为外挂文件下发

  // 2. 输出
  const outputDir = getOutputDir();
  const outputPath = path.join(outputDir, `${code}-${projectCode}.war`);
  zip.writeZip(outputPath);

  return outputPath;
}

/**
 * 兼容旧调用：默认构建 agent project。
 */
export async function buildSchoolWar(code: string): Promise<string> {
  const school = getSchool(code);
  if (!school) throw new Error(`School not found: ${code}`);
  const agent = school.projects.find((p) => p.type === 'agent') || school.projects[0];
  if (!agent) throw new Error(`School ${code} 没有可部署的项目`);
  return buildProjectWar(code, agent.code);
}

/**
 * 生成完整部署包（ZIP 内含 WAR + 分阶段部署脚本 + 项目专属资源）。
 */
export async function buildProjectDeployPackage(
  code: string,
  projectCode: string,
  params: DeployScriptParams,
): Promise<string> {
  const school = getSchool(code);
  if (!school) throw new Error(`School not found: ${code}`);
  const project = school.projects.find((p) => p.code === projectCode);
  if (!project) throw new Error(`Project not found: ${code}/${projectCode}`);

  // 1. 生成 WAR
  const warPath = await buildProjectWar(code, projectCode);
  const warFileName = path.basename(warPath);

  // 2. 生成分阶段部署脚本（按 project.type 分发）
  const scripts = generateDeployScripts(school, project, params, warFileName);

  // 3. 打包成 ZIP
  const outputDir = getOutputDir();
  const zipPath = path.join(outputDir, `${code}-${projectCode}-deploy.zip`);
  const zip = new AdmZip();

  zip.addLocalFile(warPath, '', warFileName);

  // 项目专属资源
  if (project.type === 'agent') {
    const toolScriptZip = getToolScriptZipPath();
    if (toolScriptZip) {
      zip.addLocalFile(toolScriptZip, '', 'tool-script.zip');
    }
    for (const assetName of ['oneapi.tar', 'cache.zip']) {
      const assetPath = getDeployAssetPath(assetName);
      if (assetPath) {
        zip.addLocalFile(assetPath, '', assetName);
      }
    }
  } else if (project.type === 'knowledge-center') {
    // kc：外挂配置文件（覆盖后）+ Dockerfile
    const configs = previewProjectConfigs(school, project);
    for (const [name, content] of Object.entries(configs)) {
      zip.addFile(`config/${name}`, Buffer.from(content, 'utf-8'));
    }
    // 项目根的 Dockerfile（kc 需要它来 docker build）
    const dockerfilePath = path.join(getProjectSourceRoot('knowledge-center'), 'Dockerfile');
    if (fs.existsSync(dockerfilePath)) {
      zip.addLocalFile(dockerfilePath, '', 'Dockerfile');
    }
  }

  for (const [fileName, content] of Object.entries(scripts)) {
    zip.addFile(fileName, Buffer.from(content, 'utf-8'));
  }

  // 设置 shell 脚本可执行权限 (0o755)
  for (const fileName of Object.keys(scripts)) {
    const entry = zip.getEntry(fileName);
    if (entry) {
      entry.attr = 0o755;
    }
  }

  zip.writeZip(zipPath);

  return zipPath;
}

/**
 * 兼容旧调用：默认构建 agent project 的完整部署包。
 */
export async function buildSchoolDeployPackage(
  code: string,
  params: DeployScriptParams,
): Promise<string> {
  const school = getSchool(code);
  if (!school) throw new Error(`School not found: ${code}`);
  const agent = school.projects.find((p) => p.type === 'agent') || school.projects[0];
  if (!agent) throw new Error(`School ${code} 没有可部署的项目`);
  return buildProjectDeployPackage(code, agent.code, params);
}
