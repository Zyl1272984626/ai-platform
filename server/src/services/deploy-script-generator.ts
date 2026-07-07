/**
 * 部署脚本生成器。按 ProjectType 分发：
 * - agent：数据库服务器建库 → 应用服务器目录/OneApi → 启动后系统配置
 * - knowledge-center：建库 → Docker 镜像部署 → (可选)外部依赖连通性检查
 *
 * 部署包按执行时机拆分：
 * - 01-db-create.sh：数据库服务器执行，应用启动前，只负责建库。
 * - 02-app-deploy.sh：应用服务器执行，负责目录和 OneApi 容器准备。
 * - 03-system-config.sh：数据库服务器执行，应用首次启动并自动建表后，填充系统配置。
 */
import type { School, Project, ProjectType } from './school-manager.js';

export interface DeployScriptParams {
  /** @deprecated 由 project.deploy.host 提供，保留用于旧签名兼容 */
  deployHost?: string;
  deployUser?: string;
  dbRootPassword?: string;
  mysqlContainer?: string;
  oneapiHost?: string;
  oneapiPort?: number;
  oneapiKey?: string;
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
  /** 在 02-app-deploy.sh 中检查并安装 Node/Python/文档运行时依赖（仅 Linux 生效） */
  installSandboxRuntime?: boolean;
}

export type DeployScripts = Record<string, string>;

const MYSQL_CHARSET = 'utf8mb4';
const MYSQL_COLLATION = 'utf8mb4_0900_as_cs';

// ========== 共享工具 ==========

function getServerOs(project: Project): 'linux' | 'windows' {
  return project.deploy.serverOs === 'windows' ? 'windows' : 'linux';
}

function getWindowsDrive(project: Project): string {
  const raw = project.deploy.windowsDrive || 'D:';
  const normalized = raw.trim().replace(/\\+$/, '');
  return /^[A-Za-z]:$/.test(normalized) ? normalized : 'D:';
}

function getWindowsAgentRoot(project: Project): string {
  return `${getWindowsDrive(project)}\\fskj\\workspace\\agent`;
}

function getAgentRootPath(project: Project): string {
  return getServerOs(project) === 'windows' ? getWindowsAgentRoot(project) : '/fskj/workspace/agent';
}

function joinAgentPath(project: Project, child: string): string {
  const root = getAgentRootPath(project);
  const separator = getServerOs(project) === 'windows' ? '\\' : '/';
  return `${root}${separator}${child}`;
}

