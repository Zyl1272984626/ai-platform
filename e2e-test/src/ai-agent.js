/**
 * AI Agent 测试引擎 v3.0
 *
 * 核心循环：observe → think → act → validate
 * - observe: 用 Playwright 采集页面状态（a11y树、截图、控制台、网络）
 * - think:  Claude API 分析状态，决策下一步操作
 * - act:    Playwright 执行操作（点击、填写、输入）
 * - validate: 操作后检查结果
 */

import Anthropic from '@anthropic-ai/sdk'
import config from './config.js'
import { readFileSync } from 'fs'
import { join } from 'path'

const __dirname = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

// 知识图谱缓存
let pageContextCache = null

function loadPageContext() {
  if (pageContextCache) return pageContextCache
  try {
    const filePath = join(__dirname, '..', config.knowledge.path, config.knowledge.pageContextFile)
    pageContextCache = JSON.parse(readFileSync(filePath, 'utf-8'))
    console.log(`[知识图谱] 已加载 ${Object.keys(pageContextCache).length} 个页面上下文`)
    return pageContextCache
  } catch (e) {
    console.log(`[知识图谱] 加载失败: ${e.message}，将不使用页面上下文`)
    return {}
  }
}

function getPageContext(pageId) {
  const ctx = loadPageContext()
  return ctx[pageId] || null
}

// Claude API 客户端
function getClaudeClient() {
  const apiKey = process.env[config.ai.apiKeyEnv]
  if (!apiKey) throw new Error(`未设置环境变量 ${config.ai.apiKeyEnv}`)
  return new Anthropic({ apiKey })
}

/**
 * observe — 采集页面当前状态
 */
async function observe(page, screenshotDir, screenshotSeq) {
  // 1. 无障碍树（a11y tree）— 结构化页面信息，低 token
  let a11yTree = ''
  try {
    const snapshot = await page.accessibility.snapshot()
    a11yTree = serializeA11y(snapshot, '', 0)
    // 截断太长的树
    if (a11yTree.length > 8000) {
      a11yTree = a11yTree.substring(0, 8000) + '\n... (已截断)'
    }
  } catch (e) {
    a11yTree = '(无法获取无障碍树: ' + e.message + ')'
  }

  // 2. 截图
  let screenshotPath = null
  try {
    const seq = String(screenshotSeq.value++).padStart(3, '0')
    screenshotPath = join(screenshotDir, `${seq}-agent观察.png`)
    await page.screenshot({ path: screenshotPath, fullPage: false })
  } catch (_) {}

  // 3. 控制台日志（只取 error）
  let consoleErrors = []
  try {
    // 从 page 上的 console 事件中读取（需要调用方注册监听）
    // 这里通过 evaluate 获取最近的错误
    consoleErrors = await page.evaluate(() => {
      return window.__e2eConsoleErrors || []
    }).catch(() => [])
  } catch (_) {}

  // 4. 页面基本信息
  let pageInfo = {}
  try {
    pageInfo = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      bodyText: document.body?.innerText?.substring(0, 1500) || '',
      visibleButtons: Array.from(document.querySelectorAll('button'))
        .filter(b => b.offsetParent !== null)
        .map(b => b.textContent?.trim())
        .filter(t => t && t.length < 20)
        .slice(0, 15),
      errorDialogs: Array.from(document.querySelectorAll('.el-message--error, .el-notification--error, [class*="error"]'))
        .filter(el => el.offsetParent !== null && el.textContent?.trim())
        .map(el => el.textContent?.trim().substring(0, 200))
        .slice(0, 5)
    }))
  } catch (_) {}

  return { a11yTree, screenshotPath, consoleErrors, pageInfo }
}

/**
 * 序列化无障碍树为可读文本
 */
