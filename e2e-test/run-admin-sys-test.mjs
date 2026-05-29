import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { generateRunId, config, storagePath } from './src/config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pageContext = JSON.parse(readFileSync(join(__dirname, 'knowledge', 'page-context.json'), 'utf-8'));

const RUN_ID = 'run-2026-05-28T10-07-40';
const RUN_DIR = join(storagePath, 'runs', RUN_ID);
const MODE = 'standard';

const PAGES = [
  { id: 'admin-sys-code', name: '代码管理', url: 'http://localhost:5173/admin/index.html#/sys/code' },
  { id: 'admin-sys-config', name: '配置管理', url: 'http://localhost:5173/admin/index.html#/sys/config' },
  { id: 'admin-sys-database', name: '数据源管理', url: 'http://localhost:5173/admin/index.html#/sys/database' },
  { id: 'admin-sys-storage', name: '仓库管理', url: 'http://localhost:5173/admin/index.html#/sys/storage' },
  { id: 'admin-sys-storage-file', name: '文件管理', url: 'http://localhost:5173/admin/index.html#/sys/storage/file' },
  { id: 'admin-sys-mention', name: '注入配置', url: 'http://localhost:5173/admin/index.html#/sys/mention' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function login(page) {
  console.log('[登录] 导航到登录页面...');
  await page.goto('http://localhost:5173/index/index.html#/login', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);

  console.log('[登录] 当前URL:', page.url());

  const usernameInput = page.locator('input[placeholder*="用户名"], input[placeholder*="username"], input[placeholder*="请输入"]').first();
  const passwordInput = page.locator('input[type="password"], input[placeholder*="密码"]').first();

  const hasUsername = await usernameInput.count();
  const hasPassword = await passwordInput.count();

  console.log(`[登录] 检测到输入框 - 用户名:${hasUsername}, 密码:${hasPassword}`);

  if (hasUsername > 0 && hasPassword > 0) {
    console.log('[登录] 填写凭据...');
    await usernameInput.click();
    await usernameInput.fill('fskjadmin');
    await sleep(300);

    await passwordInput.click();
    await passwordInput.fill('fskj_dst_2023');
    await sleep(300);

    console.log('[登录] 输入完成 - 用户名值:', await usernameInput.inputValue(), '密码长度:', (await passwordInput.inputValue()).length);

    const loginBtn = page.locator('button:has-text("登录"), button:has-text("点击登录"), button:has-text("Login"), button[type="submit"]').first();
    const btnCount = await loginBtn.count();
    console.log(`[登录] 找到登录按钮: ${btnCount}个`);

    if (btnCount > 0) {
      await loginBtn.click();
      console.log('[登录] 已点击登录按钮，等待跳转...');
      await sleep(5000);

      console.log('[登录] 登录后URL:', page.url());
      const pageContent = await page.evaluate(() => document.body.innerText.substring(0, 200));
      console.log('[登录] 登录后页面内容:', pageContent.substring(0, 100));

      const stillLogin = page.url().includes('login') || pageContent.includes('请输入您的用户名');
      if (stillLogin) {
        console.log('[登录] 仍在登录页面，尝试回车登录...');
        await passwordInput.press('Enter');
        await sleep(3000);
        console.log('[登录] 回车后URL:', page.url());
      }

      console.log('[登录] 登录完成');
    }
  } else {
    console.log('[登录] 未检测到登录表单，可能已登录');
    const pageContent = await page.evaluate(() => document.body.innerText.substring(0, 200));
    console.log('[登录] 当前页面内容:', pageContent.substring(0, 100));
  }
}

async function checkAndLogin(page) {
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  const hasLoginForm = await page.locator('input[placeholder*="用户名"], input[placeholder*="请输入"]').count();
  const hasPassword = await page.locator('input[type="password"]').count();
  const hasLoginBtn = await page.locator('button:has-text("登录"), button:has-text("点击登录")').count();

  console.log(`  [登录检查] bodyText前100字: ${pageText.substring(0, 100)}`);
  console.log(`  [登录检查] 用户名输入框:${hasLoginForm}, 密码框:${hasPassword}, 登录按钮:${hasLoginBtn}`);

  if (hasLoginForm > 0 && hasPassword > 0 && hasLoginBtn > 0) {
    console.log(`  [登录检查] 检测到admin页面内的登录表单，执行登录...`);
    const usernameInput = page.locator('input[placeholder*="用户名"], input[placeholder*="请输入"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const loginBtn = page.locator('button:has-text("登录"), button:has-text("点击登录")').first();

    await usernameInput.click();
    await usernameInput.fill('fskjadmin');
    await sleep(300);
    await passwordInput.click();
    await passwordInput.fill('fskj_dst_2023');
    await sleep(300);

    console.log(`  [登录检查] 已填写凭据，点击登录...`);
    await loginBtn.click();
    await sleep(5000);

    const newText = await page.evaluate(() => document.body.innerText.substring(0, 200));
    console.log(`  [登录检查] 登录后内容: ${newText.substring(0, 100)}`);

    const stillHasLogin = await page.locator('input[type="password"]').count();
    return stillHasLogin > 0;
  }

  return false;
}

async function checkConsoleErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function checkNetworkErrors(page) {
  const errors = [];
  page.on('response', resp => {
    if (resp.status() >= 400) {
      errors.push({ url: resp.url(), status: resp.status() });
    }
  });
  return errors;
}

async function getPageStructure(page) {
  return await page.evaluate(() => {
    const body = document.body;
    const getText = el => el.innerText?.substring(0, 200) || '';
    const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.innerText?.trim()?.substring(0, 50),
      visible: b.offsetParent !== null,
      disabled: b.disabled
    })).filter(b => b.visible);

    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(i => ({
      type: i.type || i.tagName.toLowerCase(),
      placeholder: i.placeholder || '',
      visible: i.offsetParent !== null,
      value: i.value?.substring(0, 50) || ''
    })).filter(i => i.visible);

    const tables = Array.from(document.querySelectorAll('table, .el-table, .ant-table')).map(t => ({
      rows: t.querySelectorAll('tr, .el-table__row, .ant-table-row').length,
      visible: t.offsetParent !== null
    })).filter(t => t.visible);

    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .el-dialog, .ant-modal')).map(d => ({
      visible: d.offsetParent !== null,
      title: d.querySelector('.el-dialog__title, .ant-modal-title')?.innerText || ''
    }));

    const pagination = document.querySelector('.el-pagination, .ant-pagination');
    const loading = document.querySelector('.el-loading-mask, .ant-spin-spinning');

    return {
      title: document.title,
      url: location.href,
      bodyText: getText(body).substring(0, 500),
      buttons,
      inputs,
      tables,
      dialogs,
      hasPagination: !!pagination,
      isLoading: !!loading,
      bodyHeight: body.scrollHeight
    };
  });
}

