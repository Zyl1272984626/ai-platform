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
  /** 是否启用前后端接口加密；启用时后端 security mode=prod，前端 isProd=true */
  encrypted?: boolean;
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
  updateOneapiCache?: boolean;
  initSql?: boolean;
  /** 应用启动时是否执行内置 upgrade/version SQL；外部数据库可设为 false */
  runDatabaseUpgrade?: boolean;
  /** 创建/修复 Agent 文件仓库、沙箱、日志等基础目录 */
  prepareAgentDirs?: boolean;
  /** @deprecated use installOnestopRuntime */
  updateHyperAgent?: boolean;
  /** 安装/更新独立 onestop-runtime 服务（Linux + Docker Compose v2） */
  installOnestopRuntime?: boolean;
  linuxDistro?: 'openeuler' | 'ubuntu' | 'rocky' | 'centos' | 'other';
  /** 更新外挂 tool-script */
  updateToolScript?: boolean;
  /** @deprecated use installOnestopRuntime */
  installSandboxRuntime?: boolean;
  /** 从随包 apache-tomcat-*.zip 安装/修复 Tomcat */
  installTomcat?: boolean;
  /** 在 02-app-deploy 中替换 Tomcat 项目 WAR 并启停 Tomcat */
  autoDeployTomcat?: boolean;
  tomcatRoot?: string;
  tomcatContext?: string;
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

function linuxDistroLabel(distro: DeployScriptParams['linuxDistro'] | Project['deploy']['linuxDistro']): string {
  switch (distro) {
    case 'openeuler': return 'openEuler';
    case 'ubuntu': return 'Ubuntu / Debian';
    case 'rocky': return 'Rocky / RHEL';
    case 'centos': return 'CentOS';
    default: return '其他 Linux';
  }
}
function jdk17InstallBlock(): string[] {
  return [
    '# ---- 1.0 安装/配置 JDK 17 ----',
    'echo "检查并配置 JDK 17..."',
    'JDK_HOME=/usr/lib/jvm/jdk17',
    'JDK_ARCHIVE=$(ls ./jdk-17*_linux-x64_bin.tar.gz ./jdk-17*linux*x64*.tar.gz 2>/dev/null | head -n 1 || true)',
    'if [ -n "${JDK_ARCHIVE}" ]; then',
    '  mkdir -p /usr/lib/jvm',
    '  JDK_INSTALL_TMP="/usr/lib/jvm/.jdk17-install-$$"',
    '  JDK_PREVIOUS=/usr/lib/jvm/jdk17.previous',
    '  rm -rf "${JDK_INSTALL_TMP}"',
    '  mkdir -p "${JDK_INSTALL_TMP}"',
    '  tar -xzf "${JDK_ARCHIVE}" -C "${JDK_INSTALL_TMP}" --strip-components=1',
    '  if [ ! -x "${JDK_INSTALL_TMP}/bin/java" ] || [ ! -x "${JDK_INSTALL_TMP}/bin/keytool" ]; then',
    '    echo "JDK 17 解压后缺少 bin/java 或 bin/keytool。" >&2',
    '    exit 1',
    '  fi',
    '  rm -rf "${JDK_PREVIOUS}"',
    '  if [ -e "${JDK_HOME}" ] || [ -L "${JDK_HOME}" ]; then',
    '    mv "${JDK_HOME}" "${JDK_PREVIOUS}"',
    '  fi',
    '  mv "${JDK_INSTALL_TMP}" "${JDK_HOME}"',
    'elif [ ! -x "${JDK_HOME}/bin/java" ] || [ ! -x "${JDK_HOME}/bin/keytool" ]; then',
    '  echo "部署包中缺少 JDK 17 归档，且 ${JDK_HOME} 不可用。" >&2',
    '  exit 1',
    'fi',
    'export JAVA_HOME="${JDK_HOME}"',
    'export PATH="/usr/local/bin:${JAVA_HOME}/bin:${PATH}"',
    'if command -v update-alternatives >/dev/null 2>&1; then',
    '  update-alternatives --install /usr/bin/java java "${JAVA_HOME}/bin/java" 170010 || true',
    '  update-alternatives --install /usr/bin/keytool keytool "${JAVA_HOME}/bin/keytool" 170010 || true',
    'fi',
    'java -version',
    'keytool -help >/dev/null 2>&1',
    'echo "JDK 17 检查完成: ${JAVA_HOME:-系统默认 Java}"',
    '',
  ];
}

