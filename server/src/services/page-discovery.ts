/**
 * 页面自动发现服务
 *
 * 从 discover.js 迁移，服务端运行时调用 Playwright 发现 Vue Router 路由。
 * 支持：运行时探测（登录 + 子应用入口探测 + Vue Router 提取）、源码分析、自动分组。
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  type TestProject,
  type PageSet,
  type PageConfig,
  getProjectById,
  updateProjectPages,
} from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

// ========== 类型 ==========

export interface DiscoveryProgress {
  stage: 'init' | 'login' | 'probing' | 'extracting' | 'grouping' | 'done' | 'error';
  message: string;
  detail?: any;
}

export interface DiscoveryResult {
  pageSets: PageSet[];
  rawRoutes: Record<string, EntryRoutes>;
  validEntries: string[];
  totalPages: number;
}

interface EntryRoutes {
  title?: string;
  url?: string;
  routeCount?: number;
  paramValues?: Record<string, string>;
  routes?: RouteInfo[];
  error?: string;
}

interface RouteInfo {
  path: string;
  name: string;
  title: string;
  layout: string;
  hasParams: boolean;
  concreteUrl?: string;
  paramValues?: Record<string, string>;
}

// ========== 常见入口名 ==========

const COMMON_ENTRIES = [
  'web', 'admin', 'index', 'chat', 'setting-system', 'setting-app',
  'manage', 'dashboard', 'setting', 'portal', 'app', 'mobile',
];

// ========== 源码分析 ==========

function discoverFromSource(sourcePath: string): string[] {
  const entries: string[] = [];

  try {
    // 1. 读 vite.config.ts
    const viteConfigPath = path.join(sourcePath, 'frontend', 'vite.config.ts');
    if (fs.existsSync(viteConfigPath)) {
      const content = fs.readFileSync(viteConfigPath, 'utf-8');
      const inputMatch = content.match(/input:\s*\{([\s\S]*?)\}/);
      if (inputMatch) {
        const inputBlock = inputMatch[1];
        const entryMatches = inputBlock.matchAll(/['"]?(\w[\w-]*)['"]?\s*:/g);
        for (const m of entryMatches) {
          if (m[1] !== 'index') entries.push(m[1]);
        }
        if (inputBlock.includes("'index'") || inputBlock.includes('"index"')) {
          entries.unshift('index');
        }
      }
    }

    // 2. 扫描 pages 目录
    const pagesDir = path.join(sourcePath, 'frontend', 'src', 'pages');
    if (fs.existsSync(pagesDir)) {
      const dirs = fs.readdirSync(pagesDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && fs.existsSync(path.join(pagesDir, d.name, 'index.html')))
        .map(d => d.name);
      for (const dir of dirs) {
        if (!entries.includes(dir)) entries.push(dir);
      }
    }

    // 3. 检查 admin 独立构建
    const adminVite = path.join(sourcePath, 'frontend-admin', 'vite.config.ts');
    if (fs.existsSync(adminVite) && !entries.includes('admin')) {
      entries.push('admin');
    }
  } catch (e: any) {
    console.warn('[discovery] 源码分析失败:', e.message);
  }

  return entries;
}

// ========== 运行时探测 ==========

async function loginToProject(page: Page, project: TestProject): Promise<boolean> {
  const baseUrl = project.baseUrl.replace(/\/+$/, '');

  // 尝试多种登录页 URL
  const loginUrls = [
    `${baseUrl}${project.loginUrl}`,
    `${baseUrl}/web/index.html#/login`,
    `${baseUrl}/index/index.html#/login`,
    `${baseUrl}/login`,
  ];

  for (const loginUrl of loginUrls) {
    try {
      await page.goto(loginUrl, { timeout: 10000 });

      const hasLoginForm = await page.locator(
        'input[placeholder*="用户名"], input[placeholder*="username"], input[type="text"]'
      ).count();

      if (hasLoginForm > 0) {
        // 填写登录
        const userInput = page.locator(
          'input[placeholder*="用户名"], input[placeholder*="username"], input[type="text"]'
        ).first();
        const passInput = page.locator(
          'input[placeholder*="密码"], input[placeholder*="password"], input[type="password"]'
        ).first();
        const submitBtn = page.locator('button', { hasText: /登录|Login|登 录/ }).first();

        await userInput.fill(project.username);
        await passInput.fill(project.password);
        await submitBtn.click();
        await page.waitForTimeout(2000);

        // 检查是否登录成功
        const currentUrl = page.url();
        if (!currentUrl.includes('login')) {
          return true;
        }
      }
    } catch {
      // 尝试下一个
    }
  }

  return false;
}

interface DeployInfo {
  origin: string;
  deployRoot: string;
  currentSubApp: string;
}

function parseDeployRoot(url: string): DeployInfo {
  const urlObj = new URL(url);
  const fullPath = urlObj.pathname;
  const pathWithoutFile = fullPath.replace(/\/index\.html.*$/, '');
  const pathSegments = pathWithoutFile.split('/').filter(Boolean);

  // 多段路径（如 /agent_audio/web）：最后一段是子应用名，前面是部署根
  // 单段路径（如 /web 或 /index）：部署根为 /，唯一段就是子应用名
  const deployRoot = pathSegments.length > 1
    ? '/' + pathSegments.slice(0, -1).join('/') + '/'
    : '/';

  const currentSubApp = pathSegments[pathSegments.length - 1] || 'web';

  return { origin: urlObj.origin, deployRoot, currentSubApp };
}

async function probeEntries(
  page: Page,
  origin: string,
  deployRoot: string,
  entries: string[],
  onProgress?: (msg: string) => void,
): Promise<string[]> {
  const validEntries: string[] = [];

  for (const entry of entries) {
    const entryUrl = `${origin}${deployRoot}${entry}/index.html`;
    try {
      await page.goto(entryUrl, { timeout: 8000, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      // 通过检查实际 Vue 实例来判断是否是有效的独立应用
      // 这能正确区分本地 Vite SPA 模式（所有路径返回同一 index.html）
      const hasVueApp = await page.evaluate(() => {
        const app = document.querySelector('#app');
        if (!app) return false;
        // 检查 Vue 是否实际挂载了内容（有子节点说明 Vue 渲染了）
        const vueApp = (app as any).__vue_app__;
        if (vueApp) return true;
        // 即使没有 __vue_app__，如果 #app 下有实际内容也算有效（某些构建方式）
        return app.children.length > 0 && app.innerHTML !== '';
      });

      if (hasVueApp) {
        validEntries.push(entry);
        onProgress?.(`  ✅ ${entry} — 有效 Vue 应用`);
      } else {
        onProgress?.(`  ❌ ${entry} — Vue 未挂载`);
      }
    } catch (e: any) {
      onProgress?.(`  ❌ ${entry} — ${e.message?.substring(0, 60)}`);
    }
  }

  return validEntries;
}

async function extractRoutes(
  page: Page,
  origin: string,
  deployRoot: string,
  entry: string,
): Promise<EntryRoutes> {
  const entryUrl = `${origin}${deployRoot}${entry}/index.html`;

  try {
    await page.goto(entryUrl, { timeout: 10000, waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const routesData = await page.evaluate(() => {
      const app = document.querySelector('#app') as any;
      if (!app?.__vue_app__) return { error: 'no vue app' };

      const router = app.__vue_app__.config?.globalProperties?.$router;
      if (!router) return { error: 'no router' };

      const routes = router.getRoutes();
      const currentPath = location.hash.replace('#', '');
      const pathSegments = currentPath.split('/').filter(Boolean);

      return {
        title: document.title,
        url: location.href,
        routeCount: routes.length,
        pathSegments,
        routes: routes.map((r: any) => ({
          path: r.path,
          name: r.name || '',
          title: r.meta?.title || '',
          layout: r.meta?.layout || '',
          hasParams: r.path.includes(':'),
        })),
      };
    });

    if ((routesData as any).error) {
      return { error: (routesData as any).error, url: entryUrl };
    }

    const data = routesData as any;

    // 解析动态参数
    const paramValues: Record<string, string> = {};
    if (data.pathSegments?.length > 0) {
      const currentRoute = data.routes.find((r: any) => {
        const segments = r.path.split('/').filter(Boolean);
        if (segments.length !== data.pathSegments.length) return false;
        return segments.every((seg: string, i: number) => seg.startsWith(':') || seg === data.pathSegments[i]);
      });
      if (currentRoute) {
        const templateSegments = currentRoute.path.split('/').filter(Boolean);
        templateSegments.forEach((seg: string, i: number) => {
          if (seg.startsWith(':')) {
            paramValues[seg] = data.pathSegments[i];
          }
        });
      }
    }

    // 展开动态路由
    const expandedRoutes: RouteInfo[] = data.routes.map((r: any) => {
      let concretePath = r.path;
      for (const [param, value] of Object.entries(paramValues)) {
        concretePath = concretePath.replace(param, value);
      }
      return {
        ...r,
        concreteUrl: `/${entry}/index.html#${concretePath}`,
        paramValues,
      };
    });

    return {
      title: data.title,
      url: entryUrl,
      routeCount: data.routeCount,
      paramValues,
      routes: expandedRoutes,
    };
  } catch (e: any) {
    return { error: e.message, url: entryUrl };
  }
}

// ========== 自动分组 ==========

function groupRoutes(routesMap: Record<string, EntryRoutes>): { pageSets: PageSet[]; totalPages: number } {
  const allPageSets: PageSet[] = [];
  let totalPages = 0;

  for (const [entry, data] of Object.entries(routesMap)) {
    if (data.error || !data.routes) continue;

    // 过滤掉根路由、登录页
    const testableRoutes = data.routes.filter(r =>
      r.path !== '/' &&
      r.path !== '/login' &&
      !(r.path.endsWith('/') && r.path.length > 1)
    );

    // 按路径前缀分组
    const groups: Record<string, { pages: PageConfig[] }> = {};

    for (const route of testableRoutes) {
      const segments = route.path.split('/').filter(Boolean);
      const firstRealSegment = segments.find(s => !s.startsWith(':')) || segments[0] || 'root';

      let groupId: string;
      if (segments.length <= 1) {
        groupId = firstRealSegment;
      } else if (segments[0].startsWith(':')) {
        groupId = segments[1] || firstRealSegment;
      } else {
        groupId = segments[0];
      }

      if (!groups[groupId]) {
        groups[groupId] = { pages: [] };
      }

      groups[groupId].pages.push({
        id: `${entry}-${route.name || groupId}-${groups[groupId].pages.length}`,
        name: route.title || route.name || route.path,
        url: route.concreteUrl || `/${entry}/index.html#${route.path}`,
        path: route.path,
      });
    }

    for (const [groupId, group] of Object.entries(groups)) {
      allPageSets.push({
        id: `${entry}-${groupId}`,
        name: `${groupId} (${entry}, ${group.pages.length}页)`,
        pages: group.pages,
      });
    }

    totalPages += testableRoutes.length;
  }

  return { pageSets: allPageSets, totalPages };
}

// ========== 知识库骨架生成 ==========

interface PageContextEntry {
  pageName: string;
  url: string;
  description: string;
  expectedElements: string[];
  apiEndpoints: { method: string; path: string; description: string }[];
  interactions: { action: string; expected: string }[];
  commonIssues: string[];
}

/** 根据页面路径推断通用的页面描述 */
function inferPageDescription(pageName: string, pagePath: string): string {
  const nameMap: Record<string, string> = {
    '代码管理': '系统代码/字典管理页面，支持代码的增删改查',
    '配置管理': '系统参数配置页面，管理键值对形式的配置项',
    '数据源管理': '数据库连接管理页面，支持配置和测试数据库连接',
    '用户管理': '用户管理页面，支持用户的增删改查和角色分配',
    '角色管理': '角色权限管理页面，管理角色及其权限配置',
    '资源管理': '系统资源/菜单管理页面',
    '模型管理': 'AI模型管理页面，配置和管理可用的模型',
    '插件管理': '插件管理页面，管理系统中的插件',
    '任务管理': '任务管理页面，管理定时任务和数据同步',
  };

  if (nameMap[pageName]) return nameMap[pageName];
  return `${pageName}页面`;
}