async function observe(page, pageInfo) {
  console.log(`  [观察] 获取页面结构...`);
  const structure = await getPageStructure(page);

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const networkErrors = [];
  page.on('response', resp => {
    if (resp.status() >= 400) networkErrors.push({ url: resp.url(), status: resp.status() });
  });

  await sleep(1000);

  return { structure, consoleErrors, networkErrors };
}

function analyzePage(structure, pageInfo, consoleErrors, networkErrors) {
  const issues = [];
  const checks = [];
  let score = 100;

  if (!structure.bodyText || structure.bodyText.length < 10) {
    issues.push({ severity: 'critical', title: '页面内容为空', description: '页面主体内容区域为空，可能白屏' });
    score -= 50;
    checks.push({ category: '加载', name: '页面内容检查', status: 'fail', detail: '页面内容为空' });
  } else {
    checks.push({ category: '加载', name: '页面正常加载', status: 'pass', detail: `页面内容长度: ${structure.bodyText.length}字符` });
  }

  if (consoleErrors.length > 0) {
    const criticalErrors = consoleErrors.filter(e =>
      e.includes('Uncaught') || e.includes('TypeError') || e.includes('ReferenceError')
    );
    if (criticalErrors.length > 0) {
      issues.push({ severity: 'high', title: 'JS运行错误', description: criticalErrors.slice(0, 3).join(' | ') });
      score -= 20;
    }
    checks.push({
      category: '控制台', name: 'JS错误检查', status: criticalErrors.length > 0 ? 'fail' : 'warning',
      detail: `发现 ${consoleErrors.length} 个控制台错误`
    });
  } else {
    checks.push({ category: '控制台', name: 'JS错误检查', status: 'pass', detail: '无JS错误' });
  }

  if (networkErrors.length > 0) {
    const apiErrors = networkErrors.filter(e => e.url.includes('/api/'));
    if (apiErrors.length > 0) {
      issues.push({
        severity: 'high', title: 'API接口错误',
        description: apiErrors.map(e => `${e.status}: ${e.url}`).join(' | ')
      });
      score -= 15;
    }
    checks.push({
      category: '网络', name: 'API请求检查', status: apiErrors.length > 0 ? 'fail' : 'pass',
      detail: apiErrors.length > 0 ? `${apiErrors.length}个API错误` : 'API请求正常'
    });
  } else {
    checks.push({ category: '网络', name: 'API请求检查', status: 'pass', detail: '网络请求正常' });
  }

  const expectedElements = pageInfo?.expectedElements || [];
  const hasTable = structure.tables.length > 0;
  const hasButton = structure.buttons.length > 0;
  const hasInput = structure.inputs.length > 0;

  if (expectedElements.includes('搜索框') && !hasInput) {
    issues.push({ severity: 'medium', title: '缺少搜索框', description: '预期有搜索框但未找到' });
    score -= 5;
  }

  if (expectedElements.includes('数据表格') && !hasTable) {
    issues.push({ severity: 'medium', title: '缺少数据表格', description: '预期有数据表格但未找到' });
    score -= 5;
  }

  checks.push({
    category: '元素', name: '页面元素检查',
    status: hasButton && (hasTable || hasInput) ? 'pass' : 'warning',
    detail: `按钮:${structure.buttons.length}个, 输入框:${structure.inputs.length}个, 表格:${structure.tables.length}个`
  });

  if (structure.isLoading) {
    checks.push({ category: '加载', name: '页面加载状态', status: 'warning', detail: '页面仍在加载中' });
  }

  return { issues, checks, score: Math.max(0, score) };
}