function python310RuntimeInstallBlock(): string[] {
  return [
    '# ---- 0.8 安装/验证 Python 3.10 及文档运行库 ----',
    'echo "检查 Python 3.10 运行环境..."',
    'PYTHON_VERSION="${PYTHON_VERSION:-3.10.14}"',
    'PYTHON_BIN=/usr/local/bin/python3.10',
    'PYTHON_PACKAGES="reportlab pypdf matplotlib"',
    '',
    'if [ "$(id -u)" -ne 0 ]; then',
    '  echo "Python 3.10 安装需要 root 权限，请使用 root 执行本脚本。" >&2',
    '  exit 1',
    'fi',
    '',
    'if [ ! -x "${PYTHON_BIN}" ] && [ -x /usr/bin/python3.10 ]; then',
    '  ln -sfn /usr/bin/python3.10 "${PYTHON_BIN}"',
    'fi',
    '',
    'if [ ! -x "${PYTHON_BIN}" ]; then',
    '  echo "未检测到 Python 3.10，优先尝试系统软件源安装..."',
    '  if command -v apt-get >/dev/null 2>&1; then',
    '    export DEBIAN_FRONTEND=noninteractive',
    '    apt-get update',
    '    apt-get install -y ca-certificates curl build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev libffi-dev liblzma-dev tk-dev uuid-dev',
    '    apt-get install -y python3.10 python3.10-venv python3.10-dev || true',
    '  elif command -v dnf >/dev/null 2>&1; then',
    '    if grep -q \'^ID="\\?openEuler"\\?$\' /etc/os-release 2>/dev/null && grep -q \'^VERSION_ID="\\?22\\.03"\\?$\' /etc/os-release 2>/dev/null && grep -Rqs \'mirrors.aliyun.com/openeuler/openEuler-22.03/\' /etc/yum.repos.d/*.repo 2>/dev/null; then',
    '      echo "修复 openEuler 22.03 SP2 的失效阿里云软件源路径..."',
    '      REPO_BACKUP_SUFFIX="before-python310-$(date +%Y%m%d%H%M%S)"',
    '      for REPO_FILE in /etc/yum.repos.d/*.repo; do',
    '        [ -f "${REPO_FILE}" ] || continue',
    '        if grep -q \'mirrors.aliyun.com/openeuler/openEuler-22.03/\' "${REPO_FILE}"; then',
    '          cp -a "${REPO_FILE}" "${REPO_FILE}.${REPO_BACKUP_SUFFIX}"',
    '          sed -i \'s#openEuler-22\\.03/#openEuler-22.03-LTS-SP2/#g\' "${REPO_FILE}"',
    '        fi',
    '      done',
    '      dnf clean all',
    '      dnf makecache',
    '    fi',
    '    dnf install -y ca-certificates curl gcc make tar gzip openssl-devel bzip2-devel libffi-devel zlib-devel xz-devel readline-devel sqlite-devel',
    '    dnf install -y python3.10 python3.10-devel python3.10-pip || true',
    '  elif command -v yum >/dev/null 2>&1; then',
    '    yum install -y ca-certificates curl gcc make tar gzip openssl-devel bzip2-devel libffi-devel zlib-devel xz-devel readline-devel sqlite-devel',
    '    yum install -y python3.10 python3.10-devel python3.10-pip || true',
    '  elif command -v apk >/dev/null 2>&1; then',
    '    apk add ca-certificates curl build-base openssl-dev bzip2-dev libffi-dev zlib-dev xz-dev readline-dev sqlite-dev',
    '    apk add python3~3.10 py3-pip || true',
    '  else',
    '    echo "未检测到 apt-get/dnf/yum/apk，无法准备 Python 3.10 编译依赖。" >&2',
    '    exit 1',
    '  fi',
    '  if [ ! -x "${PYTHON_BIN}" ] && [ -x /usr/bin/python3.10 ]; then',
    '    ln -sfn /usr/bin/python3.10 "${PYTHON_BIN}"',
    '  fi',
    'fi',
    '',
    'if [ ! -x "${PYTHON_BIN}" ]; then',
    '  echo "系统软件源未提供 Python 3.10，开始安装 Python ${PYTHON_VERSION} 源码版..."',
    '  PYTHON_SOURCE_ARCHIVE=$(ls ./Python-${PYTHON_VERSION}.tgz ./Python-${PYTHON_VERSION}.tar.xz 2>/dev/null | head -n 1 || true)',
    '  PYTHON_BUILD_ROOT="/tmp/agent-python-${PYTHON_VERSION}-$$"',
    '  mkdir -p "${PYTHON_BUILD_ROOT}"',
    '  if [ -z "${PYTHON_SOURCE_ARCHIVE}" ]; then',
    '    PYTHON_SOURCE_ARCHIVE="${PYTHON_BUILD_ROOT}/Python-${PYTHON_VERSION}.tgz"',
    '    curl --fail --location --retry 3 --connect-timeout 15 "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tgz" --output "${PYTHON_SOURCE_ARCHIVE}"',
    '  fi',
    '  tar -xf "${PYTHON_SOURCE_ARCHIVE}" -C "${PYTHON_BUILD_ROOT}"',
    '  cd "${PYTHON_BUILD_ROOT}/Python-${PYTHON_VERSION}"',
    '  ./configure --prefix=/usr/local --with-ensurepip=install',
    '  make -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"',
    '  make altinstall',
    '  cd - >/dev/null',
    '  rm -rf "${PYTHON_BUILD_ROOT}"',
    'fi',
    '',
    'if [ ! -x "${PYTHON_BIN}" ]; then',
    '  echo "Python 3.10 安装失败，未找到 ${PYTHON_BIN}。" >&2',
    '  exit 1',
    'fi',
    '"${PYTHON_BIN}" -c \'import sys; assert sys.version_info[:2] == (3, 10), sys.version\'',
    '',
    'if ! "${PYTHON_BIN}" -m pip --version >/dev/null 2>&1; then',
    '  "${PYTHON_BIN}" -m ensurepip --upgrade || true',
    'fi',
    'if ! "${PYTHON_BIN}" -m pip --version >/dev/null 2>&1; then',
    '  GET_PIP_SCRIPT="/tmp/get-pip-python310-$$.py"',
    '  curl --fail --location --retry 3 --connect-timeout 15 https://bootstrap.pypa.io/get-pip.py --output "${GET_PIP_SCRIPT}"',
    '  "${PYTHON_BIN}" "${GET_PIP_SCRIPT}"',
    '  rm -f "${GET_PIP_SCRIPT}"',
    'fi',
    '"${PYTHON_BIN}" -m pip install --upgrade pip setuptools wheel',
    '',
    'MISSING_PYTHON_PACKAGES=$("${PYTHON_BIN}" - <<\'PYCHECK\'',
    'import importlib.metadata as metadata',
    'required = ("reportlab", "pypdf", "matplotlib")',
    'missing = []',
    'for package in required:',
    '    try:',
    '        metadata.version(package)',
    '    except metadata.PackageNotFoundError:',
    '        missing.append(package)',
    'print(" ".join(missing))',
    'PYCHECK',
    ')',
    'if [ -n "${MISSING_PYTHON_PACKAGES}" ]; then',
    '  echo "安装缺失的 Python 库: ${MISSING_PYTHON_PACKAGES}"',
    '  "${PYTHON_BIN}" -m pip install ${MISSING_PYTHON_PACKAGES}',
    'else',
    '  echo "Python 库均已安装: ${PYTHON_PACKAGES}"',
    'fi',
    '',
    '"${PYTHON_BIN}" - <<\'PYVERIFY\'',
    'import importlib.metadata as metadata',
    'import sys',
    'if sys.version_info[:2] != (3, 10):',
    '    raise SystemExit(f"要求 Python 3.10，实际为 {sys.version}")',
    'for package in ("reportlab", "pypdf", "matplotlib"):',
    '    print(f"{package}={metadata.version(package)}")',
    'PYVERIFY',
    '',
    'if [ -e /usr/local/bin/python3 ] || [ -L /usr/local/bin/python3 ]; then',
    '  CURRENT_PYTHON3=$(readlink -f /usr/local/bin/python3 2>/dev/null || true)',
    '  if [ "${CURRENT_PYTHON3}" != "$(readlink -f "${PYTHON_BIN}")" ]; then',
    '    mv /usr/local/bin/python3 "/usr/local/bin/python3.before-agent-python310-$(date +%Y%m%d%H%M%S)"',
    '  fi',
    'fi',
    'ln -sfn "${PYTHON_BIN}" /usr/local/bin/python3',
    'if [ -x /usr/local/bin/pip3.10 ]; then',
    '  ln -sfn /usr/local/bin/pip3.10 /usr/local/bin/pip3',
    'fi',
    'export PATH="/usr/local/bin:${PATH}"',
    'echo "Python 3.10 运行环境检查通过: $(python3 --version 2>&1)"',
    '',
  ];
}

function nodeRuntimeInstallBlock(): string[] {
  return [
    '# ---- 0.85 安装/验证 Node.js 及 Agent 运行组件 ----',
    'echo "检查 Node.js 运行环境..."',
    'NODE_VERSION="${NODE_VERSION:-20.18.3}"',
    'NODE_PACKAGES="pptxgenjs react react-dom react-icons sharp"',
    'NODE_GLOBAL_ROOT=/usr/local/lib/node_modules',
    'export PATH="/usr/local/bin:${PATH}"',
    '',
    'node_version_supported() {',
    '  command -v node >/dev/null 2>&1 || return 1',
    '  NODE_MAJOR=$(node -p \'Number(process.versions.node.split(".")[0])\' 2>/dev/null || echo 0)',
    '  [ "${NODE_MAJOR}" -ge 18 ]',
    '}',
    '',
    'if ! node_version_supported || ! command -v npm >/dev/null 2>&1; then',
    '  echo "未检测到 Node.js 18+ 和 npm，优先尝试系统软件源安装..."',
    '  if command -v apt-get >/dev/null 2>&1; then',
    '    export DEBIAN_FRONTEND=noninteractive',
    '    apt-get update',
    '    apt-get install -y ca-certificates curl xz-utils',
    '    apt-get install -y nodejs npm || true',
    '  elif command -v dnf >/dev/null 2>&1; then',
    '    dnf install -y ca-certificates curl tar xz',
    '    dnf install -y nodejs npm || true',
    '  elif command -v yum >/dev/null 2>&1; then',
    '    yum install -y ca-certificates curl tar xz',
    '    yum install -y nodejs npm || true',
    '  elif command -v apk >/dev/null 2>&1; then',
    '    apk add ca-certificates curl tar xz',
    '    apk add nodejs npm || true',
    '  else',
    '    echo "未检测到 apt-get/dnf/yum/apk，无法自动安装 Node.js。" >&2',
    '  fi',
    'fi',
    '',
    'if ! node_version_supported || ! command -v npm >/dev/null 2>&1; then',
    '  echo "系统软件源的 Node.js 不满足 18+，安装 Node.js ${NODE_VERSION} 官方二进制版..."',
    '  case "$(uname -m)" in',
    '    x86_64|amd64) NODE_ARCH=x64 ;;',
    '    aarch64|arm64) NODE_ARCH=arm64 ;;',
    '    *) echo "不支持的 Node.js CPU 架构: $(uname -m)" >&2; exit 1 ;;',
    '  esac',
    '  NODE_ARCHIVE="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"',
    '  NODE_INSTALL_DIR="/opt/node-v${NODE_VERSION}-linux-${NODE_ARCH}"',
    '  NODE_DOWNLOAD="/tmp/${NODE_ARCHIVE}"',
    '  curl --fail --location --retry 3 --connect-timeout 15 "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" --output "${NODE_DOWNLOAD}"',
    '  rm -rf "${NODE_INSTALL_DIR}"',
    '  tar -xJf "${NODE_DOWNLOAD}" -C /opt',
    '  rm -f "${NODE_DOWNLOAD}"',
    '  for NODE_COMMAND in node npm npx corepack; do',
    '    if [ -x "${NODE_INSTALL_DIR}/bin/${NODE_COMMAND}" ]; then',
    '      ln -sfn "${NODE_INSTALL_DIR}/bin/${NODE_COMMAND}" "/usr/local/bin/${NODE_COMMAND}"',
    '    fi',
    '  done',
    '  export PATH="/usr/local/bin:${PATH}"',
    'fi',
    '',
    'if ! node_version_supported; then',
    '  echo "Node.js 安装失败或版本低于 18: $(node --version 2>/dev/null || echo 未安装)" >&2',
    '  exit 1',
    'fi',
    'if ! command -v npm >/dev/null 2>&1; then',
    '  echo "npm 安装失败。" >&2',
    '  exit 1',
    'fi',
    'ACTIVE_NODE_BIN=$(command -v node)',
    'ACTIVE_NPM_BIN=$(command -v npm)',
    'if [ "${ACTIVE_NODE_BIN}" != "/usr/local/bin/node" ]; then',
    '  ln -sfn "${ACTIVE_NODE_BIN}" /usr/local/bin/node',
    'fi',
    'if [ "${ACTIVE_NPM_BIN}" != "/usr/local/bin/npm" ]; then',
    '  ln -sfn "${ACTIVE_NPM_BIN}" /usr/local/bin/npm',
    'fi',
    'hash -r',
    '',
    'export NPM_CONFIG_PREFIX=/usr/local',
    'export NODE_PATH="${NODE_GLOBAL_ROOT}"',
    'mkdir -p "${NODE_GLOBAL_ROOT}"',
    'MISSING_NODE_PACKAGES=""',
    'for NODE_PACKAGE in ${NODE_PACKAGES}; do',
    '  if ! NODE_PATH="${NODE_GLOBAL_ROOT}" node -e \'require.resolve(process.argv[1])\' "${NODE_PACKAGE}" >/dev/null 2>&1; then',
    '    MISSING_NODE_PACKAGES="${MISSING_NODE_PACKAGES} ${NODE_PACKAGE}"',
    '  fi',
    'done',
    'if [ -n "${MISSING_NODE_PACKAGES}" ]; then',
    '  echo "安装缺失的 Node.js 组件:${MISSING_NODE_PACKAGES}"',
    '  npm install --global ${MISSING_NODE_PACKAGES}',
    'else',
    '  echo "Node.js 组件均已安装: ${NODE_PACKAGES}"',
    'fi',
    '',
    'for NODE_PACKAGE in ${NODE_PACKAGES}; do',
    '  NODE_PATH="${NODE_GLOBAL_ROOT}" node -e \'require.resolve(process.argv[1]); console.log(process.argv[1] + "=OK")\' "${NODE_PACKAGE}"',
    'done',
    'node --version',
    'npm --version',
    'echo "Node.js 运行环境检查通过: $(command -v node)"',
    '',
  ];
}

