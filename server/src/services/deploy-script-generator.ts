/**
 * 部署脚本生成器。
 *
 * 部署包按执行时机拆分：
 * - 01-db-create.sh：数据库服务器执行，应用启动前，只负责建库。
 * - 02-app-deploy.sh：应用服务器执行，负责目录和 OneApi 容器准备。
 * - 03-system-config.sh：数据库服务器执行，应用首次启动并自动建表后，填充系统配置。
 */
import type { School } from './school-manager.js';

export interface DeployScriptParams {
  deployHost: string;
  deployUser: string;
  dbRootPassword: string;
  mysqlContainer?: string;
  oneapiHost: string;
  oneapiPort: number;
  oneapiKey: string;
  knowledgeBaseUrl?: string;
  knowledgeAppId?: string;
  knowledgeApiKey?: string;
  voiceApiUrl?: string;
  chatModel?: string;
  createAgentDatabases?: boolean;
  createOneapiDatabase?: boolean;
  oneapiDatabase?: string;
  /** @deprecated use createAgentDatabases instead */
  createDatabase?: boolean;
  deployOneapi?: boolean;
  initSql?: boolean;
}

export type DeployScripts = Record<string, string>;

const MYSQL_CHARSET = 'utf8mb4';
const MYSQL_COLLATION = 'utf8mb4_0900_as_cs';

function getServerOs(school: School): 'linux' | 'windows' {
  const serverOs = school.deployConfig?.serverOs || school.common?.serverOs;
  return serverOs === 'windows' ? 'windows' : 'linux';
}

function getWindowsDrive(school: School): string {
  const raw = school.deployConfig?.windowsDrive || school.common?.windowsDrive || 'D:';
  const normalized = raw.trim().replace(/\\+$/, '');
  return /^[A-Za-z]:$/.test(normalized) ? normalized : 'D:';
}

function getWindowsAgentRoot(school: School): string {
  return `${getWindowsDrive(school)}\\fskj\\workspace\\agent`;
}

function getAgentRootPath(school: School): string {
  return getServerOs(school) === 'windows' ? getWindowsAgentRoot(school) : '/fskj/workspace/agent';
}

function joinAgentPath(school: School, child: string): string {
  const root = getAgentRootPath(school);
  const separator = getServerOs(school) === 'windows' ? '\\' : '/';
  return `${root}${separator}${child}`;
}

function shellHeader(title: string, school: School): string[] {
  return [
    '#!/bin/bash',
    'set -e',
    '',
    `# ${title} - ${school.name} (${school.code})`,
    `# 生成时间: ${new Date().toISOString()}`,
    '',
    'echo "========================================"',
    `echo " ${title}: ${school.name}"`,
    'echo "========================================"',
    '',
  ];
}

function quoteSql(value: string | number | undefined): string {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "''");
}