function shellHeader(title: string, project: Project): string[] {
  return [
    '#!/bin/bash',
    'set -e',
    '',
    `# ${title} - ${project.name} (${project.code})`,
    `# 生成时间: ${new Date().toISOString()}`,
    '',
    'echo "========================================"',
    `echo " ${title}: ${project.name}"`,
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

function resolveParam(value: string | undefined, fallback: string | undefined): string {
  if (value && value.trim()) return value;
  return fallback || '';
}

// ========== agent 脚本生成 ==========

function mysqlRuntimeBlock(project: Project, params: DeployScriptParams): string[] {
  const mysqlContainer = params.mysqlContainer || project.deploy.mysqlContainer || '';
  const dbRootPassword = params.dbRootPassword || project.deploy.dbRootPassword || '';
  return [
    `DB_ROOT_PASSWORD='${dbRootPassword}'`,
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

function mysqlSystemRuntimeBlock(project: Project, params: DeployScriptParams): string[] {
  const mysqlContainer = params.mysqlContainer || project.deploy.mysqlContainer || '';
  return [
    `DB_HOST=${quoteShell(project.dbHost || '127.0.0.1')}`,
    `DB_PORT=${quoteShell(project.dbPort || 3306)}`,
    `DB_NAME=${quoteShell(project.database)}`,
    `DB_USER=${quoteShell(project.dbUser || '')}`,
    `DB_PASSWORD=${quoteShell(project.dbPassword || '')}`,
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

function sandboxRuntimeInstallBlock(): string[] {
  return [
    '# ---- 1.1 检查并安装沙箱/文档运行时环境 ----',
    'echo "检查并安装运行时环境（Node.js / npm / Python / pip / 文档组件 / 中文字体）..."',
    '# 安装步骤尽量自动完成；部分内网或精简系统可能需要人工配置软件源后重跑本脚本',
    'if [ "$(id -u)" -eq 0 ]; then',
    '  SUDO=""',
    'elif command -v sudo >/dev/null 2>&1; then',
    '  SUDO="sudo"',
    'else',
    '  echo "当前用户不是 root 且未安装 sudo，无法自动安装系统包，请使用 root 执行或先安装 sudo。" >&2',
    '  SUDO=""',
    'fi',
    '',
    'PKG_MANAGER=""',
    'if command -v apt >/dev/null 2>&1; then',
    '  PKG_MANAGER="apt"',
    '  export DEBIAN_FRONTEND=noninteractive',
    '  $SUDO apt update || echo "警告：apt update 失败，将继续尝试安装已知包。" >&2',
    'elif command -v dnf >/dev/null 2>&1; then',
    '  PKG_MANAGER="dnf"',
    'elif command -v yum >/dev/null 2>&1; then',
    '  PKG_MANAGER="yum"',
    'elif command -v apk >/dev/null 2>&1; then',
    '  PKG_MANAGER="apk"',
    'else',
    '  echo "未检测到已知包管理器（apt/dnf/yum/apk），请手动安装依赖。" >&2',
    'fi',
    '',
    'install_packages() {',
    '  if [ -z "$PKG_MANAGER" ]; then return 1; fi',
    '  case "$PKG_MANAGER" in',
    '    apt) $SUDO apt install -y "$@" ;;',
    '    dnf) $SUDO dnf install -y "$@" ;;',
    '    yum) $SUDO yum install -y "$@" ;;',
    '    apk) $SUDO apk add "$@" ;;',
    '  esac',
    '}',
    '',
    'install_first_available() {',
    '  local label="$1"',
    '  shift',
    '  for pkg in "$@"; do',
    '    echo "尝试安装 ${label}: ${pkg}"',
    '    if install_packages "$pkg"; then',
    '      echo "${label} 已安装: ${pkg}"',
    '      return 0',
    '    fi',
    '  done',
    '  echo "警告：${label} 自动安装失败，请根据系统发行版手动安装。" >&2',
    '  return 1',
    '}',
    '',
    'if [ -n "$PKG_MANAGER" ]; then',
    '  case "$PKG_MANAGER" in',
    '    apt)',
    '      install_packages ca-certificates curl fontconfig bubblewrap nodejs npm python3 python3-pip python3-venv libreoffice poppler-utils fonts-noto-cjk fonts-wqy-zenhei || true',
    '      ;;',
    '    dnf)',
    '      install_packages ca-certificates curl fontconfig bubblewrap nodejs npm python3 python3-pip libreoffice poppler-utils google-noto-sans-cjk-fonts google-noto-serif-cjk-fonts || true',
    '      ;;',
    '    yum)',
    '      install_packages ca-certificates curl fontconfig bubblewrap nodejs npm python3 python3-pip libreoffice poppler-utils || true',
    '      install_first_available "中文字体" google-noto-sans-cjk-fonts wqy-zenhei-fonts || true',
    '      ;;',
    '    apk)',
    '      install_packages ca-certificates curl fontconfig bubblewrap nodejs npm python3 py3-pip libreoffice poppler-utils font-noto-cjk wqy-zenhei || true',
    '      ;;',
    '  esac',
    'fi',
    '',
    '# 某些发行版只提供 nodejs 命令，补一个 node 软链，方便通用脚本使用',
    'if ! command -v node >/dev/null 2>&1 && command -v nodejs >/dev/null 2>&1; then',
    '  NODEJS_BIN=$(command -v nodejs)',
    '  if [ -n "$SUDO" ]; then',
    '    $SUDO ln -sf "$NODEJS_BIN" /usr/local/bin/node || true',
    '  else',
    '    ln -sf "$NODEJS_BIN" /usr/local/bin/node || true',
    '  fi',
    'fi',
    '',
    '# pip 兜底：系统包未提供 pip 时尝试 ensurepip',
    'if command -v python3 >/dev/null 2>&1 && ! python3 -m pip --version >/dev/null 2>&1; then',
    '  python3 -m ensurepip --upgrade || true',
    'fi',
    '',
    'if command -v npm >/dev/null 2>&1; then',
    '  echo "安装 Node 组件: pptxgenjs"',
    '  if [ -n "$SUDO" ]; then',
    '    $SUDO npm install -g pptxgenjs || npm install --prefix "$HOME/.local" pptxgenjs || true',
    '  else',
    '    npm install -g pptxgenjs || npm install --prefix "$HOME/.local" pptxgenjs || true',
    '  fi',
    'else',
    '  echo "警告：未检测到 npm，pptxgenjs 未安装。" >&2',
    'fi',
    '',
    'if command -v python3 >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then',
    '  echo "安装 Python 组件: reportlab pypdf matplotlib pandas openpyxl Pillow"',
    '  PIP_PACKAGES="reportlab pypdf matplotlib pandas openpyxl Pillow"',
    '  python3 -m pip install --upgrade --break-system-packages $PIP_PACKAGES \\',
    '    || python3 -m pip install --upgrade --user $PIP_PACKAGES \\',
    '    || echo "警告：Python 组件安装失败，请手动执行: python3 -m pip install $PIP_PACKAGES" >&2',
    'else',
    '  echo "警告：未检测到 python3/pip，Python 组件未安装。" >&2',
    'fi',
    '',
    'if command -v fc-cache >/dev/null 2>&1; then',
    '  fc-cache -f || true',
    'fi',
    '',
    'echo "运行时环境检查结果："',
    'for cmd in node npm python3 libreoffice pdftoppm fc-list; do',
    '  if command -v "$cmd" >/dev/null 2>&1; then',
    '    echo "  ✓ $cmd: $(command -v "$cmd")"',
    '  else',
    '    echo "  ✗ $cmd: 未找到"',
    '  fi',
    'done',
    'if command -v bwrap >/dev/null 2>&1; then',
    '  echo "  ✓ bubblewrap: $(command -v bwrap)"',
    'else',
    '  echo "  ✗ bubblewrap: 未找到"',
    'fi',
    'if command -v python3 >/dev/null 2>&1; then',
    '  python3 - <<\'PYEOF\' || true',
    'mods = ["reportlab", "pypdf", "matplotlib", "pandas", "openpyxl", "PIL"]',
    'for name in mods:',
    '    try:',
    '        __import__(name)',
    '        print(f"  ✓ python:{name}")',
    '    except Exception:',
    '        print(f"  ✗ python:{name}")',
    'PYEOF',
    'fi',
    '',
  ];
}

function generateAgentDbCreateScript(project: Project, params: DeployScriptParams): string {
  const lines = shellHeader('01 数据库创建', project);
  const isMysql = project.dbType === 'mysql';
  const bt = '`';
  const createAgentDatabases = params.createAgentDatabases ?? params.createDatabase;
  const createOneapiDatabase = params.createOneapiDatabase ?? false;
  const oneapiDatabase = params.oneapiDatabase || 'oneapi';

  if (isMysql) {
    lines.push(...mysqlRuntimeBlock(project, params));
  }

  if (!createAgentDatabases && !createOneapiDatabase) {
    lines.push('echo "未选择数据库创建步骤，跳过。"', '');
  }

  if (createAgentDatabases) {
    lines.push('# ---- 创建 Agent 主库和业务库 ----', 'echo "创建 Agent 主库和业务库..."');
    if (isMysql) {
      lines.push(
        `mysql_exec -e 'CREATE DATABASE IF NOT EXISTS ${bt}${project.database}${bt} CHARACTER SET ${MYSQL_CHARSET} COLLATE ${MYSQL_COLLATION};'`,
        `mysql_exec -e 'CREATE DATABASE IF NOT EXISTS ${bt}${project.businessDatabase || `${project.database}_business`}${bt} CHARACTER SET ${MYSQL_CHARSET} COLLATE ${MYSQL_COLLATION};'`,
      );
    } else {
      lines.push(`echo "达梦数据库，请手动创建: ${project.database} 和 ${project.businessDatabase || `${project.database}_business`}"`);
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

function generateAgentAppDeployScript(project: Project, params: DeployScriptParams, warFileName: string): string {
  const lines = shellHeader('02 应用部署', project);
  const oneapiDatabase = params.oneapiDatabase || 'oneapi';
  const oneapiHost = resolveParam(params.oneapiHost, project.deployConfig?.oneapiHost || project.dbHost || '');
  const oneapiPort = params.oneapiPort || project.deployConfig?.oneapiPort || 3000;
  const dbRootPassword = params.dbRootPassword || project.deploy.dbRootPassword || '';
  const mysqlHost = project.dbHost || oneapiHost;
  const mysqlPort = project.dbPort || 3306;

  if (params.installSandboxRuntime) {
    lines.push(...sandboxRuntimeInstallBlock());
  }

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
    'mkdir -p /fskj/workspace/agent/hyperagent/workdir/',
    'mkdir -p /fskj/workspace/agent/hyperagent/runtime/',
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
      `ONEAPI_CONTAINER="oneapi-${project.code}"`,
      `ONEAPI_DATA_DIR="/fskj/workspace/oneapi-${project.code}"`,
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
      '    # docker load 输出格式多样，统一解析出镜像引用：',
      '    #   "Loaded image: oneapi:latest"          → name:tag',
      '    #   "Loaded image ID: sha256:21097c..."     → sha256:ID',
      '    #   "Loaded image: sha256:21097c..."        → sha256:ID',
      '    LOADED_IMAGE=$(printf "%s\\n" "${LOAD_OUTPUT}" | sed -n -E "s/^Loaded image( ID)?: //p" | tail -n 1)',
      '    if [ -n "${LOADED_IMAGE}" ]; then',
      '      # 无条件打 oneapi:latest 标签：tar 可能以 ID 或任意 tag 导出，统一归一到 oneapi:latest',
      '      docker tag "${LOADED_IMAGE}" oneapi:latest >/dev/null 2>&1',
      '    fi',
      '    if ! docker image inspect oneapi:latest >/dev/null 2>&1; then',
      '      echo "docker load 后仍未找到 oneapi:latest，请手动执行 docker images 查看镜像名并 tag 为 oneapi:latest。" >&2',
      '      exit 1',
      '    fi',
      '    echo "  oneapi:latest 镜像就绪"',
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
      `    -p ${oneapiPort}:3000 \\`,
      `    -e SQL_DSN="root:${dbRootPassword}@tcp(${mysqlHost}:${mysqlPort})/${oneapiDatabase}" \\`,
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
    `echo "应用启动后访问地址: http://${project.deploy.host}:${project.deploy.appPort}"`,
    'echo "首次部署请确认应用启动成功并自动建表完成后，再执行 03-system-config.sh。"',
    '',
  );

  return lines.join('\n');
}

function generateWindowsAgentAppDeployScript(project: Project, params: DeployScriptParams, warFileName: string): string {
  const agentRoot = getWindowsAgentRoot(project);
  const logsDir = `${agentRoot}\\logs`;
  const oneapiDatabase = params.oneapiDatabase || 'oneapi';
  const oneapiHost = resolveParam(params.oneapiHost, project.deployConfig?.oneapiHost || project.dbHost || '');
  const oneapiPort = params.oneapiPort || project.deployConfig?.oneapiPort || 3000;
  const dbRootPassword = params.dbRootPassword || project.deploy.dbRootPassword || '';
  const mysqlHost = project.dbHost || oneapiHost;
  const mysqlPort = project.dbPort || 3306;
  const lines = [
    '$ErrorActionPreference = "Stop"',
    '',
    `# 02 应用部署 - ${project.name} (${project.code})`,
    `# 生成时间: ${new Date().toISOString()}`,
    '',
    'Write-Host "========================================"',
    `Write-Host " 02 应用部署: ${project.name}"`,
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
    '  (Join-Path $AgentRoot "skill-storage"),',
    '  (Join-Path $AgentRoot "hyperagent\\workdir"),',
    '  (Join-Path $AgentRoot "hyperagent\\runtime")',
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
      `$OneApiContainer = "oneapi-${project.code}"`,
      `$OneApiDataDir = "${agentRoot}\\oneapi-${project.code}"`,
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
      `    -p ${oneapiPort}:3000 \``,
      `    -e "SQL_DSN=root:${dbRootPassword}@tcp(${mysqlHost}:${mysqlPort})/${oneapiDatabase}" \``,
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
    `Write-Host "应用启动后访问地址: http://${project.deploy.host}:${project.deploy.appPort}"`,
    'Write-Host "首次部署请确认应用启动成功并自动建表完成后，再执行 03-system-config.sh。"',
    '',
  );

  return lines.join('\r\n');
}

function generateAgentSystemConfigScript(project: Project, params: DeployScriptParams): string {
  const lines = shellHeader('03 启动后系统配置', project);
  const isMysql = project.dbType === 'mysql';
  const oneapiHost = resolveParam(params.oneapiHost, project.deployConfig?.oneapiHost || '');
  const oneapiPort = params.oneapiPort || project.deployConfig?.oneapiPort || 3000;
  const oneapiKey = resolveParam(params.oneapiKey, project.deployConfig?.oneapiKey || '');
  const oneapiUrl = normalizeHttpUrl(oneapiHost, oneapiPort);
  const chatModel = params.chatModel || 'deepseek-v4-flash';
  const fileStorages = [
    {
      id: 'ICON_STORAGE_JYT',
      code: 'ICON_STORAGE_JYT',
      name: '文件仓库',
      order: 1,
      basePath: joinAgentPath(project, 'agent'),
      remark: '文件仓库',
    },
    {
      id: 'CHAT_MSG_UPLOAD_FILE',
      code: 'CHAT_MSG_UPLOAD_FILE',
      name: '智能体对话文件上传',
      order: 2,
      basePath: joinAgentPath(project, 'agent-conversation'),
      remark: '智能体对话文件上传',
    },
    {
      id: 'COMP_UPLOAD_FILE',
      code: 'COMP_UPLOAD_FILE',
      name: '组件文件上传',
      order: 3,
      basePath: joinAgentPath(project, 'component'),
      remark: '组件文件上传',
    },
    {
      id: 'SKILL_STORAGE',
      code: 'skill_storage',
      name: '技能仓库',
      order: 4,
      basePath: joinAgentPath(project, 'skill-storage'),
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
    ...mysqlSystemRuntimeBlock(project, params),
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
    `UPDATE fs_sys_config SET value_x = '${quoteSql(oneapiKey)}' WHERE code_x = 'CHAT_MODEL_KEY';`,
  );

  const knowledgeBaseUrl = resolveParam(params.knowledgeBaseUrl, project.deployConfig?.knowledgeBaseUrl);
  const knowledgeAppId = resolveParam(params.knowledgeAppId, project.deployConfig?.knowledgeAppId);
  const knowledgeApiKey = resolveParam(params.knowledgeApiKey, project.deployConfig?.knowledgeApiKey);
  const voiceApiUrl = resolveParam(params.voiceApiUrl, project.deployConfig?.voiceApiUrl);
  if (knowledgeBaseUrl) {
    lines.push(`UPDATE fs_sys_config SET value_x = '${quoteSql(knowledgeBaseUrl)}' WHERE code_x = 'KNOWLEDGE_CENTER_BASE_URL';`);
  }
  if (knowledgeAppId) {
    lines.push(`UPDATE fs_sys_config SET value_x = '${quoteSql(knowledgeAppId)}' WHERE code_x = 'KNOWLEDGE_CENTER_APP_ID';`);
  }
  if (knowledgeApiKey) {
    lines.push(`UPDATE fs_sys_config SET value_x = '${quoteSql(knowledgeApiKey)}' WHERE code_x = 'KNOWLEDGE_CENTER_API_KEY';`);
  }
  if (voiceApiUrl) {
    lines.push(`UPDATE fs_sys_config SET value_x = '${quoteSql(voiceApiUrl)}' WHERE code_x = 'VOICE_API_URL';`);
  }

  lines.push(
    '',
    'DELETE FROM ai_model_source WHERE id <> \'source_oneapi\' AND model_source_code = \'OneApi\';',
    'INSERT INTO ai_model_source (id, create_time, create_user_id, model_source_code, name_x, order_x, params_config, remark_x, update_time, update_user_id)',
    `VALUES ('source_oneapi', NOW(), 'fskjadmin', 'OneApi', 'OneApi', 1, '{\\"url\\":\\"${quoteSql(oneapiUrl)}\\",\\"appKey\\":\\"${quoteSql(oneapiKey)}\\"}', '公司内部部署的 OneApi', NOW(), 'fskjadmin')`,
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

function generateAgentScripts(project: Project, params: DeployScriptParams, warFileName: string): DeployScripts {
  const appScriptName = getServerOs(project) === 'windows' ? '02-app-deploy.ps1' : '02-app-deploy.sh';
  return {
    '01-db-create.sh': generateAgentDbCreateScript(project, params),
    [appScriptName]: appScriptName.endsWith('.ps1')
      ? generateWindowsAgentAppDeployScript(project, params, warFileName)
      : generateAgentAppDeployScript(project, params, warFileName),
    '03-system-config.sh': generateAgentSystemConfigScript(project, params),
    'deploy.sh': generateRunbookScript(project, params, appScriptName),
  };
}

function generateRunbookScript(project: Project, _params: DeployScriptParams, appScriptName: string): string {
  return [
    '#!/bin/bash',
    'set -e',
    '',
    `echo "部署包已拆分为三个阶段脚本（${project.name}）："`,
    'echo "1. 在数据库服务器执行: bash 01-db-create.sh"',
    appScriptName.endsWith('.ps1')
      ? 'echo "2. 在 Windows 应用服务器执行: powershell -ExecutionPolicy Bypass -File .\\02-app-deploy.ps1"'
      : 'echo "2. 在 Linux 应用服务器执行: bash 02-app-deploy.sh"',
    'echo "3. 应用首次启动并自动建表完成后，在数据库服务器执行: bash 03-system-config.sh"',
    'echo ""',
    'echo "注意：03-system-config.sh 必须在应用启动后执行，因为表结构由 SpringMVC/JPA 自动创建。"',
    `echo "应用访问地址: http://${project.deploy.host}:${project.deploy.appPort}"`,
    '',
  ].join('\n');
}

// ========== knowledge-center 脚本生成 ==========

function generateKcDbCreateScript(project: Project): string {
  const lines = shellHeader('01 数据库创建', project);
  const isMysql = project.dbType === 'mysql';
  const bt = '`';
  const dbRootPassword = project.deploy.dbRootPassword || '';
  const mysqlContainer = project.deploy.mysqlContainer || '';

  if (isMysql) {
    lines.push(
      `DB_ROOT_PASSWORD='${dbRootPassword}'`,
      `MYSQL_CONTAINER="\${MYSQL_CONTAINER:-${mysqlContainer}}"`,
      '',
      'mysql_exec() {',
      '  if [ -z "${MYSQL_CONTAINER}" ] && command -v mysql >/dev/null 2>&1; then',
      '    mysql -uroot -p"${DB_ROOT_PASSWORD}" "$@"',
      '    return',
      '  fi',
      '  if [ -n "${MYSQL_CONTAINER}" ] && command -v docker >/dev/null 2>&1 && docker ps --format \'{{.Names}}\' | grep -q "^${MYSQL_CONTAINER}$"; then',
      '    docker exec -i "${MYSQL_CONTAINER}" mysql -uroot -p"${DB_ROOT_PASSWORD}" "$@"',
      '    return',
      '  fi',
      '  echo "未找到可用的 MySQL 执行环境（宿主机 mysql 或 Docker 容器）。" >&2',
      '  exit 1',
      '}',
      '',
      '# ---- 创建 knowledge-center 主库（单库，无 business 库）----',
      'echo "创建 knowledge_center 数据库..."',
      `mysql_exec -e 'CREATE DATABASE IF NOT EXISTS ${bt}${project.database}${bt} CHARACTER SET ${MYSQL_CHARSET} COLLATE ${MYSQL_COLLATION};'`,
      '',
      'echo "数据库创建脚本执行完成。"',
      '',
    );
  } else {
    lines.push(`echo "达梦数据库，请手动创建: ${project.database}"`, '');
  }

  return lines.join('\n');
}

function generateKcAppDeployScript(project: Project, warFileName: string): string {
  const lines = shellHeader('02 应用部署 (Docker)', project);
  const appPort = project.deploy.appPort || 9999;
  const profile = project.knowledgeCenter?.profile || 'dev';
  const kcDir = '/fskj/workspace/knowledge-center';

  lines.push(
    '# ---- 准备部署目录 ----',
    'echo "准备 knowledge-center 部署目录..."',
    `mkdir -p ${kcDir}`,
    `mkdir -p ${kcDir}/logs`,
    `mkdir -p ${kcDir}/config`,
    '',
    '# ---- 拷贝 WAR 与外挂配置 ----',
    `echo "拷贝 WAR 文件: ${warFileName}"`,
    `cp -f ./${warFileName} ${kcDir}/knowledge-center.war`,
    '',
    '# 外挂配置文件（由部署包内 config/ 目录提供）',
    'if [ -d "./config" ]; then',
    `  cp -af ./config/. ${kcDir}/config/`,
    '  echo "  外挂配置已拷贝到 ' + kcDir + '/config/"',
    'else',
    '  echo "  警告：部署包缺少 config/ 目录，将使用 WAR 内置配置。" >&2',
    'fi',
    '',
    '# ---- 生成 docker-compose.yml ----',
    'echo "生成 docker-compose.yml..."',
    `cat > ${kcDir}/docker-compose.yml <<'EOFDC'`,
    'services:',
    '  knowledge-center:',
    '    container_name: knowledge-center',
    '    image: knowledge-center:latest',
    '    ports:',
    `      - "${appPort}:8080"`,
    '    environment:',
    `      SPRING_PROFILES_ACTIVE: ${profile}`,
    '      JAVA_OPTS: "-Xms1g -Xmx2g -Dspring.config.additional-location=file:/opt/config/"',
    '      TZ: Asia/Shanghai',
    '    volumes:',
    `      - ./config/application-${profile}.yml:/opt/config/application-${profile}.yml:ro`,
    '      - ./config/application.yml:/opt/config/application.yml:ro',
    '      - ./logs:/usr/local/tomcat/logs',
    '    restart: unless-stopped',
    'EOFDC',
    '',
    '# ---- 构建 Docker 镜像 ----',
    'echo "构建 knowledge-center Docker 镜像..."',
    'if ! command -v docker >/dev/null 2>&1; then',
    '  echo "未找到 docker 命令。knowledge-center 需要 Docker 环境运行。" >&2',
    '  exit 1',
    'fi',
    '',
    '# 需要项目根目录的 Dockerfile（部署包内已附带）',
    'if [ -f "./Dockerfile" ]; then',
    '  docker build -t knowledge-center:latest --build-arg WAR_FILE=knowledge-center.war .',
    'else',
    '  echo "  未找到 Dockerfile，请确保部署包内已包含项目 Dockerfile。" >&2',
    '  exit 1',
    'fi',
    '',
    '# ---- 启动容器 ----',
    'echo "启动 knowledge-center 容器..."',
    `cd ${kcDir}`,
    'docker compose down || true',
    'docker compose up -d',
    'sleep 5',
    '',
    'echo "应用服务器部署脚本执行完成。"',
    `echo "应用访问地址: http://${project.deploy.host}:${appPort}/knowledge-center/"`,
    'echo "knowledge-center 通过 JPA ddl-auto 自动建表，无需额外的 03 启动后配置。"',
    '',
  );

  return lines.join('\n');
}

function generateKcSystemConfigScript(project: Project): string {
  const lines = shellHeader('03 外部依赖连通性检查', project);
  const kc = project.knowledgeCenter;
  const appPort = project.deploy.appPort || 9999;

  lines.push(
    '# knowledge-center 依赖 Milvus / Neo4j / Redis，本脚本仅做连通性检查（不修改数据）。',
    'echo "检查 knowledge-center 外部依赖连通性..."',
    '',
  );

  if (kc?.milvus?.url) {
    lines.push(
      `MILVUS_HOST="${kc.milvus.url}"`,
      `MILVUS_PORT="${kc.milvus.port || 19530}"`,
      'echo "检查 Milvus: ${MILVUS_HOST}:${MILVUS_PORT}..."',
      'if command -v nc >/dev/null 2>&1; then',
      '  nc -z -w3 "${MILVUS_HOST}" "${MILVUS_PORT}" && echo "  ✓ Milvus 可达" || echo "  ✗ Milvus 不可达"',
      'else',
      '  echo "  (无 nc 命令，跳过 Milvus 连通性检查)"',
      'fi',
      '',
    );
  }

  if (kc?.neo4j?.uri) {
    const neo4jHost = kc.neo4j.uri.replace(/^neo4j[s]?:\/\//, '').replace(/:\d+.*$/, '');
    lines.push(
      `NEO4J_HOST="${neo4jHost}"`,
      'echo "检查 Neo4j: ${NEO4J_HOST}:7687..."',
      'if command -v nc >/dev/null 2>&1; then',
      '  nc -z -w3 "${NEO4J_HOST}" 7687 && echo "  ✓ Neo4j 可达" || echo "  ✗ Neo4j 不可达"',
      'else',
      '  echo "  (无 nc 命令，跳过 Neo4j 连通性检查)"',
      'fi',
      '',
    );
  }

  if (kc?.redis?.host) {
    lines.push(
      `REDIS_HOST="${kc.redis.host}"`,
      `REDIS_PORT="${kc.redis.port || 6379}"`,
      'echo "检查 Redis: ${REDIS_HOST}:${REDIS_PORT}..."',
      'if command -v nc >/dev/null 2>&1; then',
      '  nc -z -w3 "${REDIS_HOST}" "${REDIS_PORT}" && echo "  ✓ Redis 可达" || echo "  ✗ Redis 不可达"',
      'else',
      '  echo "  (无 nc 命令，跳过 Redis 连通性检查)"',
      'fi',
      '',
    );
  }

  lines.push(
    'echo "外部依赖连通性检查完成。"',
    `echo "应用访问地址: http://${project.deploy.host}:${appPort}/knowledge-center/"`,
    '',
  );

  return lines.join('\n');
}

function generateKcScripts(project: Project, _params: DeployScriptParams, warFileName: string): DeployScripts {
  return {
    '01-db-create.sh': generateKcDbCreateScript(project),
    '02-kc-app-deploy.sh': generateKcAppDeployScript(project, warFileName),
    '03-system-config.sh': generateKcSystemConfigScript(project),
    'deploy.sh': [
      '#!/bin/bash',
      'set -e',
      '',
      `echo "knowledge-center 部署步骤（${project.name}）："`,
      'echo "1. 在数据库服务器执行: bash 01-db-create.sh"',
      'echo "2. 在应用服务器执行: bash 02-kc-app-deploy.sh"',
      'echo "3. (可选) 检查外部依赖: bash 03-system-config.sh"',
      '',
      'echo "前置条件：服务器需已安装 Docker，且 Milvus / Neo4j / Redis 服务可用。"',
      `echo "应用访问地址: http://${project.deploy.host}:${project.deploy.appPort}/knowledge-center/"`,
      '',
    ].join('\n'),
  };
}

// ========== 顶层分发 ==========

export function generateDeployScripts(
  school: School,
  project: Project,
  params: DeployScriptParams,
  warFileName: string,
): DeployScripts {
  switch (project.type) {
    case 'agent':
      return generateAgentScripts(project, params, warFileName);
    case 'knowledge-center':
      return generateKcScripts(project, params, warFileName);
    default:
      throw new Error(`不支持的项目类型: ${(project as Project).type}`);
  }
}

/**
 * 兼容旧调用（仅 agent）。新代码应使用 generateDeployScripts(school, project, ...)。
 */
export function generateDeployScript(
  school: School,
  params: DeployScriptParams,
  warFileName: string,
): string {
  const project = school.projects.find((p) => p.type === 'agent') || school.projects[0];
  if (!project) throw new Error('School 没有可部署的项目');
  const scripts = generateDeployScripts(school, project, params, warFileName);
  const appScriptName = getServerOs(project) === 'windows' ? '02-app-deploy.ps1' : '02-app-deploy.sh';
  return [
    scripts['deploy.sh'],
    '',
    '# ---- 01-db-create.sh ----',
    scripts['01-db-create.sh'],
    '',
    '# ---- 02-app-deploy ----',
    scripts[appScriptName] || scripts['02-app-deploy.sh'] || scripts['02-kc-app-deploy.sh'],
    '',
    '# ---- 03-system-config.sh ----',
    scripts['03-system-config.sh'],
  ].join('\n');
}