function bubblewrapInstallBlock(project: Project): string[] {
  const sandboxEnabled = project.sandbox?.enabled !== false;
  const strategy = project.sandbox?.strategy || 'bubblewrap';
  if (!sandboxEnabled || !['auto', 'bubblewrap'].includes(strategy)) return [];

  return [
    '# ---- 0.9 安装/验证 Bubblewrap 沙箱 ----',
    'echo "检查 Bubblewrap 沙箱..."',
    'if ! command -v bwrap >/dev/null 2>&1; then',
    '  echo "未检测到 bwrap，开始安装 bubblewrap..."',
    '  if command -v apt-get >/dev/null 2>&1; then',
    '    export DEBIAN_FRONTEND=noninteractive',
    '    apt-get update',
    '    apt-get install -y bubblewrap',
    '  elif command -v dnf >/dev/null 2>&1; then',
    '    if ! dnf install -y bubblewrap; then',
    '      # openEuler 22.03 SP2 的旧阿里云镜像路径会返回 404；仅针对这个已知错误修复并重试。',
    '      if grep -q \'^ID="\\?openEuler"\\?$\' /etc/os-release 2>/dev/null && grep -q \'^VERSION_ID="\\?22\\.03"\\?$\' /etc/os-release 2>/dev/null && grep -Rqs \'mirrors.aliyun.com/openeuler/openEuler-22.03/\' /etc/yum.repos.d/*.repo 2>/dev/null; then',
    '        echo "修复 openEuler 22.03 SP2 的失效阿里云软件源路径..."',
    '        REPO_BACKUP_SUFFIX="before-bwrap-$(date +%Y%m%d%H%M%S)"',
    '        for REPO_FILE in /etc/yum.repos.d/*.repo; do',
    '          [ -f "${REPO_FILE}" ] || continue',
    '          if grep -q \'mirrors.aliyun.com/openeuler/openEuler-22.03/\' "${REPO_FILE}"; then',
    '            cp -a "${REPO_FILE}" "${REPO_FILE}.${REPO_BACKUP_SUFFIX}"',
    '            sed -i \'s#openEuler-22\\.03/#openEuler-22.03-LTS-SP2/#g\' "${REPO_FILE}"',
    '          fi',
    '        done',
    '        dnf clean all',
    '        dnf makecache',
    '        dnf install -y bubblewrap',
    '      else',
    '        echo "bubblewrap 安装失败，请检查 dnf 软件源后重试。" >&2',
    '        exit 1',
    '      fi',
    '    fi',
    '  elif command -v yum >/dev/null 2>&1; then',
    '    yum install -y bubblewrap',
    '  elif command -v apk >/dev/null 2>&1; then',
    '    apk add bubblewrap',
    '  else',
    '    echo "未检测到 apt-get/dnf/yum/apk，无法自动安装 bubblewrap。" >&2',
    '    exit 1',
    '  fi',
    'fi',
    'if ! command -v bwrap >/dev/null 2>&1; then',
    '  echo "bubblewrap 安装后仍找不到 bwrap 命令。" >&2',
    '  exit 1',
    'fi',
    'bwrap --version',
    'bwrap --ro-bind / / --dev /dev --proc /proc --unshare-all --die-with-parent /bin/true',
    'echo "Bubblewrap 沙箱检查通过: $(command -v bwrap)"',
    '',
  ];
}