/** 根据页面名称推断常见的 UI 元素 */
function inferExpectedElements(pageName: string): string[] {
  const base = ['数据表格'];
  if (pageName.includes('管理') || pageName.includes('列表')) {
    base.push('搜索框', '新增按钮', '操作按钮(编辑/删除)', '分页组件');
  }
  if (pageName.includes('配置') || pageName.includes('设置')) {
    base.push('搜索框', '新增按钮', '操作按钮');
  }
  if (pageName.includes('文件') || pageName.includes('存储')) {
    base.push('上传按钮');
  }
  if (pageName.includes('数据源') || pageName.includes('数据库')) {
    base.push('测试连接按钮');
  }
  if (base.length <= 1) {
    base.push('搜索框', '操作按钮', '分页组件');
  }
  return base;
}

/** 生成 page-context.json 并保存到项目的数据目录 */
function generatePageContext(projectId: string, pageSets: PageSet[], baseUrl: string): void {
  const context: Record<string, PageContextEntry> = {};

  for (const ps of pageSets) {
    for (const page of ps.pages) {
      context[page.id] = {
        pageName: page.name,
        url: `${baseUrl}${page.url}`,
        description: inferPageDescription(page.name, page.path),
        expectedElements: inferExpectedElements(page.name),
        apiEndpoints: [],   // 待 AI 或手动补充
        interactions: [],   // 待 AI 或手动补充
        commonIssues: [],   // 待 AI 或手动补充
      };
    }
  }

  // 保存到 data/projects/{projectId}/page-context.json
  const projectDir = path.join(DATA_DIR, 'projects', projectId);
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
  const outputPath = path.join(projectDir, 'page-context.json');
  fs.writeFileSync(outputPath, JSON.stringify(context, null, 2), 'utf-8');

  console.log(`[discovery] 知识库骨架已生成: ${outputPath} (${Object.keys(context).length} 页)`);
}

