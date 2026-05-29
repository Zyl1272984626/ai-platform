/**
 * 页面自动发现脚本
 *
 * 双模式发现：
 * - 模式 A（源码分析）：读 vite.config.ts 的 rollupOptions.input，解析所有子应用入口
 * - 模式 B（运行时探测）：对每个入口导航，提取 Vue Router getRoutes()
 *
 * 用法：node discover.js --url https://xxx --username xxx --password xxx [--source C:/path/to/project]
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ========== 参数解析 ==========
function getArg(key) {
  const idx = process.argv.indexOf(key);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

const TARGET_URL = getArg('--url') || 'https://www.topspeeder.net.cn/agent_audio';
const USERNAME = getArg('--username') || 'fskjadmin';
const PASSWORD = getArg('--password') || 'fskj_dst_2023';
const SOURCE_PATH = getArg('--source'); // 可选：源码路径
const OUTPUT = getArg('--output') || path.join(__dirname, '..', 'data', 'discovery-result.json');

// ========== 模式 A：源码分析 ==========

/**
 * 从 vite.config.ts 读取所有子应用入口
 * 解析 rollupOptions.input 对象，返回入口名称列表
 */
function discoverFromSource(sourcePath) {
  const entries = [];

  try {
    // 1. 读 vite.config.ts
    const viteConfigPath = path.join(sourcePath, 'frontend', 'vite.config.ts');
    if (fs.existsSync(viteConfigPath)) {
      const content = fs.readFileSync(viteConfigPath, 'utf-8');

      // 解析 rollupOptions.input: { name: resolve(...), ... }
      const inputMatch = content.match(/input:\s*\{([\s\S]*?)\}/);
      if (inputMatch) {
        const inputBlock = inputMatch[1];
        const entryMatches = inputBlock.matchAll(/['"]?(\w[\w-]*)['"]?\s*:/g);
        for (const m of entryMatches) {
          if (m[1] !== 'index') entries.push(m[1]);
        }
        // index 也是入口
        if (inputBlock.includes("'index'") || inputBlock.includes('"index"')) {
          entries.unshift('index');
        }
      }
    }

    // 2. 扫描 pages 目录（更可靠）
    const pagesDir = path.join(sourcePath, 'frontend', 'src', 'pages');
    if (fs.existsSync(pagesDir)) {
      const dirs = fs.readdirSync(pagesDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && fs.existsSync(path.join(pagesDir, d.name, 'index.html')))
        .map(d => d.name);

      // 用目录扫描结果补充（可能比 vite config 更全）
      for (const dir of dirs) {
        if (!entries.includes(dir)) entries.push(dir);
      }
    }

    // 3. 检查 admin 独立构建
    const adminVite = path.join(sourcePath, 'frontend-admin', 'vite.config.ts');
    if (fs.existsSync(adminVite)) {
      if (!entries.includes('admin')) entries.push('admin');
    }
    // 也检查 frontend/src/pages 下是否有 admin
    if (fs.existsSync(path.join(pagesDir || '', 'admin', 'index.html'))) {
      if (!entries.includes('admin')) entries.push('admin');
    }

    console.log(`[源码分析] 发现 ${entries.length} 个入口: ${entries.join(', ')}`);
  } catch (e) {
    console.warn(`[源码分析] 失败: ${e.message}`);
  }

  return entries;
}

/**
 * 从源码的 router 文件提取路由定义（更详细，含 meta 信息）
 */
function extractRoutesFromSource(sourcePath) {
  const routes = {};
  const pagesDir = path.join(sourcePath, 'frontend', 'src', 'pages');

  if (!fs.existsSync(pagesDir)) return routes;

  const subApps = fs.readdirSync(pagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const subApp of subApps) {
    const routerFile = path.join(pagesDir, subApp.name, 'router', 'index.js');
    if (!fs.existsSync(routerFile)) continue;

    try {
      const content = fs.readFileSync(routerFile, 'utf-8');
      // 简单解析 path: '/xxx' 和可能的 name/meta
      const pathRegex = /path:\s*['"]([^'"]+)['"]/g;
      const nameRegex = /name:\s*['"]([^'"]+)['"]/g;

      const subRoutes = [];
      let match;
      while ((match = pathRegex.exec(content)) !== null) {
        subRoutes.push({ path: match[1] });
      }

      routes[subApp.name] = subRoutes;
    } catch { /* skip */ }
  }

  return routes;
}

// ========== 模式 B：运行时探测 ==========

async function discoverFromRuntime(browser, baseUrl, username, password, knownEntries = []) {
  const results = {};
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    // Step 1: 登录
    console.log('[运行时] 登录中...');

    // 先尝试确定登录页 URL
    const loginUrls = [
      `${baseUrl}/web/index.html#/login`,
      `${baseUrl}/index/index.html#/login`,
      `${baseUrl}/login`,
    ];

    let loginSuccess = false;
    for (const loginUrl of loginUrls) {
      try {
        await page.goto(loginUrl, { timeout: 10000 });
        const hasLoginForm = await page.locator('input[placeholder*="用户名"], input[placeholder*="username"]').count();
        if (hasLoginForm > 0) {
          // 填写登录
          await page.locator('input[placeholder*="用户名"], input[placeholder*="username"]').first().fill(username);
          await page.locator('input[placeholder*="密码"], input[placeholder*="password"]').first().fill(password);
          await page.locator('button', { hasText: /登录|Login/ }).first().click();
          await page.waitForTimeout(2000);

          // 检查是否登录成功（URL 不再包含 login）
          const currentUrl = page.url();
          if (!currentUrl.includes('login')) {
            console.log(`[运行时] 登录成功: ${loginUrl}`);
            loginSuccess = true;
            break;
          }
        }
      } catch { /* try next */ }
    }

    if (!loginSuccess) {
      console.error('[运行时] 登录失败');
      return results;
    }

    // Step 2: 确定基础路径结构
    const currentUrl = page.url();
    console.log(`[运行时] 登录后 URL: ${currentUrl}`);

    // 从当前 URL 推断部署根路径（如 /agent_audio/）
    // 登录后 URL 格式：{origin}/{deployRoot}/{subApp}/index.html#/...
    // 需要去掉子应用目录名，得到 deployRoot
    const urlObj = new URL(currentUrl);
    const fullPath = urlObj.pathname; // 如 /agent_audio/web/index.html
    // 去掉 /index.html 部分，得到 /agent_audio/web
    const pathWithoutFile = fullPath.replace(/\/index\.html.*$/, '');
    // 去掉最后一段（子应用名），得到部署根路径 /agent_audio
    const pathSegments = pathWithoutFile.split('/').filter(Boolean);
    // 如果有多段，去掉最后一段（子应用名）
    const deployRoot = pathSegments.length > 1
      ? '/' + pathSegments.slice(0, -1).join('/') + '/'
      : '/' + pathSegments[0] + '/';
    const origin = urlObj.origin;
    console.log(`[运行时] 部署根路径: ${origin}${deployRoot}`);

    // 同时，当前所在的子应用名（如 web）
    const currentSubApp = pathSegments[pathSegments.length - 1] || 'web';
    console.log(`[运行时] 当前子应用: ${currentSubApp}`);

    // Step 3: 探测所有子应用入口
    // 基于部署根路径探测，同时检测当前子应用
    const entriesToProbe = knownEntries.length > 0
      ? [...knownEntries]
      : ['web', 'admin', 'index', 'chat', 'setting-system', 'setting-app', 'manage', 'dashboard', 'setting', 'portal'];

    // 确保当前子应用和常见名称都在列表中
    for (const extra of [currentSubApp, 'admin', 'manage', 'dashboard', 'setting', 'portal']) {
      if (!entriesToProbe.includes(extra)) entriesToProbe.push(extra);
    }

    console.log(`[运行时] 探测 ${entriesToProbe.length} 个可能的入口...`);

    const validEntries = [];
    for (const entry of entriesToProbe) {
      const entryUrl = `${origin}${deployRoot}${entry}/index.html`;
      try {
        const response = await page.goto(entryUrl, { timeout: 8000, waitUntil: 'domcontentloaded' });
        const content = await page.content();
        const isRealApp = content.includes('<!doctype') || content.includes('<!DOCTYPE') || content.includes('id="app"');
        const isJsonError = content.includes('No static resource') || content.includes('"httpCode"');

        if (isRealApp && !isJsonError) {
          console.log(`  ✅ ${entry}/index.html — 真实 Vue 应用`);
          validEntries.push(entry);
        } else {
          console.log(`  ❌ ${entry}/index.html — ${isJsonError ? '未部署' : '非 Vue 应用'}`);
        }
      } catch (e) {
        console.log(`  ❌ ${entry}/index.html — ${e.message?.substring(0, 50)}`);
      }
    }

    console.log(`\n[运行时] 发现 ${validEntries.length} 个有效入口: ${validEntries.join(', ')}`);

    // Step 4: 对每个有效入口提取 Vue Router 路由
    for (const entry of validEntries) {
      const entryUrl = `${origin}${deployRoot}${entry}/index.html`;
      console.log(`\n[运行时] 提取 ${entry} 的路由...`);

      try {
        await page.goto(entryUrl, { timeout: 10000, waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        const routesData = await page.evaluate(() => {
          const app = document.querySelector('#app');
          if (!app || !app.__vue_app__) return { error: 'no vue app' };

          const router = app.__vue_app__.config?.globalProperties?.$router;
          if (!router) return { error: 'no router' };

          const routes = router.getRoutes();

          // 获取动态参数的实际值
          const currentPath = location.hash.replace('#', '');
          const pathSegments = currentPath.split('/').filter(Boolean);

          return {
            title: document.title,
            url: location.href,
            routeCount: routes.length,
            pathSegments,
            routes: routes.map(r => ({
              path: r.path,
              name: r.name || '',
              title: r.meta?.title || '',
              layout: r.meta?.layout || '',
              hasParams: r.path.includes(':'),
            })),
          };
        });

        if (routesData.error) {
          console.log(`  ⚠️ ${routesData.error}`);
          results[entry] = { error: routesData.error, url: entryUrl };
        } else {
          // 用动态参数实际值展开路由
          const paramValues = {};
          if (routesData.pathSegments.length > 0) {
            // 从当前 URL 推断参数映射
            const currentRoute = routesData.routes.find(r => {
              const segments = r.path.split('/').filter(Boolean);
              if (segments.length !== routesData.pathSegments.length) return false;
              return segments.every((seg, i) => seg.startsWith(':') || seg === routesData.pathSegments[i]);
            });
            if (currentRoute) {
              const templateSegments = currentRoute.path.split('/').filter(Boolean);
              templateSegments.forEach((seg, i) => {
                if (seg.startsWith(':')) {
                  paramValues[seg] = routesData.pathSegments[i];
                }
              });
            }
          }

          // 展开动态路由为具体 URL
          const expandedRoutes = routesData.routes.map(r => {
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

          results[entry] = {
            title: routesData.title,
            url: entryUrl,
            routeCount: routesData.routeCount,
            paramValues,
            routes: expandedRoutes,
          };

          console.log(`  📋 ${routesData.routeCount} 条路由, ${Object.keys(paramValues).length > 0 ? `参数: ${JSON.stringify(paramValues)}` : '无动态参数'}`);
        }
      } catch (e) {
        console.log(`  ❌ 提取失败: ${e.message}`);
        results[entry] = { error: e.message, url: entryUrl };
      }
    }

  } finally {
    await context.close();
  }

  return results;
}

// ========== 合并去重 + 生成分组 ==========

function processResults(results) {
  const pageSets = {};
  let totalPages = 0;

  for (const [entry, data] of Object.entries(results)) {
    if (data.error || !data.routes) continue;

    // 过滤掉根路由、登录页
    const testableRoutes = data.routes.filter(r =>
      r.path !== '/' &&
      r.path !== '/login' &&
      !r.path.endsWith('/') || r.path === '/'
    ).filter(r => r.path !== '/');

    // 按路径前缀分组
    const groups = {};
    for (const route of testableRoutes) {
      const segments = route.path.split('/').filter(Boolean);
      // 动态参数段不算
      const firstRealSegment = segments.find(s => !s.startsWith(':')) || segments[0] || 'root';

      // 简化分组逻辑：取前两层
      let groupId;
      if (segments.length <= 1) {
        groupId = firstRealSegment;
      } else if (segments[0].startsWith(':')) {
        // 如 /:bsId/agent → 按 agent 分组
        groupId = segments[1] || firstRealSegment;
      } else {
        groupId = segments[0];
      }

      if (!groups[groupId]) {
        groups[groupId] = { id: `${entry}-${groupId}`, name: `${groupId} (${entry})`, pages: [] };
      }
      groups[groupId].pages.push({
        id: `${entry}-${route.name || groupId}-${groups[groupId].pages.length}`,
        name: route.title || route.name || route.path,
        url: route.concreteUrl,
        path: route.path,
      });
    }

    pageSets[entry] = Object.values(groups);
    totalPages += testableRoutes.length;
  }

  return { pageSets, totalPages };
}

// ========== 主流程 ==========

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     E2E 页面自动发现 v1.0                    ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  目标: ${TARGET_URL.padEnd(35)}║`);
  console.log(`║  源码: ${(SOURCE_PATH || '未提供').padEnd(35)}║`);
  console.log('╚══════════════════════════════════════════════╝\n');

  // 模式 A：源码分析
  let knownEntries = [];
  let sourceRoutes = {};
  if (SOURCE_PATH) {
    console.log('══ 模式 A：源码分析 ══\n');
    knownEntries = discoverFromSource(SOURCE_PATH);
    sourceRoutes = extractRoutesFromSource(SOURCE_PATH);
  }

  // 模式 B：运行时探测
  console.log('\n══ 模式 B：运行时探测 ══\n');
  const browser = await chromium.launch({ headless: true });

  let runtimeResults;
  try {
    runtimeResults = await discoverFromRuntime(browser, TARGET_URL, USERNAME, PASSWORD, knownEntries);
  } finally {
    await browser.close();
  }

  // 合并结果
  console.log('\n══ 合并结果 ══\n');
  const { pageSets, totalPages } = processResults(runtimeResults);

  // 输出汇总
  for (const [entry, data] of Object.entries(runtimeResults)) {
    if (data.routes) {
      console.log(`  ${entry}: ${data.routeCount} 条路由 (${data.title})`);
    } else {
      console.log(`  ${entry}: ❌ ${data.error}`);
    }
  }
  console.log(`\n  总计: ${totalPages} 个可测试页面`);

  // 保存结果
  const output = {
    target: TARGET_URL,
    discoveredAt: new Date().toISOString(),
    sourceAnalysis: SOURCE_PATH ? { entries: knownEntries, routes: sourceRoutes } : null,
    runtime: runtimeResults,
    pageSets,
    totalPages,
  };

  const outputDir = path.dirname(OUTPUT);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n结果已保存: ${OUTPUT}`);
}

main().catch(console.error);