function onestopRuntimeInstallBlock(project: Project, params: DeployScriptParams): string[] {
  const distro = params.linuxDistro || project.deploy.linuxDistro || 'openeuler';
  return [
    '# ---- 1.1 安装/更新一站办通独立 runtime 服务 ----',
    'echo "安装/更新 onestop-runtime 独立服务..."',
    `echo "Linux 发行版: ${linuxDistroLabel(distro)}"`,
    'echo "前置要求：Linux x86_64、Docker Engine、Docker Compose v2、curl、gzip、sha256sum、openssl、JDK keytool。"',
    'ONESTOP_PACKAGE=$(ls ./onestop-runtime-*.tar.gz 2>/dev/null | head -n 1 || true)',
    'if [ -z "${ONESTOP_PACKAGE}" ]; then',
    '  echo "部署包中缺少 onestop-runtime-*.tar.gz，无法安装/更新独立 runtime 服务。" >&2',
    '  exit 1',
    'fi',
    'if [ -f "${ONESTOP_PACKAGE}.sha256" ]; then',
    '  sha256sum -c "$(basename "${ONESTOP_PACKAGE}.sha256")"',
    'elif ls ./onestop-runtime-*.tar.gz.sha256 >/dev/null 2>&1; then',
    '  sha256sum -c "$(ls ./onestop-runtime-*.tar.gz.sha256 | head -n 1)"',
    'else',
    '  echo "警告：未随包提供 onestop-runtime sha256 文件，跳过完整性校验。" >&2',
    'fi',
    'ONESTOP_INSTALL_PARENT="/opt"',
    'mkdir -p "${ONESTOP_INSTALL_PARENT}"',
    'tar -xzf "${ONESTOP_PACKAGE}" -C "${ONESTOP_INSTALL_PARENT}"',
    'ONESTOP_RUNTIME_HOME=$(tar -tzf "${ONESTOP_PACKAGE}" | head -n 1 | cut -d/ -f1)',
    'ONESTOP_RUNTIME_DIR="${ONESTOP_INSTALL_PARENT}/${ONESTOP_RUNTIME_HOME}"',
    'if [ ! -d "${ONESTOP_RUNTIME_DIR}" ]; then',
    '  echo "runtime 解压目录不存在: ${ONESTOP_RUNTIME_DIR}" >&2',
    '  exit 1',
    'fi',
    'cd "${ONESTOP_RUNTIME_DIR}"',
    'chmod +x check-environment.sh manage.sh deploy-offline.sh verify-deployment.sh 2>/dev/null || true',
    'if [ ! -f ".env" ]; then',
    '  cp .env.example .env',
    'fi',
    'mkdir -p secrets',
    'umask 077',
    'if [ ! -f secrets/hmac-secret ]; then',
    '  openssl rand -base64 48 > secrets/hmac-secret',
    'fi',
    'if [ ! -f secrets/runtime-private-key.der ]; then',
    '  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/runtime-private-key.pem',
    '  openssl pkcs8 -topk8 -nocrypt -in secrets/runtime-private-key.pem -outform DER -out secrets/runtime-private-key.der',
    '  rm -f secrets/runtime-private-key.pem',
    'fi',
    'if [ ! -f secrets/ca.crt ] || [ ! -f secrets/tls.crt ] || [ ! -f secrets/tls.key ]; then',
    '  echo "未检测到 TLS 证书，生成仅适合同机 127.0.0.1 使用的自签名证书。生产环境建议替换为学校签发证书。"',
    '  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/ca.key',
    '  openssl req -x509 -new -nodes -key secrets/ca.key -sha256 -days 3650 -subj "/CN=onestop-runtime-local-ca" -out secrets/ca.crt',
    '  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/tls.key',
    '  cat > secrets/tls.cnf <<\'EOFCNF\'',
    '[req]',
    'distinguished_name=req_distinguished_name',
    'req_extensions=v3_req',
    'prompt=no',
    '[req_distinguished_name]',
    'CN=127.0.0.1',
    '[v3_req]',
    'subjectAltName=@alt_names',
    '[alt_names]',
    'IP.1=127.0.0.1',
    'DNS.1=localhost',
    'EOFCNF',
    '  openssl req -new -key secrets/tls.key -out secrets/tls.csr -config secrets/tls.cnf',
    '  openssl x509 -req -in secrets/tls.csr -CA secrets/ca.crt -CAkey secrets/ca.key -CAcreateserial -out secrets/tls.crt -days 825 -sha256 -extensions v3_req -extfile secrets/tls.cnf',
    '  rm -f secrets/tls.csr secrets/tls.cnf secrets/ca.srl',
    'fi',
    'chmod 600 secrets/tls.key secrets/ca.key 2>/dev/null || true',
    'chmod 400 secrets/hmac-secret secrets/runtime-private-key.der 2>/dev/null || true',
    'sed -i -E "s#^ONESTOP_RUNTIME_LISTEN_IP=.*#ONESTOP_RUNTIME_LISTEN_IP=127.0.0.1#" .env',
    'sed -i -E "s#^ONESTOP_RUNTIME_HTTPS_PORT=.*#ONESTOP_RUNTIME_HTTPS_PORT=9443#" .env',
    'sed -i -E "s#^ONESTOP_RUNTIME_CLIENT_ID=.*#ONESTOP_RUNTIME_CLIENT_ID=agent#" .env',
    'sed -i -E "s#^ONESTOP_RUNTIME_KEY_ID=.*#ONESTOP_RUNTIME_KEY_ID=v1#" .env',
    'bash check-environment.sh | tee onestop-environment-report.txt',
    'RUNTIME_VERIFY_LOG="/tmp/onestop-runtime-verify-$$.log"',
    'if bash manage.sh verify >"${RUNTIME_VERIFY_LOG}" 2>&1; then',
    '  cat "${RUNTIME_VERIFY_LOG}"',
    '  echo "onestop-runtime 已健康运行，跳过重复导入离线镜像。"',
    'else',
    '  cat "${RUNTIME_VERIFY_LOG}" || true',
    '  echo "onestop-runtime 尚未就绪，执行离线安装/更新..."',
    '  bash manage.sh install',
    'fi',
    'rm -f "${RUNTIME_VERIFY_LOG}"',
    'bash manage.sh status || true',
    'bash manage.sh verify',
    'cd - >/dev/null',
    'echo "onestop-runtime 独立服务已安装/更新: ${ONESTOP_RUNTIME_DIR}"',
    '',
  ];
}

function getTomcatRoot(project: Project, params: DeployScriptParams): string {
  return params.tomcatRoot || project.deploy.tomcatRoot || '';
}

function defaultTomcatContext(project: Project): string {
  return project.type === 'knowledge-center' ? 'knowledge-center' : 'agent';
}

function getTomcatContext(project: Project, params: DeployScriptParams): string {
  const fallback = defaultTomcatContext(project);
  const raw = params.tomcatContext || project.deploy.tomcatContext || fallback;
  const normalized = raw.trim() || fallback;
  return normalized.replace(/^\/+|\/+$/g, '') || fallback;
}

function enabled(value: boolean | undefined, defaultValue: boolean): boolean {
  return value ?? defaultValue;
}