async function standardAct(page, structure, pageInfo, pageId) {
  const actions = [];
  const issues = [];

  const btnTexts = structure.buttons.map(b => b.text).filter(Boolean);

  const addBtn = structure.buttons.find(b =>
    b.text?.includes('新增') || b.text?.includes('添加') || b.text?.includes('新建')
  );

  if (addBtn) {
    try {
      console.log('  [操作] 点击新增按钮...');
      await page.locator(`button:has-text("${addBtn.text}")`).first().click();
      await sleep(2000);

      const dialogVisible = await page.locator('[role="dialog"], .el-dialog, .ant-modal').count();
      if (dialogVisible > 0) {
        const dialogTitle = await page.locator('.el-dialog__title, .ant-modal-title').first().innerText().catch(() => '');
        console.log(`  [操作] 弹窗已打开: ${dialogTitle}`);
        actions.push({
          round: 2, status: 'pass',
          action: { type: 'click', target: '新增按钮', reason: '测试弹窗打开' },
          issues: []
        });

        await page.locator('.el-dialog__close, .ant-modal-close, button:has-text("取消")').first().click().catch(() => {});
        await sleep(1000);
      } else {
        console.log('  [操作] 点击新增后未检测到弹窗');
        actions.push({
          round: 2, status: 'warning',
          action: { type: 'click', target: '新增按钮', reason: '测试弹窗打开' },
          issues: [{ severity: 'medium', title: '新增按钮点击后未打开弹窗', description: '点击新增按钮后没有出现预期的弹窗' }]
        });
      }
    } catch (e) {
      console.log(`  [操作] 点击新增失败: ${e.message}`);
      actions.push({
        round: 2, status: 'error',
        action: { type: 'click', target: '新增按钮', reason: '测试弹窗打开' },
        issues: [{ severity: 'high', title: '新增按钮操作失败', description: e.message }]
      });
    }
  }

  const searchInputs = structure.inputs.filter(i => i.type === 'text' || i.type === 'search');
  if (searchInputs.length > 0) {
    try {
      console.log('  [操作] 测试搜索功能...');
      const searchInput = page.locator('input[type="text"], input[placeholder*="搜索"], input[placeholder*="查询"], input[placeholder*="请输入"]').first();
      if (await searchInput.count() > 0) {
        await searchInput.fill('test');
        await sleep(1000);

        const searchBtn = page.locator('button:has-text("搜索"), button:has-text("查询"), button:has-text("搜索")').first();
        if (await searchBtn.count() > 0) {
          await searchBtn.click();
        } else {
          await searchInput.press('Enter');
        }
        await sleep(2000);

        const postStructure = await getPageStructure(page);
        const rowChanged = postStructure.tables.length > 0;
        console.log(`  [操作] 搜索完成，表格行数: ${postStructure.tables.map(t => t.rows).join(',')}`);
        actions.push({
          round: 3, status: 'pass',
          action: { type: 'search', target: '搜索框', reason: '测试搜索功能' },
          issues: []
        });

        await searchInput.fill('');
        const searchBtn2 = page.locator('button:has-text("重置"), button:has-text("清空")').first();
        if (await searchBtn2.count() > 0) {
          await searchBtn2.click();
        } else {
          await searchInput.press('Enter');
        }
        await sleep(1500);
      }
    } catch (e) {
      console.log(`  [操作] 搜索测试失败: ${e.message}`);
      actions.push({
        round: 3, status: 'error',
        action: { type: 'search', target: '搜索框', reason: '测试搜索功能' },
        issues: [{ severity: 'medium', title: '搜索功能测试失败', description: e.message }]
      });
    }
  }

  const editBtns = await page.locator('button:has-text("编辑"), a:has-text("编辑"), [title="编辑"]').all();
  if (editBtns.length > 0) {
    try {
      console.log('  [操作] 点击编辑按钮...');
      await editBtns[0].click();
      await sleep(2000);

      const dialogVisible = await page.locator('[role="dialog"], .el-dialog, .ant-modal').count();
      if (dialogVisible > 0) {
        console.log('  [操作] 编辑弹窗已打开');
        actions.push({
          round: 4, status: 'pass',
          action: { type: 'click', target: '编辑按钮', reason: '测试编辑弹窗打开和数据回填' },
          issues: []
        });

        const formInputs = await page.locator('.el-dialog input, .ant-modal input').all();
        let hasData = false;
        for (const input of formInputs) {
          const val = await input.inputValue().catch(() => '');
          if (val && val.length > 0) { hasData = true; break; }
        }
        if (!hasData) {
          actions[actions.length - 1].issues.push({
            severity: 'medium', title: '编辑数据未回填', description: '点击编辑后表单字段为空'
          });
        }

        await page.locator('.el-dialog__close, .ant-modal-close, button:has-text("取消")').first().click().catch(() => {});
        await sleep(1000);
      } else {
        actions.push({
          round: 4, status: 'warning',
          action: { type: 'click', target: '编辑按钮', reason: '测试编辑弹窗' },
          issues: [{ severity: 'medium', title: '编辑按钮点击后未打开弹窗', description: '点击编辑按钮后没有出现弹窗' }]
        });
      }
    } catch (e) {
      actions.push({
        round: 4, status: 'error',
        action: { type: 'click', target: '编辑按钮', reason: '测试编辑' },
        issues: [{ severity: 'high', title: '编辑操作失败', description: e.message }]
      });
    }
  }

  return actions;
}

