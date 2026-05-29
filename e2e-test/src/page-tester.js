/**
 * 页面测试器 v3.0
 *
 * 集成 AI Agent 循环，支持三种模式：
 * - quick:    1轮 observe（AI只看不操作）
 * - standard: 3-5轮 AI Agent 循环（观察+交互）
 * - deep:     10+轮 AI Agent 循环（全面交互+边界测试）
 *
 * 无 AI API Key 时自动回退到 v2.0 规则检测模式
 */

import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import config, { storagePath } from './config.js'
import { runAgentTest } from './ai-agent.js'

/**
 * 安全执行 page.evaluate
 */
async function safeEvaluate(page, fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await page.evaluate(fn)
    } catch (e) {
      if (e.message?.includes('Execution context was destroyed') && i < retries) {
        await page.waitForTimeout(3000)
      } else {
        throw e
      }
    }
  }
}

/**
 * 检测 AI Agent 是否可用
 */
function isAgentAvailable() {
  const apiKey = process.env[config.ai.apiKeyEnv]
  return !!apiKey
}

/**
 * 测试单个页面（主入口）
 *
 * 根据 AI 可用性自动选择模式：
 * - 有 API Key → AI Agent 模式
 * - 无 API Key → 传统规则检测模式
 */
export async function testPage(page, pageInfo, runId, mode = 'standard', onProgress = null) {
  if (isAgentAvailable()) {
    console.log(`[测试] 使用 AI Agent 模式测试: ${pageInfo.name}`)
    return await runAgentTest(page, pageInfo, runId, mode, onProgress)
  } else {
    console.log(`[测试] 未检测到 ${config.ai.apiKeyEnv}，使用传统规则检测模式`)
    return await testPageRuleBased(page, pageInfo, runId, mode, onProgress)
  }
}

/**
 * 传统规则检测模式（v2.0 逻辑，无 AI 时回退使用）
 */
