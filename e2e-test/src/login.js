import { chromium } from 'playwright'
import config from './config.js'

let browser = null
let page = null

/**
 * 后端健康检查 - 确保API可用
 */
async function checkBackendHealth(baseUrl, maxRetries = 3) {
  const apiBase = baseUrl.replace(/\/$/, '')
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`${apiBase}/api/common/auth/loginStatus`, {
        signal: AbortSignal.timeout(5000)
      })
      if (resp.ok || resp.status === 401 || resp.status === 403) {
        console.log(`[健康检查] 后端API正常 (status=${resp.status})`)
        return true
      }
      console.log(`[健康检查] 后端返回非预期状态: ${resp.status}`)
    } catch (e) {
      console.log(`[健康检查] 第${i + 1}次检查失败: ${e.message}`)
      if (i < maxRetries - 1) {
        console.log(`[健康检查] ${3}秒后重试...`)
        await new Promise(r => setTimeout(r, 3000))
      }
    }
  }
  return false
}

/**
 * 启动浏览器并自动登录
 * 返回已登录的 page 对象
 */
export async function initBrowser() {
  if (browser) {
    await browser.close()
  }

  // 后端健康检查
  const healthy = await checkBackendHealth(config.target.baseUrl)
  if (!healthy) {
    console.warn('[警告] 后端API不可用，E2E测试可能失败！')
    console.warn('[警告] 请确认后端服务已启动且可访问')
  }

  const { headless, viewport } = config.browser

  browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const context = await browser.newContext({
    viewport,
    ignoreHTTPSErrors: true
  })

  page = await context.newPage()
  page.setDefaultTimeout(config.browser.timeout)

  // 监听网络请求（调试登录）
  page.on('request', req => {
    if (req.url().includes('/auth/')) {
      console.log(`[网络] ${req.method()} ${req.url()}`)
    }
  })
  page.on('response', res => {
    if (res.url().includes('/auth/') || res.url().includes('/login')) {
      console.log(`[网络] <- ${res.status()} ${res.url()}`)
    }
  })
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[页面Console错误] ${msg.text()}`)
    }
  })

  console.log('[浏览器] 已启动')

  // 自动登录
  if (config.auth.autoLogin) {
    await login(page)
  }

  return { browser, page }
}

/**
 * 自动登录系统
 * 前端登录流程：checkLogin -> login -> routeTo
 */
async function login(page) {
  const { baseUrl } = config.target
  const loginUrl = `${baseUrl}${config.target.loginPage}`

  console.log(`[登录] 访问登录页: ${loginUrl}`)
  await page.goto(loginUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // 使用 getByPlaceholder
  const usernameInput = page.getByPlaceholder('请输入您的用户名')
  await usernameInput.waitFor({ state: 'visible' })
  await usernameInput.click()
  await usernameInput.fill(config.auth.username)
  console.log(`[登录] 已填写用户名: ${config.auth.username}`)

  const passwordInput = page.getByPlaceholder('请输入您的密码')
  await passwordInput.waitFor({ state: 'visible' })
  await passwordInput.click()
  await passwordInput.fill(config.auth.password)
  console.log('[登录] 已填写密码')

  // 点击登录按钮
  await page.waitForTimeout(500)
  const loginBtn = page.getByRole('button', { name: '点击登录' })
  await loginBtn.waitFor({ state: 'visible' })

  // 最多重试 3 次
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[登录] 第${attempt}次尝试登录...`)

    // 监听 checkLogin 和 login 接口响应
    const authResponsePromise = page.waitForResponse(
      resp => resp.url().includes('/auth/login') && !resp.url().includes('checkLogin'),
      { timeout: 20000 }
    ).catch(() => null)

    await loginBtn.click()

    // 等待 login 接口返回
    const loginResp = await authResponsePromise
    if (loginResp) {
      const body = await loginResp.json().catch(() => null)
      console.log(`[登录] login接口响应: status=${loginResp.status()} data=${JSON.stringify(body)?.substring(0, 200)}`)
    } else {
      console.log('[登录] 未捕获到login接口响应')
    }

    // 等待跳转 - 用 hash 判断
    try {
      await page.waitForFunction(() => !window.location.hash.includes('login'), { timeout: 8000 })
      console.log(`[登录] 登录成功，已跳转到: ${page.url()}`)

      // 等待页面稳定
      await page.waitForTimeout(2000)
      return page
    } catch (e) {
      const currentUrl = page.url()
      console.log(`[登录] 第${attempt}次跳转等待超时，当前: ${currentUrl}`)

      if (currentUrl.includes('#/login')) {
        // 检查错误提示
        const errorText = await page.evaluate(() => {
          const els = document.querySelectorAll('.el-message, .el-form-item__error, .error, [class*="error"], [class*="message"]')
          return Array.from(els).map(el => el.textContent?.trim()).filter(Boolean).join(' | ')
        })
        if (errorText) console.log(`[登录] 错误提示: ${errorText}`)

        if (attempt < 3) {
          console.log('[登录] 重新填写表单...')
          await page.waitForTimeout(1000)
          await usernameInput.fill('')
          await usernameInput.fill(config.auth.username)
          await passwordInput.fill('')
          await passwordInput.fill(config.auth.password)
          await page.waitForTimeout(500)
        } else {
          await page.screenshot({ path: 'F:/e2e-test-data/login-debug.png' })
          throw new Error('登录失败（3次尝试均失败）。截图: F:/e2e-test-data/login-debug.png')
        }
      } else {
        console.log('[登录] URL已变化，继续执行')
        await page.waitForTimeout(2000)
        return page
      }
    }
  }
}

/**
 * 获取当前 page（确保已初始化）
 */
export function getPage() {
  if (!page) throw new Error('浏览器未初始化，请先调用 initBrowser()')
  return page
}

/**
 * 关闭浏览器
 */
export async function closeBrowser() {
  if (browser) {
    await browser.close()
    browser = null
    page = null
    console.log('[浏览器] 已关闭')
  }
}