/**
 * 执行页面发现
 * @param projectId 项目 ID
 * @param mode 发现模式: runtime | source | both
 * @param onProgress 进度回调（用于 SSE 推送）
 */
export async function discoverPages(
  projectId: string,
  mode: 'runtime' | 'source' | 'both' = 'runtime',
  onProgress?: (progress: DiscoveryProgress) => void,
): Promise<DiscoveryResult> {
  const project = getProjectById(projectId);
  if (!project) {
    onProgress?.({ stage: 'error', message: `项目不存在: ${projectId}` });
    throw new Error(`项目不存在: ${projectId}`);
  }

  onProgress?.({ stage: 'init', message: '正在启动浏览器...' });

  let knownEntries: string[] = [];

  // 源码分析（可选）
  if ((mode === 'source' || mode === 'both') && project.sourcePath) {
    onProgress?.({ stage: 'probing', message: `正在分析源码: ${project.sourcePath}` });
    knownEntries = discoverFromSource(project.sourcePath);
    onProgress?.({ stage: 'probing', message: `源码发现 ${knownEntries.length} 个入口: ${knownEntries.join(', ')}` });
  }

  // 运行时探测
  const browser: Browser = await chromium.launch({ headless: true });
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page: Page = await context.newPage();

  const routesMap: Record<string, EntryRoutes> = {};

  try {
    // 1. 登录
    onProgress?.({ stage: 'login', message: '正在登录...' });
    const loginOk = await loginToProject(page, project);
    if (!loginOk) {
      onProgress?.({ stage: 'error', message: '登录失败，请检查用户名密码和登录页路径' });
      throw new Error('登录失败');
    }
    onProgress?.({ stage: 'login', message: '登录成功' });

    // 2. 推断部署根路径
    const deployInfo = parseDeployRoot(page.url());
    onProgress?.({
      stage: 'probing',
      message: `部署根路径: ${deployInfo.origin}${deployInfo.deployRoot}`,
    });

    // 3. 探测子应用入口
    const entriesToProbe = [...new Set([...knownEntries, ...COMMON_ENTRIES, deployInfo.currentSubApp])];
    onProgress?.({ stage: 'probing', message: `探测 ${entriesToProbe.length} 个可能的入口...` });

    const validEntries = await probeEntries(
      page, deployInfo.origin, deployInfo.deployRoot, entriesToProbe,
      (msg) => onProgress?.({ stage: 'probing', message: msg }),
    );

    onProgress?.({
      stage: 'probing',
      message: `发现 ${validEntries.length} 个有效入口: ${validEntries.join(', ')}`,
    });

    // 4. 提取路由
    for (const entry of validEntries) {
      onProgress?.({ stage: 'extracting', message: `正在提取 ${entry} 的路由...` });
      const result = await extractRoutes(page, deployInfo.origin, deployInfo.deployRoot, entry);
      routesMap[entry] = result;

      if (result.routes) {
        onProgress?.({
          stage: 'extracting',
          message: `${entry}: ${result.routeCount} 条路由 (${result.title || 'unknown'})`,
          detail: { entry, routeCount: result.routeCount, paramValues: result.paramValues },
        });
      } else {
        onProgress?.({ stage: 'extracting', message: `${entry}: ❌ ${result.error}` });
      }
    }

    // 5. 分组
    onProgress?.({ stage: 'grouping', message: '正在分组整理...' });
    const { pageSets, totalPages } = groupRoutes(routesMap);

    onProgress?.({
      stage: 'done',
      message: `发现完成: ${pageSets.length} 个页面集, ${totalPages} 个可测试页面`,
      detail: { pageSetCount: pageSets.length, totalPages, validEntries },
    });

    // 6. 更新项目配置
    updateProjectPages(projectId, pageSets, routesMap);

    // 7. 生成知识库骨架
    onProgress?.({ stage: 'grouping', message: '正在生成知识库骨架...' });
    generatePageContext(projectId, pageSets, project.baseUrl);

    return { pageSets, rawRoutes: routesMap, validEntries, totalPages };
  } catch (err: any) {
    onProgress?.({ stage: 'error', message: `发现失败: ${err.message}` });
    throw err;
  } finally {
    await context.close();
    await browser.close();
  }
}