async function testPageRuleBased(page, pageInfo, runId, mode = 'standard', onProgress = null) {
  const result = {
    pageId: pageInfo.id,
    pageName: pageInfo.name,
    url: pageInfo.url,
    mode,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    duration: 0,
    score: 0,
    overallStatus: 'pending',
    screenshots: [],
    checks: [],
    issues: [],
    agentTimeline: [],
    performance: null
  }

  const startTime = Date.now()
  const pageDir = join(storagePath, 'runs', runId, pageInfo.id)
  const screenshotDir = join(pageDir, 'screenshots')
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true })

  const emit = (type, data) => onProgress && onProgress(type, data)

  try {
    // ===== Step 1: 页面加载检查 =====
    emit('page:check', { pageId: pageInfo.id, name: '页面加载', status: 'running' })
    console.log(`[测试] 访问页面: ${pageInfo.name} (${pageInfo.url})`)

    const consoleErrors = []
    const consoleListener = msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    }
    page.on('console', consoleListener)

    const failedRequests = []
    const responseListener = resp => {
      const url = resp.url()
      const status = resp.status()
      if (url.includes('/api/') && (status >= 400 || status === 0)) {
        failedRequests.push({ url, status, method: resp.request().method() })
      }
    }
    page.on('response', responseListener)

    await page.goto(pageInfo.url, { waitUntil: 'domcontentloaded', timeout: config.browser.timeout })
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch (_) {}
    await page.waitForTimeout(2000)

    // 截图1: 页面加载
    const ss1Path = join(screenshotDir, '001-页面加载.png')
    await page.screenshot({ path: ss1Path, fullPage: config.storage.screenshots.fullPage })
    result.screenshots.push({ name: '页面加载', file: ss1Path, timestamp: new Date().toISOString() })

    // 白屏检测
    const bodyHTML = await safeEvaluate(page, () => document.body.innerHTML) || ''
    const isBlank = bodyHTML.length < 100

    if (isBlank) {
      result.checks.push({ category: '加载', name: '页面加载', status: 'error', detail: '页面白屏' })
      result.overallStatus = 'error'
      result.issues.push({ severity: 'critical', title: `${pageInfo.name} - 页面白屏`, description: 'body内容为空', screenshot: ss1Path })
      result.score = 0
      writeFileSync(join(pageDir, 'result.json'), JSON.stringify(finalize(result, startTime), null, 2), 'utf-8')
      return finalize(result, startTime)
    }

    result.checks.push({ category: '加载', name: '页面正常加载', status: 'pass', detail: '无白屏' })
    emit('page:check', { pageId: pageInfo.id, name: '页面加载', status: 'pass' })

    // JS 错误
    await page.waitForTimeout(2000)
    if (consoleErrors.length > 0) {
      result.checks.push({ category: '加载', name: '控制台JS错误', status: 'warning', detail: `${consoleErrors.length}个错误: ${consoleErrors.slice(0, 3).join('; ')}` })
      result.issues.push({ severity: 'high', title: `${pageInfo.name} - JS错误`, description: consoleErrors.slice(0, 5).join('\n'), screenshot: ss1Path })
    } else {
      result.checks.push({ category: '加载', name: '无JS错误', status: 'pass', detail: '控制台无error级别日志' })
    }

    // 性能
    const perfData = await safeEvaluate(page, () => {
      const entries = performance.getEntriesByType('navigation')
      if (!entries.length) return null
      const nav = entries[0]
      return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart), totalLoadTime: Math.round(nav.loadEventEnd), domInteractive: Math.round(nav.domInteractive) }
    })
    if (perfData) result.performance = perfData

    // ===== Step 2: 页面结构分析 =====
    const ss2Path = join(screenshotDir, '002-页面全貌.png')
    await page.screenshot({ path: ss2Path, fullPage: config.storage.screenshots.fullPage })
    result.screenshots.push({ name: '页面全貌', file: ss2Path, timestamp: new Date().toISOString() })

    const domInfo = await safeEvaluate(page, () => {
      const body = document.body
      return {
        totalElements: body.querySelectorAll('*').length,
        buttons: body.querySelectorAll('button, [role="button"], .el-button').length,
        tables: body.querySelectorAll('table, .el-table, .el-descriptions').length,
        forms: body.querySelectorAll('form, .el-form').length,
        inputs: body.querySelectorAll('input, textarea, select, .el-input, .el-select').length,
        navs: body.querySelectorAll('nav, .sidebar, .el-menu, .el-aside, aside').length,
        hasEmpty: body.querySelectorAll('.el-empty, .empty, [class*="empty"]').length > 0,
        bodyTextLength: body.innerText.length
      }
    }) || {}

    if (domInfo.navs > 0) {
      result.checks.push({ category: '布局', name: '导航/侧边栏', status: 'pass', detail: `${domInfo.navs}个` })
    }
    if (domInfo.bodyTextLength > 50) {
      result.checks.push({ category: '布局', name: '主要内容', status: 'pass', detail: `文本${domInfo.bodyTextLength}字符` })
    }

    // ===== Step 3: 数据状态 =====
    const ss3Path = join(screenshotDir, '003-数据状态.png')
    await page.screenshot({ path: ss3Path, fullPage: false })
    result.screenshots.push({ name: '数据状态', file: ss3Path, timestamp: new Date().toISOString() })

    if (domInfo.tables > 0) {
      const tableRows = await safeEvaluate(page, () => document.querySelectorAll('.el-table__body tr, table tbody tr').length) || 0
      if (tableRows > 0) {
        result.checks.push({ category: '数据', name: '列表有数据', status: 'pass', detail: `${tableRows}行` })
      } else if (domInfo.hasEmpty) {
        result.checks.push({ category: '数据', name: '列表数据', status: 'pass', detail: '空状态提示' })
      }
    }

    // API 失败
    if (failedRequests.length > 0) {
      const apiErrors = failedRequests.map(r => `${r.method} ${r.url.split('/api/')[1]} → ${r.status}`).join('; ')
      result.checks.push({ category: 'API', name: 'API错误', status: 'warning', detail: `${failedRequests.length}个: ${apiErrors}` })
      result.issues.push({ severity: 'high', title: `${pageInfo.name} - API失败`, description: apiErrors, screenshot: ss2Path })
    } else {
      result.checks.push({ category: 'API', name: 'API正常', status: 'pass', detail: '所有API请求正常' })
    }

    // ===== Step 4: 交互验证（standard/deep） =====
    if (mode === 'standard' || mode === 'deep') {
      const searchInputs = await page.$$('input[placeholder*="搜索"], input[placeholder*="请输入"], input[placeholder*="查询"]')
      if (searchInputs.length > 0) {
        try {
          await searchInputs[0].fill('测试')
          await page.waitForTimeout(1000)
          const ss4Path = join(screenshotDir, '004-搜索测试.png')
          await page.screenshot({ path: ss4Path, fullPage: false })
          result.screenshots.push({ name: '搜索功能测试', file: ss4Path, timestamp: new Date().toISOString() })
          result.checks.push({ category: '交互', name: '搜索框可输入', status: 'pass', detail: '可正常输入' })
          await searchInputs[0].fill('')
          await page.waitForTimeout(500)
        } catch (e) {
          result.checks.push({ category: '交互', name: '搜索框', status: 'warning', detail: e.message })
        }
      }

      const mainButtons = await safeEvaluate(page, () =>
        Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null).map(b => b.textContent?.trim()).filter(t => t && t.length < 20).slice(0, 5)
      ) || []
      if (mainButtons.length > 0) {
        result.checks.push({ category: '交互', name: '可操作按钮', status: 'pass', detail: `${mainButtons.length}个: ${mainButtons.join(', ')}` })
      }
    }

    // DOM 快照
    const domSnapshot = await page.content()
    writeFileSync(join(pageDir, 'dom-snapshot.html'), domSnapshot, 'utf-8')

    page.off('console', consoleListener)
    page.off('response', responseListener)

    // 评分
    const passedChecks = result.checks.filter(c => c.status === 'pass').length
    const totalChecks = result.checks.length
    result.score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0
    const criticalIssues = result.issues.filter(i => i.severity === 'critical').length
    const highIssues = result.issues.filter(i => i.severity === 'high').length
    result.score = Math.max(0, result.score - criticalIssues * 30 - highIssues * 10)

    if (result.issues.some(i => i.severity === 'critical')) result.overallStatus = 'error'
    else if (result.issues.some(i => i.severity === 'high')) result.overallStatus = 'fail'
    else if (result.issues.length > 0) result.overallStatus = 'warning'
    else result.overallStatus = 'pass'

  } catch (error) {
    result.overallStatus = 'error'
    result.issues.push({ severity: 'critical', title: `${pageInfo.name} - 测试错误`, description: error.message })
    result.score = 0
    try {
      const errorSS = join(screenshotDir, '999-错误现场.png')
      await page.screenshot({ path: errorSS, fullPage: false })
      result.screenshots.push({ name: '错误现场', file: errorSS, timestamp: new Date().toISOString() })
    } catch (_) {}
  }

  writeFileSync(join(pageDir, 'result.json'), JSON.stringify(finalize(result, startTime), null, 2), 'utf-8')
  return finalize(result, startTime)
}

function finalize(result, startTime) {
  result.finishedAt = new Date().toISOString()
  result.duration = Date.now() - startTime
  return result
}
