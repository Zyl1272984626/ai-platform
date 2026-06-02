/**
 * 部署服务：将学校配置注入 WAR 包
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import AdmZip from 'adm-zip';
import { getConfig } from './config.js';
import { getSchool } from './school-manager.js';
import { previewConfigs } from './config-generator.js';
import { generateDeployScripts, type DeployScriptParams } from './deploy-script-generator.js';

/** 获取主系统 backend 目录 */
function getBackendDir(): string {
  return path.resolve(getConfig().projectRoot, 'backend');
}

/** 获取主系统 WAR 路径 */
function getSourceWarPath(): string {
  return path.resolve(getConfig().projectRoot, 'backend', 'target', 'agent-1.0.war');
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

/**
 * 执行 mvn clean package -DskipTests
 */
function mvnPackage(): Promise<void> {
  const backendDir = getBackendDir();
  const cmd = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  const args = ['clean', 'package', '-DskipTests'];

  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      cwd: backendDir,
      maxBuffer: 10 * 1024 * 1024,
      shell: true,
      env: { ...process.env },
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr?.toString().trim() || stdout?.toString().trim() || error.message).slice(-500);
        reject(new Error(`Maven 构建失败: ${detail}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * 清理已从源码中删除、但可能残留在 target 中的历史 class。
 * 重点处理 ai/agent 包迁移后的孤儿 class，避免 Spring 扫描到旧 Bean。
 */
function cleanupStaleClasses(): void {
  const backendDir = getBackendDir();
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
  const backendDir = getBackendDir();
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
 * 生成学校专属 WAR 包
 * 1. 检查已有 WAR，没有则自动 mvn package
 * 2. 替换 WAR 中的配置文件
 * 3. 输出到 data/deploy/{code}.war
 */
export async function buildSchoolWar(code: string): Promise<string> {
  const school = getSchool(code);
  if (!school) throw new Error(`School not found: ${code}`);

  // 1. 每次部署都执行 Maven 构建，确保代码最新
  console.log('[Deploy] 执行 Maven clean 构建...');
  cleanupStaleClasses();
  await mvnPackage();

  const sourceWar = getSourceWarPath();
  if (!fs.existsSync(sourceWar)) {
    throw new Error(`Maven 构建完成但未找到 WAR: ${sourceWar}`);
  }

  // 2. 生成学校专属配置
  const configs = previewConfigs(code);

  // 3. 替换 WAR 内配置文件
  const zip = new AdmZip(sourceWar);
  cleanupWarEntries(zip);

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
    zip.updateFile(warPath, Buffer.from(content, 'utf-8'));
  }

  // 4. 输出
  const outputDir = getOutputDir();
  const outputPath = path.join(outputDir, `${code}.war`);
  zip.writeZip(outputPath);

  return outputPath;
}

/**
 * 生成完整部署包（ZIP 内含 WAR + 分阶段部署脚本）
 */
export async function buildSchoolDeployPackage(
  code: string,
  params: DeployScriptParams,
): Promise<string> {
  const school = getSchool(code);
  if (!school) throw new Error(`School not found: ${code}`);

  // 1. 生成 WAR
  const warPath = await buildSchoolWar(code);
  const warFileName = path.basename(warPath);

  // 2. 生成分阶段部署脚本
  const scripts = generateDeployScripts(school, params, warFileName);

  // 3. 打包成 ZIP
  const outputDir = getOutputDir();
  const zipPath = path.join(outputDir, `${code}-deploy.zip`);

  const zip = new AdmZip();
  zip.addLocalFile(warPath, '', warFileName);

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