function linuxTomcatDeployBlock(project: Project, params: DeployScriptParams, warFileName: string): string[] {
  const tomcatRoot = getTomcatRoot(project, params);
  const tomcatContext = getTomcatContext(project, params);
  const installTomcat = enabled(params.installTomcat, true);
  if (!params.autoDeployTomcat || !tomcatRoot.trim()) return [];

  return [
    '# ---- 1.3 自动更新 Tomcat ----',
    'echo "开始自动更新 Tomcat..."',
    `TOMCAT_ROOT=${quoteShell(tomcatRoot)}`,
    `TOMCAT_CONTEXT="\${TOMCAT_CONTEXT:-${tomcatContext}}"`,
    `SOURCE_WAR="./${warFileName}"`,
    'WEBAPPS_DIR="${TOMCAT_ROOT}/webapps"',
    'TARGET_WAR="${WEBAPPS_DIR}/${TOMCAT_CONTEXT}.war"',
    'TARGET_DIR="${WEBAPPS_DIR}/${TOMCAT_CONTEXT}"',
    `TOMCAT_HTTP_PORT="${project.deploy.appPort || 8080}"`,
    `INSTALL_TOMCAT="${installTomcat ? '1' : '0'}"`,
    '',
    'if [ ! -d "${TOMCAT_ROOT}" ] || [ ! -d "${WEBAPPS_DIR}" ]; then',
    '  if [ "${INSTALL_TOMCAT}" != "1" ]; then',
    '    echo "Tomcat 根目录不完整，且未选择安装/更新 Tomcat: ${TOMCAT_ROOT}" >&2',
    '    exit 1',
    '  fi',
    '  TOMCAT_ARCHIVE=$(ls ./apache-tomcat-*.zip 2>/dev/null | head -n 1 || true)',
    '  if [ -z "${TOMCAT_ARCHIVE}" ]; then',
    '    echo "Tomcat 根目录不完整，且部署包中未找到 apache-tomcat-*.zip: ${TOMCAT_ROOT}" >&2',
    '    exit 1',
    '  fi',
    '  if ! command -v unzip >/dev/null 2>&1; then',
    '    echo "未找到 unzip 命令，无法解压 ${TOMCAT_ARCHIVE}。" >&2',
    '    exit 1',
    '  fi',
    '  echo "Tomcat 根目录不完整，开始从 ${TOMCAT_ARCHIVE} 安装到 ${TOMCAT_ROOT}..."',
    '  TOMCAT_TMP="/tmp/apache-tomcat-${RANDOM}-$$"',
    '  rm -rf "${TOMCAT_TMP}"',
    '  mkdir -p "${TOMCAT_TMP}"',
    '  unzip -q -o "${TOMCAT_ARCHIVE}" -d "${TOMCAT_TMP}"',
    '  TOMCAT_UNPACKED=$(find "${TOMCAT_TMP}" -mindepth 1 -maxdepth 1 -type d | head -n 1)',
    '  if [ -z "${TOMCAT_UNPACKED}" ]; then',
    '    echo "Tomcat 压缩包解压后未找到目录: ${TOMCAT_ARCHIVE}" >&2',
    '    exit 1',
    '  fi',
    '  if [ -d "${TOMCAT_ROOT}" ] && [ ! -d "${WEBAPPS_DIR}" ] && [ -n "$(find "${TOMCAT_ROOT}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then',
    '    echo "Tomcat 根目录已存在但不是有效 Tomcat，且目录非空。为避免误删，请检查路径: ${TOMCAT_ROOT}" >&2',
    '    exit 1',
    '  fi',
    '  rm -rf "${TOMCAT_ROOT}"',
    '  mkdir -p "$(dirname "${TOMCAT_ROOT}")"',
    '  mv "${TOMCAT_UNPACKED}" "${TOMCAT_ROOT}"',
    '  rm -rf "${TOMCAT_TMP}"',
    '  chmod +x "${TOMCAT_ROOT}/bin/"*.sh 2>/dev/null || true',
    '  echo "Tomcat 已安装到 ${TOMCAT_ROOT}"',
    'fi',
    'if [ ! -d "${WEBAPPS_DIR}" ]; then',
    '  echo "Tomcat webapps 目录不存在: ${WEBAPPS_DIR}" >&2',
    '  exit 1',
    'fi',
    'SERVER_XML="${TOMCAT_ROOT}/conf/server.xml"',
    'if [ ! -f "${SERVER_XML}" ]; then',
    '  echo "Tomcat server.xml 不存在: ${SERVER_XML}" >&2',
    '  exit 1',
    'fi',
    'echo "配置 Tomcat HTTP 端口: ${TOMCAT_HTTP_PORT}"',
    'cp -f "${SERVER_XML}" "${SERVER_XML}.$(date +%Y%m%d%H%M%S).bak"',
    'if command -v python3 >/dev/null 2>&1; then',
    '  python3 - "${SERVER_XML}" "${TOMCAT_HTTP_PORT}" <<\'PYEOF\'',
    'import pathlib',
    'import re',
    'import sys',
    'path = pathlib.Path(sys.argv[1])',
    'port = sys.argv[2]',
    'text = path.read_text(encoding="utf-8")',
    'masked = re.sub(r\'<!--[\\s\\S]*?-->\', lambda m: " " * len(m.group(0)), text)',
    'for connector in re.finditer(r\'<Connector\\b[^>]*>\', masked, re.I | re.S):',
    '    tag = text[connector.start():connector.end()]',
    '    protocol_match = re.search(r\'\\bprotocol\\s*=\\s*"([^"]+)"\', tag, re.I)',
    '    protocol = protocol_match.group(1) if protocol_match else ""',
    '    if protocol and protocol.upper() != "HTTP/1.1" and "http11" not in protocol.lower():',
    '        continue',
    '    updated_tag, count = re.subn(r\'(\\bport\\s*=\\s*")\\d+(")\', r\'\\g<1>\' + port + r\'\\2\', tag, count=1, flags=re.I)',
    '    if count:',
    '        text = text[:connector.start()] + updated_tag + text[connector.end():]',
    '        path.write_text(text, encoding="utf-8")',
    '        break',
    'else:',
    '    raise SystemExit("未找到启用的 Tomcat HTTP Connector，无法自动修改端口")',
    'PYEOF',
    'else',
    '  echo "未找到 python3，随包 Tomcat 已按项目端口配置；如使用已有 Tomcat，请手动确认 server.xml。" >&2',
    'fi',
    'if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then',
    '  if ! firewall-cmd --query-port="${TOMCAT_HTTP_PORT}/tcp" >/dev/null 2>&1; then',
    '    echo "开放 firewalld 应用端口: ${TOMCAT_HTTP_PORT}/tcp"',
    '    firewall-cmd --permanent --add-port="${TOMCAT_HTTP_PORT}/tcp"',
    '    firewall-cmd --reload',
    '  else',
    '    echo "firewalld 端口已开放: ${TOMCAT_HTTP_PORT}/tcp"',
    '  fi',
    'fi',
    ...(project.type === 'agent' ? [
      'ONESTOP_RUNTIME_DIR=$(find /opt -maxdepth 1 -type d -name "onestop-runtime-*" 2>/dev/null | sort -V | tail -n 1)',
      'if [ -z "${ONESTOP_RUNTIME_DIR}" ] || [ ! -d "${ONESTOP_RUNTIME_DIR}/secrets" ]; then',
      '  echo "未找到 /opt/onestop-runtime-* 或 secrets 目录，请先选择并执行 onestop-runtime 独立服务安装。" >&2',
      '  exit 1',
      'fi',
      'WAR_SECRET_DIR="/fskj/workspace/agent/onestop-runtime-secrets"',
      'mkdir -p "${WAR_SECRET_DIR}"',
      'cp -f "${ONESTOP_RUNTIME_DIR}/secrets/hmac-secret" "${WAR_SECRET_DIR}/hmac-secret"',
      'CREDENTIAL_KEK_FILE="${WAR_SECRET_DIR}/credential-kek"',
      'LEGACY_CREDENTIAL_KEK_FILE="/fskj/workspace/agent/credential-kek"',
      'if [ ! -s "${CREDENTIAL_KEK_FILE}" ] && [ -s "${LEGACY_CREDENTIAL_KEK_FILE}" ]; then',
      '  echo "迁移已有 Agent 凭据 KEK，确保历史凭据可继续解密..."',
      '  cp -p "${LEGACY_CREDENTIAL_KEK_FILE}" "${CREDENTIAL_KEK_FILE}"',
      'fi',
      'if [ ! -s "${CREDENTIAL_KEK_FILE}" ]; then',
      '  echo "首次生成 Agent 凭据 AES-256 KEK..."',
      '  CREDENTIAL_KEK_TMP="${CREDENTIAL_KEK_FILE}.tmp.$$"',
      '  (umask 077; openssl rand -base64 32 > "${CREDENTIAL_KEK_TMP}")',
      '  mv "${CREDENTIAL_KEK_TMP}" "${CREDENTIAL_KEK_FILE}"',
      '  echo "警告：已生成新的凭据 KEK。若当前数据库已有 ai_user_credential 数据，必须恢复原 KEK 或重新录入历史凭据。" >&2',
      'else',
      '  echo "复用已有 Agent 凭据 KEK: ${CREDENTIAL_KEK_FILE}"',
      'fi',
      'CREDENTIAL_KEK_BYTES=$(openssl base64 -d -A -in "${CREDENTIAL_KEK_FILE}" | wc -c | tr -d " ")',
      'if [ "${CREDENTIAL_KEK_BYTES}" != "32" ]; then',
      '  echo "Agent 凭据 KEK 格式无效，必须是 Base64 编码的 32 字节随机密钥: ${CREDENTIAL_KEK_FILE}" >&2',
      '  exit 1',
      'fi',
      'if [ ! -f "${WAR_SECRET_DIR}/truststore-password" ]; then',
      '  openssl rand -base64 32 > "${WAR_SECRET_DIR}/truststore-password"',
      'fi',
      'rm -f "${WAR_SECRET_DIR}/onestop-runtime-truststore.p12"',
      'keytool -importcert -noprompt -alias onestop-runtime-ca \\',
      '  -file "${ONESTOP_RUNTIME_DIR}/secrets/ca.crt" \\',
      '  -keystore "${WAR_SECRET_DIR}/onestop-runtime-truststore.p12" \\',
      '  -storetype PKCS12 \\',
      '  -storepass "$(cat "${WAR_SECRET_DIR}/truststore-password")"',
      'chmod 600 "${WAR_SECRET_DIR}/credential-kek" "${WAR_SECRET_DIR}/hmac-secret" "${WAR_SECRET_DIR}/onestop-runtime-truststore.p12" "${WAR_SECRET_DIR}/truststore-password"',
      'if [ -n "${TOMCAT_USER:-}" ]; then',
      '  chown -R "${TOMCAT_USER}:${TOMCAT_USER}" "${WAR_SECRET_DIR}"',
      'fi',
      'TOMCAT_CONTEXT_PATH="/${TOMCAT_CONTEXT}"',
      'if [ "${TOMCAT_CONTEXT}" = "ROOT" ] || [ "${TOMCAT_CONTEXT}" = "root" ]; then',
      '  TOMCAT_CONTEXT_PATH=""',
      'fi',
      'SETENV_SH="${TOMCAT_ROOT}/bin/setenv.sh"',
      'touch "${SETENV_SH}"',
      'SETENV_BACKUP="${SETENV_SH}.before-onestop-$(date +%Y%m%d-%H%M%S)"',
      'cp -a "${SETENV_SH}" "${SETENV_BACKUP}"',
      'echo "Tomcat 原环境配置已备份: ${SETENV_BACKUP}"',
      'SETENV_TMP="${SETENV_SH}.tmp.$$"',
      'awk \'/# >>> onestop-runtime remote config/{skip=1; next} /# <<< onestop-runtime remote config/{skip=0; next} !skip{print}\' "${SETENV_SH}" > "${SETENV_TMP}"',
      'cat >> "${SETENV_TMP}" <<EOFSETENV',
      '# >>> onestop-runtime remote config',
      'export JAVA_HOME=/usr/lib/jvm/jdk17',
      'export PATH=/usr/local/bin:\\${JAVA_HOME}/bin:\\${PATH}',
      'export NODE_PATH=/usr/local/lib/node_modules',
      'export ONESTOP_HYPER_AGENT_EXECUTION_MODE=remote',
      'export ONESTOP_HYPER_AGENT_HOST_LOCAL_ENABLED=false',
      'export ONESTOP_HYPER_AGENT_LOCAL_DEVELOPMENT_ENABLED=false',
      'export ONESTOP_RUNTIME_ENDPOINT=https://127.0.0.1:9443',
      'export ONESTOP_RUNTIME_CALLBACK_BASE_URL=http://host.docker.internal:${TOMCAT_HTTP_PORT}${TOMCAT_CONTEXT_PATH}',
      'export ONESTOP_RUNTIME_CLIENT_ID=agent',
      'export ONESTOP_RUNTIME_KEY_ID=v1',
      'export ONESTOP_RUNTIME_HMAC_SECRET_FILE=${WAR_SECRET_DIR}/hmac-secret',
      'export ONESTOP_RUNTIME_TRUST_STORE=${WAR_SECRET_DIR}/onestop-runtime-truststore.p12',
      'export ONESTOP_RUNTIME_TRUST_STORE_PASSWORD_FILE=${WAR_SECRET_DIR}/truststore-password',
      'export TOPSPEEDER_CREDENTIAL_KEK_FILE=${CREDENTIAL_KEK_FILE}',
      'export ONESTOP_RUNTIME_PRODUCTION=true',
      'export ONESTOP_RUNTIME_ALLOW_INSECURE_LOOPBACK=false',
      'export AI_AGENT_SKILL_STORAGE_PATH=/fskj/workspace/agent/skill-storage',
      `export TOPSPEEDER_UPGRADE_ENABLED=${enabled(params.runDatabaseUpgrade, true) ? 'true' : 'false'}`,
      '# <<< onestop-runtime remote config',
      'EOFSETENV',
      'mv "${SETENV_TMP}" "${SETENV_SH}"',
      'chmod 644 "${SETENV_SH}"',
      'echo "Tomcat setenv.sh 已写入 onestop-runtime remote 配置: ${SETENV_SH}"',
    ] : []),
    'if [ ! -f "${SOURCE_WAR}" ]; then',
    '  echo "部署包中缺少 WAR 文件: ${SOURCE_WAR}" >&2',
    '  exit 1',
    'fi',
    'case "${TOMCAT_CONTEXT}" in',
    '  ""|"."|".."|*/*|*\\\\*)',
    '    echo "非法项目名: ${TOMCAT_CONTEXT}。只允许单个项目名，例如 agent 或 knowledge-center。" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    'WEBAPPS_REAL=$(cd "${WEBAPPS_DIR}" && pwd -P)',
    'TARGET_PARENT_REAL=$(cd "$(dirname "${TARGET_DIR}")" && pwd -P)',
    'if [ "${TARGET_PARENT_REAL}" != "${WEBAPPS_REAL}" ]; then',
    '  echo "安全检查失败：目标目录不在 webapps 下: ${TARGET_DIR}" >&2',
    '  exit 1',
    'fi',
    '',
    'echo "停止 Tomcat..."',
    'if [ -x "${TOMCAT_ROOT}/bin/shutdown.sh" ]; then',
    '  "${TOMCAT_ROOT}/bin/shutdown.sh" || true',
    'elif [ -f "${TOMCAT_ROOT}/bin/shutdown.sh" ]; then',
    '  sh "${TOMCAT_ROOT}/bin/shutdown.sh" || true',
    'else',
    '  echo "  未找到 shutdown.sh，跳过优雅停止。" >&2',
    'fi',
    'sleep 5',
    'TOMCAT_PIDS=$(pgrep -f "${TOMCAT_ROOT}" || true)',
    'if [ -n "${TOMCAT_PIDS}" ]; then',
    '  echo "  Tomcat 仍在运行，终止进程: ${TOMCAT_PIDS}"',
    '  kill ${TOMCAT_PIDS} || true',
    '  sleep 3',
    'fi',
    '',
    'mkdir -p "${WEBAPPS_DIR}"',
    'if [ -f "${TARGET_WAR}" ]; then',
    '  BACKUP_WAR="${TARGET_WAR}.$(date +%Y%m%d%H%M%S).bak"',
    '  echo "备份旧 WAR: ${BACKUP_WAR}"',
    '  cp -f "${TARGET_WAR}" "${BACKUP_WAR}"',
    'fi',
    'echo "清理目标项目展开目录: ${TARGET_DIR}"',
    'rm -rf "${TARGET_DIR}"',
    'echo "替换 WAR: ${SOURCE_WAR} -> ${TARGET_WAR}"',
    'cp -f "${SOURCE_WAR}" "${TARGET_WAR}"',
    '',
    'echo "启动 Tomcat..."',
    'if [ -x "${TOMCAT_ROOT}/bin/startup.sh" ]; then',
    '  "${TOMCAT_ROOT}/bin/startup.sh"',
    'elif [ -f "${TOMCAT_ROOT}/bin/startup.sh" ]; then',
    '  sh "${TOMCAT_ROOT}/bin/startup.sh"',
    'else',
    '  echo "未找到 startup.sh，WAR 已替换，请手动启动 Tomcat。" >&2',
    '  exit 1',
    'fi',
    'echo "等待 Tomcat 和应用启动（最多 180 秒）..."',
    'TOMCAT_HEALTH_URL="http://127.0.0.1:${TOMCAT_HTTP_PORT}/${TOMCAT_CONTEXT}/index/index.html"',
    'TOMCAT_DEADLINE=$((SECONDS + 180))',
    'TOMCAT_HTTP_CODE=""',
    'while [ "${SECONDS}" -lt "${TOMCAT_DEADLINE}" ]; do',
    '  if ! pgrep -f "${TOMCAT_ROOT}" >/dev/null 2>&1; then',
    '    echo "Tomcat 进程已退出。" >&2',
    '    tail -n 200 "${TOMCAT_ROOT}/logs/catalina.out" 2>/dev/null || true',
    '    exit 1',
    '  fi',
    '  if command -v curl >/dev/null 2>&1; then',
    '    TOMCAT_HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 5 "${TOMCAT_HEALTH_URL}" || true)',
    '    case "${TOMCAT_HTTP_CODE}" in',
    '      2??|3??) break ;;',
    '    esac',
    '  elif command -v ss >/dev/null 2>&1 && ss -lnt | grep -q ":${TOMCAT_HTTP_PORT} "; then',
    '    TOMCAT_HTTP_CODE="PORT_OPEN"',
    '    break',
    '  fi',
    '  sleep 3',
    'done',
    'if [ -z "${TOMCAT_HTTP_CODE}" ] || [ "${TOMCAT_HTTP_CODE}" = "000" ] || [[ "${TOMCAT_HTTP_CODE}" =~ ^[45] ]]; then',
    '  echo "Tomcat 应用未在 180 秒内通过检查: ${TOMCAT_HEALTH_URL} (HTTP ${TOMCAT_HTTP_CODE:-无响应})" >&2',
    '  tail -n 200 "${TOMCAT_ROOT}/logs/catalina.out" 2>/dev/null || true',
    '  exit 1',
    'fi',
    'echo "Tomcat 应用检查通过: ${TOMCAT_HEALTH_URL} (HTTP ${TOMCAT_HTTP_CODE})"',
    `echo "Tomcat 自动更新完成，访问地址: http://${project.deploy.host}:${project.deploy.appPort}/${tomcatContext}/"`,
    '',
  ];
}

