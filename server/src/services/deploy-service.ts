/**
 * 部署服务：将学校配置注入 WAR 包
 * 优先使用 target/ 下已构建的 WAR，不存在时自动执行 mvn package
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import AdmZip from 'adm-zip';
import { getConfig } from './config.js';
import { getSchool } from './school-manager.js';
import { previewConfigs } from './config-generator.js';

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

/**
 * 执行 mvn package -DskipTests
 */
function mvnPackage(): Promise<void> {
  const backendDir = getBackendDir();
  const cmd = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  const args = ['package', '-DskipTests'];

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
 * 生成学校专属 WAR 包
 * 1. 检查已有 WAR，没有则自动 mvn package
 * 2. 替换 WAR 中的配置文件
 * 3. 输出到 data/deploy/{code}.war
 */
export async function buildSchoolWar(code: string): Promise<string> {
  const school = getSchool(code);
  if (!school) throw new Error(`School not found: ${code}`);

  // 1. 每次部署都执行 Maven 构建，确保代码最新
  console.log('[Deploy] 执行 Maven 构建...');
  await mvnPackage();

  const sourceWar = getSourceWarPath();
  if (!fs.existsSync(sourceWar)) {
    throw new Error(`Maven 构建完成但未找到 WAR: ${sourceWar}`);
  }

  // 2. 生成学校专属配置
  const configs = previewConfigs(code);

  // 3. 替换 WAR 内配置文件
  const zip = new AdmZip(sourceWar);

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