function serializeA11y(node, indent, depth) {
  if (!node || depth > 8) return ''
  const role = node.role || ''
  const name = node.name || ''
  const value = node.value ? `="${String(node.value).substring(0, 50)}"` : ''
  let line = ''
  if (role || name) {
    line = `${indent}[${role}] ${name}${value}\n`
  }
  let result = line
  if (node.children) {
    for (const child of node.children) {
      result += serializeA11y(child, indent + '  ', depth + 1)
    }
  }
  return result
}

/**
 * think — Claude 分析页面状态，决策下一步
 */
async function think(observations, pageContext, mode, round, maxRounds, previousActions) {
  const client = getClaudeClient()

  const contextStr = pageContext
    ? `页面功能描述：${pageContext.description}
预期元素：${pageContext.expectedElements?.join('、')}
预期交互：${pageContext.interactions?.map(i => `${i.action} → ${i.expected}`).join('；')}
已知问题提示：${pageContext.commonIssues?.join('、')}`
    : '（无页面功能上下文，请根据页面内容自行判断）'

  const prompt = `你是一个严格的QA测试工程师，正在用浏览器测试一个Web管理系统。你需要像真人一样操作页面，发现UI问题、功能漏洞和体验问题。

## 测试模式：${mode}
- ${mode === 'quick' ? '快速巡检：只观察不操作，判断页面是否正常' : ''}
- ${mode === 'standard' ? '标准测试：观察+主动交互（点击按钮、填写表单、搜索等），验证核心功能' : ''}
- ${mode === 'deep' ? '深度审计：全面交互+边界测试+异常路径，主动找所有问题' : ''}

## 当前页面上下文
- 页面名称：${pageContext?.pageName || '未知'}
- 功能：${contextStr}

## 第 ${round}/${maxRounds} 轮观察
### 页面标题和URL
${observations.pageInfo.title} — ${observations.pageInfo.url}

### 页面文本内容（前1000字）
${(observations.pageInfo.bodyText || '').substring(0, 1000)}

### 可见按钮
${(observations.pageInfo.visibleButtons || []).join('、') || '（无）'}

### 错误弹窗（页面上的红色提示）
${(observations.pageInfo.errorDialogs || []).join('\n') || '（无）'}

### 无障碍树（页面结构）
${observations.a11yTree}

### 控制台错误
${observations.consoleErrors.length > 0 ? observations.consoleErrors.join('\n') : '（无）'}

${previousActions.length > 0 ? `### 之前已执行的操作\n${previousActions.map((a, i) => `${i + 1}. ${a}`).join('\n')}` : ''}

## 你的任务
1. 判断当前页面是否正常（有无白屏、报错、布局异常、数据缺失）
2. ${mode === 'quick' ? '不做任何操作，直接给出评分' : '决定下一步该做什么操作（点击按钮、填写表单、搜索等）'}
3. 发现的任何问题都要记录（包括页面上的红色错误弹窗）

## 输出格式（严格JSON）
{
  "status": "pass | warning | fail | error",
  "issues": [
    { "severity": "critical|high|medium|low", "title": "问题标题", "description": "问题描述" }
  ],
  "nextAction": {
    "type": "click | fill | type | navigate | none",
    "target": "按钮文字或元素描述",
    "value": "要填写的值（仅fill/type需要）",
    "reason": "为什么做这个操作"
  }
}

如果测试已经充分（没有更多需要检查的），或者当前是 quick 模式，nextAction 设为 null。
issues 如果没有发现问题就设为空数组 []。`

  try {
    const response = await client.messages.create({
      model: config.ai.model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })

    const text = response.content[0]?.text || ''

    // 提取JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { status: 'warning', issues: [], nextAction: null, rawResponse: text }
    }

    return JSON.parse(jsonMatch[0])
  } catch (e) {
    console.error(`[AI Agent] Claude API 调用失败: ${e.message}`)
    return { status: 'error', issues: [{ severity: 'high', title: 'AI分析失败', description: e.message }], nextAction: null }
  }
}

/**
 * act — 根据 AI 决策执行浏览器操作
 */
async function act(page, action, screenshotDir, screenshotSeq) {
  if (!action || action.type === 'none') return { success: true, description: '无操作' }

  const description = action.reason || `${action.type}: ${action.target}`
  console.log(`[AI Agent] 执行操作: ${description}`)

  try {
    switch (action.type) {
      case 'click': {
        // 优先用文字匹配找到按钮/元素
        const target = action.target
        // 尝试多种选择器策略
        const selectors = [
          `button:has-text("${target}")`,
          `[role="button"]:has-text("${target}")`,
          `a:has-text("${target}")`,
          `text="${target}"`
        ]

        let clicked = false
        for (const selector of selectors) {
          try {
            const el = page.locator(selector).first()
            if (await el.isVisible({ timeout: 2000 })) {
              await el.click()
              clicked = true
              break
            }
          } catch (_) { continue }
        }

        if (!clicked) {
          // 尝试通过包含文字的方式
          try {
            await page.getByText(target, { exact: false }).first().click({ timeout: 3000 })
            clicked = true
          } catch (_) {}
        }

        if (!clicked) {
          return { success: false, description: `未找到可点击的元素: ${target}` }
        }

        // 操作后截图
        await page.waitForTimeout(1500)
        const seq = String(screenshotSeq.value++).padStart(3, '0')
        const ssPath = join(screenshotDir, `${seq}-点击${target}.png`)
        await page.screenshot({ path: ssPath, fullPage: false })
        return { success: true, description: `点击了 ${target}`, screenshot: ssPath }
      }

      case 'fill':
      case 'type': {
        const target = action.target
        const value = action.value || ''

        // 找输入框
        const inputSelectors = [
          `input[placeholder*="${target}"]`,
          `input[placeholder*="搜索"]`,
          `input[placeholder*="请输入"]`,
          `textarea`
        ]

        let filled = false
        for (const selector of inputSelectors) {
          try {
            const el = page.locator(selector).first()
            if (await el.isVisible({ timeout: 2000 })) {
              await el.click()
              await el.fill(value)
              filled = true
              break
            }
          } catch (_) { continue }
        }

        if (!filled) {
          return { success: false, description: `未找到可填写的输入框: ${target}` }
        }

        await page.waitForTimeout(1000)
        const seq = String(screenshotSeq.value++).padStart(3, '0')
        const ssPath = join(screenshotDir, `${seq}-填写${target}.png`)
        await page.screenshot({ path: ssPath, fullPage: false })
        return { success: true, description: `在 ${target} 填写了 ${value}`, screenshot: ssPath }
      }

      case 'navigate': {
        await page.waitForTimeout(2000)
        return { success: true, description: '等待页面稳定' }
      }

      default:
        return { success: false, description: `未知操作类型: ${action.type}` }
    }
  } catch (e) {
    return { success: false, description: `操作执行失败: ${e.message}` }
  }
}

/**
 * AI Agent 主循环 — 对单个页面执行完整的测试
 *
 * @param {import('playwright').Page} page - Playwright page 对象
 * @param {Object} pageInfo - 页面信息 { id, name, url }
 * @param {string} runId - 运行ID
 * @param {string} mode - 测试模式 quick/standard/deep
 * @param {Function} onProgress - 进度回调
 * @returns {Object} 测试结果
 */
export async function runAgentTest(page, pageInfo, runId, mode = 'standard', onProgress = null) {
  const maxRounds = config.ai.maxTurns[mode] || 5
  const screenshotSeq = { value: 1 }

  const pageDir = join(storagePath, 'runs', runId, pageInfo.id)
  const screenshotDir = join(pageDir, 'screenshots')
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true })

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
    agentTimeline: [],  // AI Agent 操作时间线
    performance: null
  }

  const startTime = Date.now()
  const emit = (type, data) => onProgress && onProgress(type, data)

  try {
    // ===== 导航到页面 =====
    console.log(`\n${'='.repeat(60)}`)
    console.log(`[AI Agent] 开始测试: ${pageInfo.name} (${pageInfo.url})`)
    console.log(`[AI Agent] 模式: ${mode}, 最大轮数: ${maxRounds}`)
    console.log(`${'='.repeat(60)}`)

    emit('page:start', { pageId: pageInfo.id, pageName: pageInfo.name, url: pageInfo.url })

    // 注册控制台错误监听
    const consoleErrors = []
    const consoleListener = msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    }
    page.on('console', consoleListener)

    // 注册网络请求监听
    const failedRequests = []
    const responseListener = resp => {
      const url = resp.url()
      const status = resp.status()
      if (url.includes('/api/') && (status >= 400 || status === 0)) {
        failedRequests.push({ url, status, method: resp.request().method() })
      }
    }
    page.on('response', responseListener)

    // 暴露 console errors 到 window 对象供 observe 读取
    await page.evaluate(() => { window.__e2eConsoleErrors = [] })
    page.on('console', msg => {
      if (msg.type() === 'error') {
        page.evaluate(text => window.__e2eConsoleErrors.push(text), msg.text()).catch(() => {})
      }
    })

    // 导航
    await page.goto(pageInfo.url, { waitUntil: 'domcontentloaded', timeout: config.browser.timeout })
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch (_) {}
    await page.waitForTimeout(2000)

    // 性能数据
    const perfData = await page.evaluate(() => {
      const entries = performance.getEntriesByType('navigation')
      if (!entries.length) return null
      const nav = entries[0]
      return {
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart),
        totalLoadTime: Math.round(nav.loadEventEnd),
        domInteractive: Math.round(nav.domInteractive)
      }
    }).catch(() => null)
    if (perfData) result.performance = perfData

    // ===== 获取页面知识上下文 =====
    const pageContext = getPageContext(pageInfo.id)

    // ===== AI Agent 循环 =====
    const previousActions = []
    let lastStatus = 'pass'
    let allIssues = []

    for (let round = 1; round <= maxRounds; round++) {
      console.log(`\n[AI Agent] --- 第 ${round}/${maxRounds} 轮 ---`)

      // observe
      const observations = await observe(page, screenshotDir, screenshotSeq)
      if (observations.screenshotPath) {
        result.screenshots.push({ name: `第${round}轮-观察`, file: observations.screenshotPath, timestamp: new Date().toISOString() })
      }

      // 合并控制台错误到 observations
      observations.consoleErrors = [...new Set([...observations.consoleErrors, ...consoleErrors.slice(-10)])]

      // think
      const aiDecision = await think(observations, pageContext, mode, round, maxRounds, previousActions)

      // 记录时间线
      const timelineEntry = {
        round,
        status: aiDecision.status,
        issues: aiDecision.issues || [],
        action: aiDecision.nextAction ? { ...aiDecision.nextAction } : null
      }
      result.agentTimeline.push(timelineEntry)

      // 收集问题
      if (aiDecision.issues?.length > 0) {
        allIssues.push(...aiDecision.issues.map(issue => ({
          ...issue,
          round,
          screenshot: observations.screenshotPath
        })))
      }

      lastStatus = aiDecision.status
      console.log(`[AI Agent] AI判断: ${aiDecision.status}, 问题: ${aiDecision.issues?.length || 0}个`)

      // 记录检查项
      result.checks.push({
        category: `AI第${round}轮`,
        name: aiDecision.nextAction?.reason || `页面状态检查`,
        status: aiDecision.status === 'pass' ? 'pass' : aiDecision.status === 'error' ? 'error' : 'warning',
        detail: aiDecision.issues?.map(i => i.title).join('; ') || '正常'
      })

      emit('page:check', {
        pageId: pageInfo.id,
        name: `第${round}轮 AI分析`,
        status: aiDecision.status === 'pass' ? 'pass' : 'warning',
        detail: aiDecision.nextAction?.reason || '状态检查'
      })

      // 如果 quick 模式或 AI 不再建议操作，结束循环
      if (mode === 'quick' || !aiDecision.nextAction || aiDecision.nextAction.type === 'none') {
        console.log(`[AI Agent] 测试完成（${mode === 'quick' ? '快速模式只观察' : 'AI判断无需继续'}）`)
        break
      }

      // act
      const actionResult = await act(page, aiDecision.nextAction, screenshotDir, screenshotSeq)
      previousActions.push(`${aiDecision.nextAction.type} ${aiDecision.nextAction.target} → ${actionResult.success ? '成功' : '失败'}`)

      if (actionResult.screenshot) {
        result.screenshots.push({ name: `第${round}轮-操作`, file: actionResult.screenshot, timestamp: new Date().toISOString() })
      }

      console.log(`[AI Agent] 操作结果: ${actionResult.description}`)

      // 操作后等待稳定
      await page.waitForTimeout(2000)
    }

    // ===== 收集 API 失败 =====
    if (failedRequests.length > 0) {
      const apiErrors = failedRequests.map(r => `${r.method} ${r.url.split('/api/')[1]?.substring(0, 60)} → ${r.status}`).join('; ')
      result.checks.push({ category: 'API', name: 'API请求错误', status: 'warning', detail: `${failedRequests.length}个API失败: ${apiErrors}` })
      allIssues.push({
        severity: 'high',
        title: `${pageInfo.name} - API请求失败`,
        description: apiErrors,
        round: 0
      })
    }

    // ===== 汇总问题（去重） =====
    const seenTitles = new Set()
    result.issues = allIssues.filter(issue => {
      if (seenTitles.has(issue.title)) return false
      seenTitles.add(issue.title)
      return true
    })

    // ===== 保存 DOM 快照 =====
    try {
      const domSnapshot = await page.content()
      const domPath = join(pageDir, 'dom-snapshot.html')
      writeFileSync(domPath, domSnapshot, 'utf-8')
    } catch (_) {}

    // ===== 移除监听 =====
    page.off('console', consoleListener)
    page.off('response', responseListener)

    // ===== 计算评分 =====
    const passedChecks = result.checks.filter(c => c.status === 'pass').length
    const totalChecks = result.checks.length
    result.score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 50

    const criticalIssues = result.issues.filter(i => i.severity === 'critical').length
    const highIssues = result.issues.filter(i => i.severity === 'high').length
    result.score = Math.max(0, result.score - criticalIssues * 30 - highIssues * 10)

    if (result.issues.some(i => i.severity === 'critical')) {
      result.overallStatus = 'error'
    } else if (result.issues.some(i => i.severity === 'high')) {
      result.overallStatus = 'fail'
    } else if (result.issues.length > 0) {
      result.overallStatus = 'warning'
    } else {
      result.overallStatus = 'pass'
    }

    console.log(`\n[AI Agent] 测试完成: ${pageInfo.name} | 评分 ${result.score} | 状态 ${result.overallStatus} | 问题 ${result.issues.length}个`)

  } catch (error) {
    console.error(`[AI Agent] 页面 ${pageInfo.name} 测试出错: ${error.message}`)
    result.overallStatus = 'error'
    result.issues.push({
      severity: 'critical',
      title: `${pageInfo.name} - 测试执行错误`,
      description: error.message
    })
    result.score = 0

    try {
      const errorSS = join(screenshotDir, '999-错误现场.png')
      await page.screenshot({ path: errorSS, fullPage: false })
      result.screenshots.push({ name: '错误现场', file: errorSS, timestamp: new Date().toISOString() })
    } catch (_) {}
  }

  // 保存 result.json
  result.finishedAt = new Date().toISOString()
  result.duration = Date.now() - startTime
  const resultPath = join(pageDir, 'result.json')
  writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8')

  emit('page:done', { pageId: pageInfo.id, score: result.score, status: result.overallStatus })

  return result
}

// 需要从 config 导入的
import { storagePath } from './config.js'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