function windowsTomcatDeployBlock(project: Project, params: DeployScriptParams, warFileName: string): string[] {
  const tomcatRoot = getTomcatRoot(project, params);
  const tomcatContext = getTomcatContext(project, params);
  const installTomcat = enabled(params.installTomcat, true);
  if (!params.autoDeployTomcat || !tomcatRoot.trim()) return [];

  return [
    '# ---- 1.3 自动更新 Tomcat ----',
    'Write-Host "开始自动更新 Tomcat..."',
    `$TomcatRoot = "${tomcatRoot.replace(/"/g, '`"')}"`,
    `$TomcatContext = if ($env:TOMCAT_CONTEXT) { $env:TOMCAT_CONTEXT } else { "${tomcatContext.replace(/"/g, '`"')}" }`,
    `$SourceWar = Join-Path (Get-Location) "${warFileName}"`,
    '$WebappsDir = Join-Path $TomcatRoot "webapps"',
    '$TargetWar = Join-Path $WebappsDir ($TomcatContext + ".war")',
    '$TargetDir = Join-Path $WebappsDir $TomcatContext',
    `$TomcatHttpPort = "${project.deploy.appPort || 8080}"`,
    `$InstallTomcat = ${installTomcat ? '$true' : '$false'}`,
    '',
    'if (-not (Test-Path $TomcatRoot) -or -not (Test-Path $WebappsDir)) {',
    '  if (-not $InstallTomcat) { throw "Tomcat 根目录不完整，且未选择安装/更新 Tomcat: $TomcatRoot" }',
    '  $TomcatArchive = Get-ChildItem -Path (Get-Location) -Filter "apache-tomcat-*.zip" | Select-Object -First 1',
    '  if (-not $TomcatArchive) { throw "Tomcat 根目录不完整，且部署包中未找到 apache-tomcat-*.zip: $TomcatRoot" }',
    '  Write-Host "Tomcat 根目录不完整，开始从 $($TomcatArchive.Name) 安装到 $TomcatRoot..."',
    '  $TomcatTmp = Join-Path $env:TEMP ("apache-tomcat-" + [Guid]::NewGuid().ToString("N"))',
    '  Remove-Item -Recurse -Force -Path $TomcatTmp -ErrorAction SilentlyContinue',
    '  New-Item -ItemType Directory -Force -Path $TomcatTmp | Out-Null',
    '  Expand-Archive -Path $TomcatArchive.FullName -DestinationPath $TomcatTmp -Force',
    '  $TomcatUnpacked = Get-ChildItem -Path $TomcatTmp -Directory | Select-Object -First 1',
    '  if (-not $TomcatUnpacked) { throw "Tomcat 压缩包解压后未找到目录: $($TomcatArchive.FullName)" }',
    '  $TomcatParent = Split-Path -Parent $TomcatRoot',
    '  New-Item -ItemType Directory -Force -Path $TomcatParent | Out-Null',
    '  if ((Test-Path $TomcatRoot) -and -not (Test-Path $WebappsDir)) {',
    '    $ExistingItems = Get-ChildItem -Path $TomcatRoot -Force -ErrorAction SilentlyContinue | Select-Object -First 1',
    '    if ($ExistingItems) { throw "Tomcat 根目录已存在但不是有效 Tomcat，且目录非空。为避免误删，请检查路径: $TomcatRoot" }',
    '  }',
    '  Remove-Item -Recurse -Force -Path $TomcatRoot -ErrorAction SilentlyContinue',
    '  Move-Item -Path $TomcatUnpacked.FullName -Destination $TomcatRoot -Force',
    '  Remove-Item -Recurse -Force -Path $TomcatTmp -ErrorAction SilentlyContinue',
    '  Write-Host "Tomcat 已安装到 $TomcatRoot"',
    '}',
    'if (-not (Test-Path $WebappsDir)) { throw "Tomcat webapps 目录不存在: $WebappsDir" }',
    '$ServerXml = Join-Path $TomcatRoot "conf\\server.xml"',
    'if (-not (Test-Path $ServerXml)) { throw "Tomcat server.xml 不存在: $ServerXml" }',
    'Write-Host "配置 Tomcat HTTP 端口: $TomcatHttpPort"',
    '$ServerXmlBackup = $ServerXml + "." + (Get-Date -Format "yyyyMMddHHmmss") + ".bak"',
    'Copy-Item -Force -Path $ServerXml -Destination $ServerXmlBackup',
    '$ServerXmlText = Get-Content -Raw -Path $ServerXml',
    '$MaskedServerXmlText = [regex]::Replace($ServerXmlText, \'<!--[\\s\\S]*?-->\', { param($Match) " " * $Match.Length })',
    '$ConnectorMatches = [regex]::Matches($MaskedServerXmlText, \'<Connector\\b[^>]*>\', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Singleline)',
    'foreach ($ConnectorMatch in $ConnectorMatches) {',
    '  $ConnectorTag = $ServerXmlText.Substring($ConnectorMatch.Index, $ConnectorMatch.Length)',
    '  $ProtocolMatch = [regex]::Match($ConnectorTag, \'\\bprotocol\\s*=\\s*"([^"]+)"\', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)',
    '  $Protocol = if ($ProtocolMatch.Success) { $ProtocolMatch.Groups[1].Value } else { "" }',
    '  if ($Protocol -and $Protocol -ne "HTTP/1.1" -and $Protocol -notmatch \'http11\') { continue }',
    '  $UpdatedConnectorTag = [regex]::Replace($ConnectorTag, \'(\\bport\\s*=\\s*")\\d+(")\', { param($Match) $Match.Groups[1].Value + $TomcatHttpPort + $Match.Groups[2].Value }, 1)',
    '  if ($UpdatedConnectorTag -ne $ConnectorTag) {',
    '    $UpdatedServerXmlText = $ServerXmlText.Substring(0, $ConnectorMatch.Index) + $UpdatedConnectorTag + $ServerXmlText.Substring($ConnectorMatch.Index + $ConnectorMatch.Length)',
    '    Set-Content -Path $ServerXml -Value $UpdatedServerXmlText -Encoding UTF8',
    '    break',
    '  }',
    '}',
    'if (-not (Test-Path $SourceWar)) { throw "部署包中缺少 WAR 文件: $SourceWar" }',
    "if ([string]::IsNullOrWhiteSpace($TomcatContext) -or $TomcatContext -in @('.', '..') -or $TomcatContext.Contains('/') -or $TomcatContext.Contains('\\')) {",
    '  throw "非法项目名: $TomcatContext。只允许单个项目名，例如 agent 或 knowledge-center。"',
    '}',
    "$WebappsFull = [IO.Path]::GetFullPath($WebappsDir).TrimEnd('\\').ToLowerInvariant()",
    "$TargetParentFull = [IO.Path]::GetFullPath((Split-Path -Parent $TargetDir)).TrimEnd('\\').ToLowerInvariant()",
    'if ($TargetParentFull -ne $WebappsFull) {',
    '  throw "安全检查失败：目标目录不在 webapps 下: $TargetDir"',
    '}',
    '',
    'Write-Host "停止 Tomcat..."',
    '$ShutdownBat = Join-Path $TomcatRoot "bin\\shutdown.bat"',
    'if (Test-Path $ShutdownBat) {',
    '  Start-Process -FilePath $ShutdownBat -WorkingDirectory (Join-Path $TomcatRoot "bin") -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue',
    '} else {',
    '  Write-Host "  未找到 shutdown.bat，跳过优雅停止。"',
    '}',
    'Start-Sleep -Seconds 5',
    "$Needle = [IO.Path]::GetFullPath($TomcatRoot).Replace('/', '\\').ToLowerInvariant()",
    '$TomcatProcesses = Get-CimInstance Win32_Process | Where-Object {',
    "  ($_.Name -eq 'java.exe' -or $_.Name -eq 'javaw.exe') -and $_.CommandLine -and $_.CommandLine.Replace('/', '\\').ToLowerInvariant().Contains($Needle)",
    '}',
    'foreach ($Proc in $TomcatProcesses) {',
    '  Write-Host ("  Tomcat 仍在运行，终止进程: {0}" -f $Proc.ProcessId)',
    '  Stop-Process -Id $Proc.ProcessId -Force -ErrorAction SilentlyContinue',
    '}',
    '',
    'if (Test-Path $TargetWar) {',
    '  $BackupWar = $TargetWar + "." + (Get-Date -Format "yyyyMMddHHmmss") + ".bak"',
    '  Write-Host "备份旧 WAR: $BackupWar"',
    '  Copy-Item -Force -Path $TargetWar -Destination $BackupWar',
    '}',
    'Write-Host "清理目标项目展开目录: $TargetDir"',
    'Remove-Item -Recurse -Force -Path $TargetDir -ErrorAction SilentlyContinue',
    'Write-Host "替换 WAR: $SourceWar -> $TargetWar"',
    'Copy-Item -Force -Path $SourceWar -Destination $TargetWar',
    '',
    'Write-Host "启动 Tomcat..."',
    '$StartupBat = Join-Path $TomcatRoot "bin\\startup.bat"',
    'if (Test-Path $StartupBat) {',
    '  Start-Process -FilePath $StartupBat -WorkingDirectory (Join-Path $TomcatRoot "bin") -WindowStyle Hidden',
    '} else {',
    '  throw "未找到 startup.bat，WAR 已替换，请手动启动 Tomcat。"',
    '}',
    'Start-Sleep -Seconds 5',
    `Write-Host "Tomcat 自动更新完成，访问地址: http://${project.deploy.host}:${project.deploy.appPort}"`,
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

  lines.push(...python310RuntimeInstallBlock());
  lines.push(...nodeRuntimeInstallBlock());
  lines.push(...bubblewrapInstallBlock(project));

  if (params.installOnestopRuntime || params.installSandboxRuntime || params.autoDeployTomcat) {
    lines.push(...jdk17InstallBlock());
  }

  if (params.installOnestopRuntime || params.installSandboxRuntime || enabled(params.updateHyperAgent, false)) {
    lines.push(...onestopRuntimeInstallBlock(project, params));
  }

  if (enabled(params.prepareAgentDirs, true)) {
    lines.push(
      '# ---- 1.2 创建/修复 Agent 基础目录 ----',
      'echo "创建/修复 Agent 基础目录..."',
      'mkdir -p /fskj/workspace/agent/',
      'mkdir -p /fskj/workspace/agent/logs/',
      'mkdir -p /fskj/workspace/agent/agent/',
      'mkdir -p /fskj/workspace/agent/agent-conversation/',
      'mkdir -p /fskj/workspace/agent/component/',
      'mkdir -p /fskj/workspace/agent/sandbox/',
      'mkdir -p /fskj/workspace/agent/skill-storage/',
      '',
    );
  }

  if (enabled(params.updateHyperAgent, true)) {
    lines.push(
      '# ---- 1.3 创建/修复 onestop-runtime 安全目录 ----',
      'echo "创建/修复 onestop-runtime 安全目录..."',
      'mkdir -p /fskj/workspace/agent/onestop-runtime-secrets/',
      '',
    );
  }

  if (enabled(params.updateToolScript, true)) {
    lines.push(
      '# ---- 1.4 更新外挂 tool-script ----',
      'echo "更新外挂 tool-script..."',
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
  }

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

  if (params.updateOneapiCache && !params.deployOneapi) {
    lines.push(
      '# ---- 更新 OneApi tiktoken/cache ----',
      'echo "更新 OneApi tiktoken/cache..."',
      `ONEAPI_DATA_DIR="/fskj/workspace/oneapi-${project.code}"`,
      'mkdir -p "${ONEAPI_DATA_DIR}/tiktoken"',
      'if [ -f "./cache.zip" ]; then',
      '  if command -v unzip >/dev/null 2>&1; then',
      '    unzip -q -o ./cache.zip -d "${ONEAPI_DATA_DIR}/tiktoken"',
      '    echo "  OneApi cache 已更新到 ${ONEAPI_DATA_DIR}/tiktoken"',
      '  else',
      '    echo "  未找到 unzip 命令，跳过 cache.zip 解压，请手动放入 ${ONEAPI_DATA_DIR}/tiktoken。" >&2',
      '  fi',
      'else',
      '  echo "  未随包提供 cache.zip，跳过 OneApi cache 更新。"',
      'fi',
      '',
    );
  }

  lines.push(...linuxTomcatDeployBlock(project, params, warFileName));

  if (!params.autoDeployTomcat || !getTomcatRoot(project, params).trim()) {
    lines.push(
      '# ---- WAR 部署提示 ----',
      `echo "已生成 WAR 文件: ${warFileName}"`,
      'echo "本脚本未启用 Tomcat 自动更新。"',
      'echo "请按现场发布流程将 WAR 放到 Tomcat webapps 或指定发布目录，并启动应用。"',
      '',
    );
  }

  lines.push(
    'echo "应用服务器准备脚本执行完成。"',
    `echo "应用启动后访问地址: http://${project.deploy.host}:${project.deploy.appPort}/${getTomcatContext(project, params)}/"`,
  );
  if (params.runDatabaseUpgrade === false) {
    lines.push('echo "数据库自动升级和数据库脚本均已禁用，无需执行 01/03 脚本。"');
  } else {
    lines.push('echo "如需初始化系统配置，请在应用启动并自动建表完成后执行 03-system-config.sh。"');
  }
  lines.push('');

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
    `$AgentRoot = "${agentRoot}"`,
    '',
  ];

  if (enabled(params.prepareAgentDirs, true)) {
    lines.push(
      '# ---- 1.2 创建/修复 Agent 基础目录 ----',
      'Write-Host "创建/修复 Agent 基础目录..."',
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
    );
  }

  if (enabled(params.updateHyperAgent, true)) {
    lines.push(
      '# ---- 1.3 创建/修复 onestop-runtime 安全目录 ----',
      'Write-Host "创建/修复 onestop-runtime 安全目录..."',
      'New-Item -ItemType Directory -Force -Path (Join-Path $AgentRoot "onestop-runtime-secrets") | Out-Null',
      '',
    );
  }

  if (enabled(params.updateToolScript, true)) {
    lines.push(
      '# ---- 1.4 更新外挂 tool-script ----',
      'Write-Host "更新外挂 tool-script..."',
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
    );
  }

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

  if (params.updateOneapiCache && !params.deployOneapi) {
    lines.push(
      '# ---- 更新 OneApi tiktoken/cache ----',
      'Write-Host "更新 OneApi tiktoken/cache..."',
      `$OneApiDataDir = "${agentRoot}\\oneapi-${project.code}"`,
      'New-Item -ItemType Directory -Force -Path (Join-Path $OneApiDataDir "tiktoken") | Out-Null',
      '$CacheZip = Join-Path (Get-Location) "cache.zip"',
      'if (Test-Path $CacheZip) {',
      '  Expand-Archive -Path $CacheZip -DestinationPath (Join-Path $OneApiDataDir "tiktoken") -Force',
      '  Write-Host "  OneApi cache 已更新到 $(Join-Path $OneApiDataDir "tiktoken")"',
      '} else {',
      '  Write-Host "  未随包提供 cache.zip，跳过 OneApi cache 更新。"',
      '}',
      '',
    );
  }

  lines.push(...windowsTomcatDeployBlock(project, params, warFileName));

  if (!params.autoDeployTomcat || !getTomcatRoot(project, params).trim()) {
    lines.push(
      '# ---- WAR 部署提示 ----',
      `Write-Host "已生成 WAR 文件: ${warFileName}"`,
      'Write-Host "本脚本未启用 Tomcat 自动更新。"',
      'Write-Host "请按现场发布流程将 WAR 放到 Tomcat webapps 或指定发布目录，并启动应用。"',
      '',
    );
  }

  lines.push(
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
  const tomcatRoot = getTomcatRoot(project, _params);
  const tomcatContext = getTomcatContext(project, _params);
  const lines = [
    '#!/bin/bash',
    'set -Eeuo pipefail',
    '',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'cd "${SCRIPT_DIR}"',
    'LOG_FILE="${SCRIPT_DIR}/deploy-$(date +%Y%m%d-%H%M%S).log"',
    'exec > >(tee -a "${LOG_FILE}") 2>&1',
    'trap \'code=$?; echo "一键部署失败（exit=${code}），日志: ${LOG_FILE}" >&2; exit ${code}\' ERR',
    'echo ""',
    'echo "========================================"',
    `echo " 一键部署: ${project.name} (${project.code})"`,
    'echo "========================================"',
    'echo "数据库位于其他服务器，本次不会执行任何数据库脚本。"',
    'echo "已跳过: 01-db-create.sh、03-system-config.sh"',
    'echo ""',
  ];

  if (appScriptName.endsWith('.ps1')) {
    lines.push(
      'if ! command -v powershell.exe >/dev/null 2>&1; then',
      '  echo "当前包面向 Windows 应用服务器，请在 PowerShell 中执行 02-app-deploy.ps1。" >&2',
      '  exit 1',
      'fi',
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "\${SCRIPT_DIR}/${appScriptName}"`,
    );
  } else {
    lines.push(
      `if [ ! -f "\${SCRIPT_DIR}/${appScriptName}" ]; then`,
      `  echo "部署包缺少应用部署脚本: ${appScriptName}" >&2`,
      '  exit 1',
      'fi',
      `chmod +x "\${SCRIPT_DIR}/${appScriptName}"`,
      `bash "\${SCRIPT_DIR}/${appScriptName}"`,
    );
  }

  lines.push('', 'echo ""');
  if (_params.autoDeployTomcat && tomcatRoot.trim()) {
    lines.push(
      `echo "Tomcat 发布位置: ${tomcatRoot}/webapps/${tomcatContext}.war"`,
      `echo "Tomcat 应用目录: ${tomcatRoot}/webapps/${tomcatContext}"`,
    );
  }

  lines.push(
    `echo "一键部署成功，应用地址: http://${project.deploy.host}:${project.deploy.appPort}/${tomcatContext}/"`,
    'echo "数据库脚本未执行。"',
    'echo "部署日志: ${LOG_FILE}"',
    '',
  );
  return lines.join('\n');
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