function quoteShell(value: string | number | undefined): string {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

function normalizeHttpUrl(hostOrUrl: string | undefined, port?: number): string {
  const raw = String(hostOrUrl || '').trim();
  if (!raw) return port ? `http://127.0.0.1:${port}/` : 'http://127.0.0.1/';

  if (/^https?:\/\//i.test(raw)) {
    const withSlash = raw.endsWith('/') ? raw : `${raw}/`;
    if (!port) return withSlash;

    try {
      const url = new URL(withSlash);
      if (!url.port) url.port = String(port);
      return url.toString();
    } catch {
      return withSlash;
    }
  }

  return `http://${raw}${port ? `:${port}` : ''}/`;
}

function storageParamsSql(basePath: string): string {
  return quoteSql(JSON.stringify({ basePath }));
}

function mysqlRuntimeBlock(params: DeployScriptParams): string[] {
  const mysqlContainer = params.mysqlContainer || '';
  return [
    `DB_ROOT_PASSWORD='${params.dbRootPassword}'`,
    `MYSQL_CONTAINER="\${MYSQL_CONTAINER:-${mysqlContainer}}"`,
    '',
    'mysql_exec() {',
    '  if [ -z "${MYSQL_CONTAINER}" ] && command -v mysql >/dev/null 2>&1; then',
    '    mysql -uroot -p"${DB_ROOT_PASSWORD}" "$@"',
    '    return',
    '  fi',
    '',
    '  if [ -n "${MYSQL_CONTAINER}" ] && command -v docker >/dev/null 2>&1 && docker ps --format \'{{.Names}}\' | grep -q "^${MYSQL_CONTAINER}$"; then',
    '    docker exec -i "${MYSQL_CONTAINER}" mysql -uroot -p"${DB_ROOT_PASSWORD}" "$@"',
    '    return',
    '  fi',
    '',
    '  if [ -n "${MYSQL_CONTAINER}" ]; then',
    '    echo "未找到 MySQL Docker 容器: ${MYSQL_CONTAINER}" >&2',
    '    echo "请确认容器名，或清空 MYSQL_CONTAINER 后使用宿主机 mysql 客户端执行。" >&2',
    '  else',
    '    echo "未找到宿主机 mysql 命令。" >&2',
    '    echo "请安装 mysql 客户端，或用 MYSQL_CONTAINER=实际容器名 bash $0 在 Docker 容器中执行。" >&2',
    '  fi',
    '  exit 1',
    '}',
    '',
  ];
}

function mysqlSystemRuntimeBlock(school: School, params: DeployScriptParams): string[] {
  const mysqlContainer = params.mysqlContainer || '';
  return [
    `DB_HOST=${quoteShell(school.dbHost || '127.0.0.1')}`,
    `DB_PORT=${quoteShell(school.dbPort || 3306)}`,
    `DB_NAME=${quoteShell(school.database)}`,
    `DB_USER=${quoteShell(school.dbUser || '')}`,
    `DB_PASSWORD=${quoteShell(school.dbPassword || '')}`,
    `MYSQL_CONTAINER="\${MYSQL_CONTAINER:-${mysqlContainer}}"`,
    '',
    'mysql_exec() {',
    '  if [ -n "${MYSQL_CONTAINER}" ] && command -v docker >/dev/null 2>&1 && docker ps --format \'{{.Names}}\' | grep -q "^${MYSQL_CONTAINER}$"; then',
    '    docker exec -i "${MYSQL_CONTAINER}" mysql -u"${DB_USER}" -p"${DB_PASSWORD}" "$@"',
    '    return',
    '  fi',
    '',
    '  if [ -z "${MYSQL_CONTAINER}" ] && command -v mysql >/dev/null 2>&1; then',
    '    mysql -h"${DB_HOST}" -P"${DB_PORT}" -u"${DB_USER}" -p"${DB_PASSWORD}" "$@"',
    '    return',
    '  fi',
    '',
    '  if [ -n "${MYSQL_CONTAINER}" ]; then',
    '    echo "未找到 MySQL Docker 容器: ${MYSQL_CONTAINER}" >&2',
    '    echo "请确认容器名，或清空 MYSQL_CONTAINER 后使用宿主机 mysql 客户端执行。" >&2',
    '  else',
    '    echo "未找到宿主机 mysql 命令。" >&2',
    '    echo "请安装 mysql 客户端，或配置 MYSQL_CONTAINER=实际容器名 后执行。" >&2',
    '  fi',
    '  exit 1',
    '}',
    '',
  ];
}

function generateDbCreateScript(school: School, params: DeployScriptParams): string {
  const lines = shellHeader('01 数据库创建', school);
  const isMysql = school.type === 'mysql';
  const bt = '`';
  const createAgentDatabases = params.createAgentDatabases ?? params.createDatabase;
  const createOneapiDatabase = params.createOneapiDatabase ?? false;
  const oneapiDatabase = params.oneapiDatabase || 'oneapi';

  if (isMysql) {
    lines.push(...mysqlRuntimeBlock(params));
  }

  if (!createAgentDatabases && !createOneapiDatabase) {
    lines.push('echo "未选择数据库创建步骤，跳过。"', '');
  }

  if (createAgentDatabases) {
    lines.push('# ---- 创建 Agent 主库和业务库 ----', 'echo "创建 Agent 主库和业务库..."');
    if (isMysql) {
      lines.push(
        `mysql_exec -e 'CREATE DATABASE IF NOT EXISTS ${bt}${school.database}${bt} CHARACTER SET ${MYSQL_CHARSET} COLLATE ${MYSQL_COLLATION};'`,
        `mysql_exec -e 'CREATE DATABASE IF NOT EXISTS ${bt}${school.database}_business${bt} CHARACTER SET ${MYSQL_CHARSET} COLLATE ${MYSQL_COLLATION};'`,
      );
    } else {
      lines.push(`echo "达梦数据库，请手动创建: ${school.database} 和 ${school.database}_business"`);
    }
    lines.push('');
  }

  if (createOneapiDatabase) {
    lines.push('# ---- 创建 OneApi 数据库 ----', 'echo "创建 OneApi 数据库..."');
    if (isMysql) {
      lines.push(
        `mysql_exec -e 'CREATE DATABASE IF NOT EXISTS ${bt}${oneapiDatabase}${bt} CHARACTER SET ${MYSQL_CHARSET} COLLATE ${MYSQL_COLLATION};'`,
      );
    } else {
      lines.push(`echo "达梦环境下 OneApi 仍建议使用 MySQL，请手动创建 MySQL 数据库: ${oneapiDatabase}"`);
    }
    lines.push('');
  }

  lines.push('echo "数据库创建脚本执行完成。"', '');
  return lines.join('\n');
}

function generateAppDeployScript(school: School, params: DeployScriptParams, warFileName: string): string {
  const lines = shellHeader('02 应用部署', school);
  const oneapiDatabase = params.oneapiDatabase || 'oneapi';
  const mysqlHost = school.dbHost || params.oneapiHost;
  const mysqlPort = school.dbPort || 3306;

  lines.push(
    '# ---- 1.2 应用服务器目录和企微工具 ----',
    'echo "准备应用目录和企微工具..."',
    'mkdir -p /fskj/workspace/agent/',
    'mkdir -p /fskj/workspace/agent/logs/',
    'mkdir -p /fskj/workspace/agent/agent/',
    'mkdir -p /fskj/workspace/agent/agent-conversation/',
    'mkdir -p /fskj/workspace/agent/component/',
    'mkdir -p /fskj/workspace/agent/sandbox/',
    'mkdir -p /fskj/workspace/agent/skill-storage/',
    '',
    'if [ -f "./tool-script.zip" ]; then',
    '  echo "  解压外挂 tool-script.zip"',
    '  TOOL_SCRIPT_TMP="/tmp/tool-script-${RANDOM}-$$"',
    '  rm -rf "${TOOL_SCRIPT_TMP}"',
    '  mkdir -p "${TOOL_SCRIPT_TMP}"',
    '  rm -rf /fskj/workspace/agent/tool-script',
    '  if command -v unzip >/dev/null 2>&1; then',
    '    unzip -q -o ./tool-script.zip -d "${TOOL_SCRIPT_TMP}"',
    '  else',
    '    echo "  未找到 unzip 命令，请先安装 unzip 后重新执行，或手动解压 tool-script.zip。" >&2',
    '    exit 1',
    '  fi',
    '  if [ -d "${TOOL_SCRIPT_TMP}/tool-script" ]; then',
    '    mv "${TOOL_SCRIPT_TMP}/tool-script" /fskj/workspace/agent/tool-script',
    '  else',
    '    mkdir -p /fskj/workspace/agent/tool-script',
    '    cp -a "${TOOL_SCRIPT_TMP}/." /fskj/workspace/agent/tool-script/',
    '  fi',
    '  rm -rf "${TOOL_SCRIPT_TMP}"',
    '  echo "  tool-script 已安装到 /fskj/workspace/agent/tool-script"',
    'elif [ -d "/fskj/workspace/agent/tool-script" ]; then',
    '  echo "  已存在 /fskj/workspace/agent/tool-script，跳过解压"',
    'else',
    '  echo "  未随包提供 tool-script.zip，请按文档手动上传并解压到 /fskj/workspace/agent/tool-script"',
    'fi',
    '',
  );

  if (params.deployOneapi) {
    lines.push(
      '# ---- 部署 OneApi Docker 容器 ----',
      'echo "检查 OneApi 服务..."',
      `ONEAPI_CONTAINER="oneapi-${school.code}"`,
      `ONEAPI_DATA_DIR="/fskj/workspace/oneapi-${school.code}"`,
      'mkdir -p "${ONEAPI_DATA_DIR}/tiktoken"',
      '',
      'if ! command -v docker >/dev/null 2>&1; then',
      '  echo "未找到 docker 命令，无法部署 OneApi。" >&2',
      '  exit 1',
      'fi',
      '',
      'if ! docker image inspect oneapi:latest >/dev/null 2>&1; then',
      '  if [ -f "./oneapi.tar" ]; then',
      '    echo "  导入 oneapi.tar..."',
      '    LOAD_OUTPUT=$(docker load -i ./oneapi.tar)',
      '    echo "${LOAD_OUTPUT}"',
      '    LOADED_IMAGE=$(printf "%s\\n" "${LOAD_OUTPUT}" | sed -n "s/^Loaded image: //p" | tail -n 1)',
      '    if [ -n "${LOADED_IMAGE}" ] && [ "${LOADED_IMAGE}" != "oneapi:latest" ]; then',
      '      docker tag "${LOADED_IMAGE}" oneapi:latest',
      '    fi',
      '    if ! docker image inspect oneapi:latest >/dev/null 2>&1; then',
      '      echo "docker load 后仍未找到 oneapi:latest，请手动执行 docker images 查看镜像名并 tag 为 oneapi:latest。" >&2',
      '      exit 1',
      '    fi',
      '  else',
      '    echo "未找到 oneapi:latest 镜像，也未随包提供 oneapi.tar。" >&2',
      '    echo "请将 oneapi.tar 放在部署包同目录，或先手动 docker load/tag 为 oneapi:latest。" >&2',
      '    exit 1',
      '  fi',
      'fi',
      '',
      'if [ -f "./cache.zip" ]; then',
      '  if command -v unzip >/dev/null 2>&1; then',
      '    echo "  解压 tiktoken cache.zip..."',
      '    unzip -q -o ./cache.zip -d "${ONEAPI_DATA_DIR}/tiktoken"',
      '  else',
      '    echo "  未找到 unzip 命令，跳过 cache.zip 解压，请手动放入 ${ONEAPI_DATA_DIR}/tiktoken。" >&2',
      '  fi',
      'fi',
      '',
      'if docker ps -a --format \'{{.Names}}\' | grep -q "^${ONEAPI_CONTAINER}$"; then',
      '  echo "  OneApi 容器已存在，跳过创建"',
      'else',
      '  echo "  创建 OneApi 容器..."',
      '  docker run -d --name ${ONEAPI_CONTAINER} \\',
      `    -p ${params.oneapiPort}:3000 \\`,
      `    -e SQL_DSN="root:${params.dbRootPassword}@tcp(${mysqlHost}:${mysqlPort})/${oneapiDatabase}" \\`,
      '    -e SESSION_SECRET="SESSION_SECRETSESSION_SECRETSESSION_SECRET" \\',
      '    -e NODE_TYPE="master" \\',
      '    -e SYNC_FREQUENCY=600 \\',
      '    -e TZ=Asia/Shanghai \\',
      '    -e TIKTOKEN_CACHE_DIR=/data/tiktoken \\',
      '    -v "${ONEAPI_DATA_DIR}:/data" \\',
      '    --restart always \\',
      '    oneapi:latest',
      '  echo "  等待 OneApi 启动..."',
      '  sleep 5',
      'fi',
      '',
    );
  }

  lines.push(
    '# ---- WAR 部署提示 ----',
    `echo "已生成 WAR 文件: ${warFileName}"`,
    'echo "本脚本不自动复制、覆盖或启动 WAR。"',
    'echo "请按现场发布流程将 WAR 放到 Tomcat webapps 或指定发布目录，并启动应用。"',
    '',
    'echo "应用服务器准备脚本执行完成。"',
    `echo "应用启动后访问地址: http://${params.deployHost}:${school.port}"`,
    'echo "首次部署请确认应用启动成功并自动建表完成后，再执行 03-system-config.sh。"',
    '',
  );

  return lines.join('\n');
}

function generateWindowsAppDeployScript(school: School, params: DeployScriptParams, warFileName: string): string {
  const agentRoot = getWindowsAgentRoot(school);
  const logsDir = `${agentRoot}\\logs`;
  const oneapiDatabase = params.oneapiDatabase || 'oneapi';
  const mysqlHost = school.dbHost || params.oneapiHost;
  const mysqlPort = school.dbPort || 3306;
  const lines = [
    '$ErrorActionPreference = "Stop"',
    '',
    `# 02 应用部署 - ${school.name} (${school.code})`,
    `# 生成时间: ${new Date().toISOString()}`,
    '',
    'Write-Host "========================================"',
    `Write-Host " 02 应用部署: ${school.name}"`,
    'Write-Host "========================================"',
    '',
    '# ---- 1.2 应用服务器目录和企微工具 ----',
    'Write-Host "准备应用目录和企微工具..."',
    `$AgentRoot = "${agentRoot}"`,
    '$Dirs = @(',
    '  $AgentRoot,',
    '  (Join-Path $AgentRoot "logs"),',
    '  (Join-Path $AgentRoot "agent"),',
    '  (Join-Path $AgentRoot "agent-conversation"),',
    '  (Join-Path $AgentRoot "component"),',
    '  (Join-Path $AgentRoot "sandbox"),',
    '  (Join-Path $AgentRoot "skill-storage")',
    ')',
    'foreach ($Dir in $Dirs) {',
    '  New-Item -ItemType Directory -Force -Path $Dir | Out-Null',
    '}',
    '',
    '$ToolZip = Join-Path (Get-Location) "tool-script.zip"',
    '$ToolTarget = Join-Path $AgentRoot "tool-script"',
    'if (Test-Path $ToolZip) {',
    '  Write-Host "  解压外挂 tool-script.zip"',
    '  $ToolTmp = Join-Path $env:TEMP ("tool-script-" + [Guid]::NewGuid().ToString("N"))',
    '  Remove-Item -Recurse -Force -Path $ToolTmp -ErrorAction SilentlyContinue',
    '  New-Item -ItemType Directory -Force -Path $ToolTmp | Out-Null',
    '  Remove-Item -Recurse -Force -Path $ToolTarget -ErrorAction SilentlyContinue',
    '  Expand-Archive -Path $ToolZip -DestinationPath $ToolTmp -Force',
    '  $NestedTool = Join-Path $ToolTmp "tool-script"',
    '  if (Test-Path $NestedTool) {',
    '    Move-Item -Path $NestedTool -Destination $ToolTarget -Force',
    '  } else {',
    '    New-Item -ItemType Directory -Force -Path $ToolTarget | Out-Null',
    '    Copy-Item -Recurse -Force -Path (Join-Path $ToolTmp "*") -Destination $ToolTarget',
    '  }',
    '  Remove-Item -Recurse -Force -Path $ToolTmp -ErrorAction SilentlyContinue',
    '  Write-Host "  tool-script 已安装到 $ToolTarget"',
    '} elseif (Test-Path $ToolTarget) {',
    '  Write-Host "  已存在 $ToolTarget，跳过解压"',
    '} else {',
    '  Write-Host "  未随包提供 tool-script.zip，请按文档手动上传并解压到 $ToolTarget"',
    '}',
    '',
  ];

  if (params.deployOneapi) {
    lines.push(
      '# ---- 部署 OneApi Docker 容器 ----',
      'Write-Host "检查 OneApi 服务..."',
      `$OneApiContainer = "oneapi-${school.code}"`,
      `$OneApiDataDir = "${agentRoot}\\oneapi-${school.code}"`,
      'New-Item -ItemType Directory -Force -Path (Join-Path $OneApiDataDir "tiktoken") | Out-Null',
      '',
      'docker version | Out-Null',
      '$ImageExists = $true',
      'docker image inspect oneapi:latest *> $null',
      'if ($LASTEXITCODE -ne 0) { $ImageExists = $false }',
      'if (-not $ImageExists) {',
      '  $OneApiTar = Join-Path (Get-Location) "oneapi.tar"',
      '  if (Test-Path $OneApiTar) {',
      '    Write-Host "  导入 oneapi.tar..."',
      '    $LoadOutput = docker load -i $OneApiTar',
      '    $LoadOutput | ForEach-Object { Write-Host $_ }',
      '    $ImageMatch = $LoadOutput | Select-String -Pattern "^Loaded image: (.+)$" | Select-Object -Last 1',
      '    $LoadedImage = if ($ImageMatch) { $ImageMatch.Matches.Groups[1].Value } else { "" }',
      '    if ($LoadedImage -and $LoadedImage -ne "oneapi:latest") {',
      '      docker tag $LoadedImage oneapi:latest',
      '    }',
      '    docker image inspect oneapi:latest *> $null',
      '    if ($LASTEXITCODE -ne 0) {',
      '      throw "docker load 后仍未找到 oneapi:latest，请手动执行 docker images 查看镜像名并 tag 为 oneapi:latest。"',
      '    }',
      '  } else {',
      '    throw "未找到 oneapi:latest 镜像，也未随包提供 oneapi.tar。请将 oneapi.tar 放在部署包同目录，或先手动 docker load/tag 为 oneapi:latest。"',
      '  }',
      '}',
      '',
      '$CacheZip = Join-Path (Get-Location) "cache.zip"',
      'if (Test-Path $CacheZip) {',
      '  Write-Host "  解压 tiktoken cache.zip..."',
      '  Expand-Archive -Path $CacheZip -DestinationPath (Join-Path $OneApiDataDir "tiktoken") -Force',
      '}',
      '',
      '$ExistingContainer = docker ps -a --format "{{.Names}}" | Select-String -Pattern ("^" + [regex]::Escape($OneApiContainer) + "$")',
      'if ($ExistingContainer) {',
      '  Write-Host "  OneApi 容器已存在，跳过创建"',
      '} else {',
      '  Write-Host "  创建 OneApi 容器..."',
      '  docker run -d --name $OneApiContainer `',
      `    -p ${params.oneapiPort}:3000 \``,
      `    -e "SQL_DSN=root:${params.dbRootPassword}@tcp(${mysqlHost}:${mysqlPort})/${oneapiDatabase}" \``,
      '    -e "SESSION_SECRET=SESSION_SECRETSESSION_SECRETSESSION_SECRET" `',
      '    -e "NODE_TYPE=master" `',
      '    -e "SYNC_FREQUENCY=600" `',
      '    -e "TZ=Asia/Shanghai" `',
      '    -e "TIKTOKEN_CACHE_DIR=/data/tiktoken" `',
      '    -v "${OneApiDataDir}:/data" `',
      '    --restart always `',
      '    oneapi:latest',
      '  Start-Sleep -Seconds 5',
      '}',
      '',
    );
  }

  lines.push(
    '# ---- WAR 部署提示 ----',
    `Write-Host "已生成 WAR 文件: ${warFileName}"`,
    'Write-Host "本脚本不自动复制、覆盖或启动 WAR。"',
    'Write-Host "请按现场发布流程将 WAR 放到 Tomcat webapps 或指定发布目录，并启动应用。"',
    '',
    'Write-Host "应用服务器准备脚本执行完成。"',
    `Write-Host "应用启动后访问地址: http://${params.deployHost}:${school.port}"`,
    'Write-Host "首次部署请确认应用启动成功并自动建表完成后，再执行 03-system-config.sh。"',
    '',
  );

  return lines.join('\r\n');
}

function generateSystemConfigScript(school: School, params: DeployScriptParams): string {
  const lines = shellHeader('03 启动后系统配置', school);
  const isMysql = school.type === 'mysql';
  const oneapiUrl = normalizeHttpUrl(params.oneapiHost, params.oneapiPort);
  const chatModel = params.chatModel || 'deepseek-v4-flash';
  const fileStorages = [
    {
      id: 'ICON_STORAGE_JYT',
      code: 'ICON_STORAGE_JYT',
      name: '文件仓库',
      order: 1,
      basePath: joinAgentPath(school, 'agent'),
      remark: '文件仓库',
    },
    {
      id: 'CHAT_MSG_UPLOAD_FILE',
      code: 'CHAT_MSG_UPLOAD_FILE',
      name: '智能体对话文件上传',
      order: 2,
      basePath: joinAgentPath(school, 'agent-conversation'),
      remark: '智能体对话文件上传',
    },
    {
      id: 'COMP_UPLOAD_FILE',
      code: 'COMP_UPLOAD_FILE',
      name: '组件文件上传',
      order: 3,
      basePath: joinAgentPath(school, 'component'),
      remark: '组件文件上传',
    },
    {
      id: 'SKILL_STORAGE',
      code: 'skill_storage',
      name: '技能仓库',
      order: 4,
      basePath: joinAgentPath(school, 'skill-storage'),
      remark: '技能文件存储仓库',
    },
  ];

  if (!params.initSql) {
    lines.push('echo "未选择启动后系统配置步骤，跳过。"', '');
    return lines.join('\n');
  }

  if (!isMysql) {
    lines.push('echo "达梦数据库暂未生成自动系统配置 SQL，请在应用启动建表后手动初始化配置。"', '');
    return lines.join('\n');
  }

  lines.push(
    ...mysqlSystemRuntimeBlock(school, params),
    'wait_for_table() {',
    '  local table_name="$1"',
    '  local max_attempts=60',
    '  local attempt=1',
    '  while [ "$attempt" -le "$max_attempts" ]; do',
    '    if mysql_exec "${DB_NAME}" -N -e "SHOW TABLES LIKE \'$table_name\';" | grep -q "$table_name"; then',
    '      return 0',
    '    fi',
    '    echo "等待表 $table_name 创建完成... ($attempt/$max_attempts)"',
    '    sleep 5',
    '    attempt=$((attempt + 1))',
    '  done',
    '  echo "等待表 $table_name 超时，请确认应用是否已成功启动并完成自动建表。" >&2',
    '  exit 1',
    '}',
    '',
    'wait_for_table fs_sys_config',
    'wait_for_table ai_model_source',
    'wait_for_table ai_file_storage',
    '',
    '# ---- 初始化系统配置 ----',
    'echo "初始化系统配置..."',
    'mysql_exec "${DB_NAME}" <<\'EOSQL\'',
    `UPDATE fs_sys_config SET value_x = '${quoteSql(chatModel)}' WHERE code_x = 'CHAT_MODEL';`,
    `UPDATE fs_sys_config SET value_x = '${quoteSql(oneapiUrl)}' WHERE code_x = 'CHAT_MODEL_URL';`,
    `UPDATE fs_sys_config SET value_x = '${quoteSql(params.oneapiKey)}' WHERE code_x = 'CHAT_MODEL_KEY';`,
  );

  if (params.knowledgeBaseUrl) {
    lines.push(`UPDATE fs_sys_config SET value_x = '${quoteSql(params.knowledgeBaseUrl)}' WHERE code_x = 'KNOWLEDGE_CENTER_BASE_URL';`);
  }
  if (params.knowledgeAppId) {
    lines.push(`UPDATE fs_sys_config SET value_x = '${quoteSql(params.knowledgeAppId)}' WHERE code_x = 'KNOWLEDGE_CENTER_APP_ID';`);
  }
  if (params.knowledgeApiKey) {
    lines.push(`UPDATE fs_sys_config SET value_x = '${quoteSql(params.knowledgeApiKey)}' WHERE code_x = 'KNOWLEDGE_CENTER_API_KEY';`);
  }
  if (params.voiceApiUrl) {
    lines.push(`UPDATE fs_sys_config SET value_x = '${quoteSql(params.voiceApiUrl)}' WHERE code_x = 'VOICE_API_URL';`);
  }

  lines.push(
    '',
    'DELETE FROM ai_model_source WHERE id <> \'source_oneapi\' AND model_source_code = \'OneApi\';',
    'INSERT INTO ai_model_source (id, create_time, create_user_id, model_source_code, name_x, order_x, params_config, remark_x, update_time, update_user_id)',
    `VALUES ('source_oneapi', NOW(), 'fskjadmin', 'OneApi', 'OneApi', 1, '{\\"url\\":\\"${quoteSql(oneapiUrl)}\\",\\"appKey\\":\\"${quoteSql(params.oneapiKey)}\\"}', '公司内部部署的 OneApi', NOW(), 'fskjadmin')`,
    'ON DUPLICATE KEY UPDATE',
    '  model_source_code = VALUES(model_source_code),',
    '  name_x = VALUES(name_x),',
    '  order_x = VALUES(order_x),',
    '  params_config = VALUES(params_config),',
    '  remark_x = VALUES(remark_x),',
    '  update_time = NOW(),',
    '  update_user_id = VALUES(update_user_id);',
  );

  lines.push('', '-- 初始化文件仓库配置，basePath 与 02-app-deploy 创建的目录保持一致');
  for (const storage of fileStorages) {
    lines.push(
      'INSERT INTO ai_file_storage (id, code_x, name_x, order_x, params_config, remark_x, create_user_id, create_time, update_user_id, update_time)',
      `VALUES ('${quoteSql(storage.id)}', '${quoteSql(storage.code)}', '${quoteSql(storage.name)}', ${storage.order}, '${storageParamsSql(storage.basePath)}', '${quoteSql(storage.remark)}', 'system', NOW(), 'system', NOW())`,
      'ON DUPLICATE KEY UPDATE',
      '  code_x = VALUES(code_x),',
      '  name_x = VALUES(name_x),',
      '  order_x = VALUES(order_x),',
      '  params_config = VALUES(params_config),',
      '  remark_x = VALUES(remark_x),',
      '  update_user_id = VALUES(update_user_id),',
      '  update_time = NOW();',
    );
  }

  lines.push(
    'EOSQL',
    '',
    'echo "启动后系统配置脚本执行完成。"',
    '',
  );

  return lines.join('\n');
}

function generateRunbookScript(params: DeployScriptParams, appScriptName: string): string {
  return [
    '#!/bin/bash',
    'set -e',
    '',
    'echo "部署包已拆分为三个阶段脚本："',
    'echo "1. 在数据库服务器执行: bash 01-db-create.sh"',
    appScriptName.endsWith('.ps1')
      ? 'echo "2. 在 Windows 应用服务器执行: powershell -ExecutionPolicy Bypass -File .\\02-app-deploy.ps1"'
      : 'echo "2. 在 Linux 应用服务器执行: bash 02-app-deploy.sh"',
    'echo "3. 应用首次启动并自动建表完成后，在数据库服务器执行: bash 03-system-config.sh"',
    'echo ""',
    'echo "注意：03-system-config.sh 必须在应用启动后执行，因为表结构由 SpringMVC/JPA 自动创建。"',
    `echo "应用访问地址: http://${params.deployHost}"`,
    '',
  ].join('\n');
}

export function generateDeployScripts(
  school: School,
  params: DeployScriptParams,
  warFileName: string,
): DeployScripts {
  const appScriptName = getServerOs(school) === 'windows' ? '02-app-deploy.ps1' : '02-app-deploy.sh';
  return {
    '01-db-create.sh': generateDbCreateScript(school, params),
    [appScriptName]: appScriptName.endsWith('.ps1')
      ? generateWindowsAppDeployScript(school, params, warFileName)
      : generateAppDeployScript(school, params, warFileName),
    '03-system-config.sh': generateSystemConfigScript(school, params),
    'deploy.sh': generateRunbookScript(params, appScriptName),
  };
}

/**
 * 兼容旧调用：返回执行顺序提示，不再把前置建库、应用部署和后置数据初始化混在一起执行。
 */
export function generateDeployScript(
  school: School,
  params: DeployScriptParams,
  warFileName: string,
): string {
  const scripts = generateDeployScripts(school, params, warFileName);
  return [
    scripts['deploy.sh'],
    '',
    '# ---- 01-db-create.sh ----',
    scripts['01-db-create.sh'],
    '',
    '# ---- 02-app-deploy ----',
    scripts['02-app-deploy.sh'] || scripts['02-app-deploy.ps1'],
    '',
    '# ---- 03-system-config.sh ----',
    scripts['03-system-config.sh'],
  ].join('\n');
}