async function testPage(browser, pageInfo, runDir) {
  const startTime = Date.now();
  const pageId = pageInfo.id;
  const context = pageContext[pageId] || {};
  const screenshotDir = join(runDir, pageId, 'screenshots');

  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  const consoleErrors = [];
  const networkErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', resp => {
    if (resp.status() >= 400) {
      networkErrors.push({ url: resp.url(), status: resp.status() });
    }
  });

  try {
    console.log(`\n[${pageInfo.name}] 导航到 ${pageInfo.url}`);
    await page.goto(pageInfo.url, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(3000);

    const needsLogin = await checkAndLogin(page);
    if (needsLogin) {
      console.log(`  [导航] admin页面内登录成功，重新加载页面...`);
      await page.goto(pageInfo.url, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(3000);
      const stillLogin = await checkAndLogin(page);
      if (stillLogin) {
        throw new Error('admin页面登录失败');
      }
    }

    const currentUrl = page.url();
    console.log(`  [导航] 当前URL: ${currentUrl}`);

    const frames = page.frames();
    console.log(`  [导航] 页面frames数量: ${frames.length}`);
    if (frames.length > 1) {
      for (let fi = 0; fi < frames.length; fi++) {
        console.log(`  [导航] Frame ${fi}: ${frames[fi].url()}`);
      }
    }

    const screenshot1Path = join(screenshotDir, `${pageId}-01-initial.png`);
    await page.screenshot({ path: screenshot1Path, fullPage: true });
    console.log(`  [截图] 初始截图已保存`);

    const structure = await getPageStructure(page);
    const analysis = analyzePage(structure, context, consoleErrors, networkErrors);

    const agentTimeline = [
      { round: 1, status: analysis.score >= 60 ? 'pass' : 'fail', action: null, issues: analysis.issues.slice(0, 2) }
    ];

    let actActions = [];
    if (MODE === 'standard') {
      actActions = await standardAct(page, structure, context, pageId);
      agentTimeline.push(...actActions);
    }

    for (let i = 0; i < actActions.length; i++) {
      const ssPath = join(screenshotDir, `${pageId}-${String(i + 2).padStart(2, '0')}-action${i + 1}.png`);
      await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
    }

    const finalStructure = await getPageStructure(page);
    const finalConsoleErrors = consoleErrors.slice();
    const finalNetworkErrors = networkErrors.slice();

    const finalAnalysis = analyzePage(finalStructure, context, finalConsoleErrors, finalNetworkErrors);

    const allIssues = [...analysis.issues];
    for (const a of actActions) {
      if (a.issues) allIssues.push(...a.issues);
    }
    const uniqueIssues = [];
    const seenTitles = new Set();
    for (const iss of allIssues) {
      if (!seenTitles.has(iss.title)) {
        seenTitles.add(iss.title);
        uniqueIssues.push(iss);
      }
    }

    const allChecks = [...analysis.checks];

    const screenshots = [];
    const files = await import('fs').then(f => f.readdirSync(screenshotDir));
    for (const f of files) {
      if (f.endsWith('.png')) screenshots.push(join(screenshotDir, f));
    }

    const hasCritical = uniqueIssues.some(i => i.severity === 'critical');
    const hasHigh = uniqueIssues.some(i => i.severity === 'high');
    let overallStatus = 'pass';
    if (hasCritical) overallStatus = 'fail';
    else if (hasHigh) overallStatus = 'warning';
    else if (uniqueIssues.length > 2) overallStatus = 'warning';

    const finalScore = Math.max(0, analysis.score - (uniqueIssues.filter(i => i.severity === 'high').length * 10) - (uniqueIssues.filter(i => i.severity === 'medium').length * 5));

    const duration = Date.now() - startTime;

    const result = {
      pageId,
      pageName: pageInfo.name,
      url: pageInfo.url,
      mode: MODE,
      score: finalScore,
      overallStatus,
      checks: allChecks,
      issues: uniqueIssues,
      agentTimeline,
      screenshots,
      duration
    };

    console.log(`  [结果] ${pageInfo.name}: ${finalScore}分, 状态=${overallStatus}, 问题=${uniqueIssues.length}个, 耗时=${(duration / 1000).toFixed(1)}秒`);
    return result;

  } catch (e) {
    console.error(`  [错误] ${pageInfo.name} 测试失败: ${e.message}`);
    const errorScreenshot = join(screenshotDir, `${pageId}-error.png`);
    await page.screenshot({ path: errorScreenshot, fullPage: true }).catch(() => {});

    return {
      pageId,
      pageName: pageInfo.name,
      url: pageInfo.url,
      mode: MODE,
      score: 0,
      overallStatus: 'error',
      checks: [{ category: '加载', name: '页面加载', status: 'fail', detail: e.message }],
      issues: [{ severity: 'critical', title: '页面测试失败', description: e.message }],
      agentTimeline: [{ round: 1, status: 'error', action: null, issues: [{ severity: 'critical', title: '页面测试失败', description: e.message }] }],
      screenshots: [errorScreenshot],
      duration: Date.now() - startTime
    };
  } finally {
    await page.close();
  }
}

async function main() {
  console.log('======================================');
  console.log('E2E 页面测试 - admin-sys 范围');
  console.log(`模式: ${MODE}`);
  console.log(`Run ID: ${RUN_ID}`);
  console.log(`运行目录: ${RUN_DIR}`);
  console.log('======================================');

  const browser = await chromium.launch({ headless: true });
  console.log('[浏览器] Chromium 已启动 (headless)');

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });

  const loginPage = await context.newPage();
  await login(loginPage);
  await loginPage.close();

  const results = [];
  for (const pageInfo of PAGES) {
    const result = await testPage(context, pageInfo, RUN_DIR);
    results.push(result);
  }

  await browser.close();

  const runData = {
    runId: RUN_ID,
    mode: MODE,
    scope: 'admin-sys',
    results,
    totalDuration: results.reduce((s, r) => s + (r.duration || 0), 0)
  };

  const runJsonPath = join(RUN_DIR, 'run.json');
  writeFileSync(runJsonPath, JSON.stringify(runData, null, 2), 'utf-8');
  console.log(`\n[数据] 测试结果已保存: ${runJsonPath}`);

  console.log('\n======================================');
  console.log('测试汇总');
  console.log('======================================');
  for (const r of results) {
    console.log(`  ${r.overallStatus === 'pass' ? '✅' : r.overallStatus === 'warning' ? '⚠️' : '❌'} ${r.pageName}: ${r.score}分 (${r.issues.length}个问题)`);
  }
  const totalScore = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
  const passedCount = results.filter(r => r.overallStatus === 'pass').length;
  console.log(`\n总评分: ${totalScore}分, 通过: ${passedCount}/${results.length}`);

  console.log('\n现在请运行以下命令生成HTML报告:');
  console.log(`  cd C:\\FengSuKeJi\\ai-platform\\e2e-test`);
  console.log(`  node src/report-generator.js "${runJsonPath}"`);
}

main().catch(e => {
  console.error('测试执行失败:', e);
  process.exit(1);
});
