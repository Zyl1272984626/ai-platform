const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('ERR:', msg.text());
  });

  await page.goto('http://localhost:3200/tests');
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'C:/FengSuKeJi/ai-platform/test-fix-stale.png', fullPage: true });

  // 检查是否有残留的运行面板
  const panels = await page.$$('.run-panel');
  console.log('Run panels:', panels.length);
  for (const p of panels) {
    const text = await p.textContent();
    console.log('  Panel:', text?.substring(0, 200));
  }

  // 检查是否有"运行中"标记
  const running = await page.$$('.streaming-indicator, .run-running-badge');
  console.log('Running indicators:', running.length);

  const body = await page.textContent('body');
  if (body.includes('运行中')) {
    console.log('WARNING: 页面仍然包含"运行中"文字');
  } else {
    console.log('OK: 页面没有"运行中"文字');
  }

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
