import { config, storagePath, generateRunId, __dirname } from './config.js'
import { initBrowser, closeBrowser } from './login.js'
import { testPage } from './page-tester.js'
import { generateReport } from './reporter.js'
import { saveBaseline, compareBaseline } from './baseline.js'
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

// ===== 页面配置：优先从平台项目配置读取 =====
const BASE = config.target.baseUrl

/**
 * 尝试从 ai-platform 的 platform-config.json 加载项目的 pageSets
 * 支持 --projectId 参数选择项目，默认用 defaultProjectId
 */
function loadPagesFromProjectConfig() {
  const args = process.argv.slice(2)
  const projectId = getArgValue(args, '--projectId', '')

  // 尝试读取 platform-config.json
  const configPaths = [
    resolve(__dirname, '..', '..', 'server', 'data', 'platform-config.json'),
    resolve(__dirname, '..', '..', 'data', 'platform-config.json'),
  ]

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue

    try {
      const platformConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (!platformConfig.projects || platformConfig.projects.length === 0) continue

      // 选择项目
      const targetId = projectId || platformConfig.defaultProjectId
      const project = platformConfig.projects.find(p => p.id === targetId)
        || platformConfig.projects[0]

      if (!project.pageSets || project.pageSets.length === 0) {
        console.log(`[页面配置] 项目 "${project.name}" 尚未发现页面，请先在设置页面点击"发现页面"`)
        return null
      }

      // 展开 pageSets 为扁平页面列表
      const pages = project.pageSets.flatMap(ps => ps.pages.map(p => ({
        id: p.id,
        name: p.name,
        url: `${project.baseUrl}${p.url}`,
        description: p.description || p.name,
        pageSetId: ps.id,
        pageSetName: ps.name,
      })))

      // 构建 scope 映射
      const scopeMap = {}
      for (const ps of project.pageSets) {
        scopeMap[ps.id] = ps.pages.map(p => ({
          id: p.id,
          name: p.name,
          url: `${project.baseUrl}${p.url}`,
          description: p.description || p.name,
          pageSetId: ps.id,
          pageSetName: ps.name,
        }))
      }

      console.log(`[页面配置] 从项目配置加载: ${project.name} (${pages.length} 页, ${project.pageSets.length} 个页面集)`)

      return { pages, scopeMap, project }
    } catch (e) {
      console.warn(`[页面配置] 读取 ${configPath} 失败: ${e.message}`)
    }
  }

  return null
}

// ===== 旧版硬编码页面（向后兼容，项目配置无页面时回退） =====
const FALLBACK_PAGES = buildFallbackPages()

function buildFallbackPages() {
  // admin 系统管理模块 (6页)
  const ADMIN_SYS_PAGES = [
    { id: 'admin-sys-code', name: '代码管理', url: `${BASE}/admin/index.html#/sys/code`, description: '系统代码/字典管理' },
    { id: 'admin-sys-config', name: '配置管理', url: `${BASE}/admin/index.html#/sys/config`, description: '系统参数配置' },
    { id: 'admin-sys-database', name: '数据源管理', url: `${BASE}/admin/index.html#/sys/database`, description: '数据库连接管理' },
    { id: 'admin-sys-storage', name: '仓库管理', url: `${BASE}/admin/index.html#/sys/storage`, description: '文件仓库列表' },
    { id: 'admin-sys-storage-file', name: '文件管理', url: `${BASE}/admin/index.html#/sys/storage/file`, description: '仓库内文件浏览' },
    { id: 'admin-sys-mention', name: '注入配置', url: `${BASE}/admin/index.html#/sys/mention`, description: 'Prompt注入/提及配置' }
  ]
  const ADMIN_PERMISSION_PAGES = [
    { id: 'admin-perm-user', name: '用户管理', url: `${BASE}/admin/index.html#/permission/user`, description: '系统用户管理' },
    { id: 'admin-perm-role', name: '角色管理', url: `${BASE}/admin/index.html#/permission/role`, description: '角色权限管理' },
    { id: 'admin-perm-resource', name: '资源管理', url: `${BASE}/admin/index.html#/permission/resource`, description: '系统资源/菜单管理' }
  ]
  const ADMIN_BASE_PAGES = [
    { id: 'admin-base-model-source', name: '模型来源管理', url: `${BASE}/admin/index.html#/base/model-source`, description: 'AI模型来源配置' },
    { id: 'admin-base-model', name: '模型管理', url: `${BASE}/admin/index.html#/base/model`, description: 'AI模型列表管理' },
    { id: 'admin-base-plugin', name: '流程插件管理', url: `${BASE}/admin/index.html#/base/plugin`, description: '流程插件配置' },
    { id: 'admin-base-business', name: '业务系统管理', url: `${BASE}/admin/index.html#/base/business-system`, description: '业务系统配置' }
  ]
  const ADMIN_TASK_PAGES = [
    { id: 'admin-task-list', name: '任务列表', url: `${BASE}/admin/index.html#/task/list`, description: '定时任务管理' },
    { id: 'admin-task-execute', name: '任务执行日志', url: `${BASE}/admin/index.html#/task/execute`, description: '任务执行记录' },
    { id: 'admin-task-sync', name: '数据同步配置', url: `${BASE}/admin/index.html#/task/data-sync-config`, description: '数据同步任务设置' }
  ]
  const ADMIN_PAGE_FACTORY_PAGES = [
    { id: 'admin-pf-hardcode', name: '硬编码配置', url: `${BASE}/admin/index.html#/pageFactory/hardcode`, description: '硬编码页面配置' },
    { id: 'admin-pf-globalview', name: '全局视图', url: `${BASE}/admin/index.html#/pageFactory/globalview`, description: '全局视图配置' },
    { id: 'admin-pf-common-query', name: '通用查询管理', url: `${BASE}/admin/index.html#/pageFactory/common-query`, description: '通用查询配置' },
    { id: 'admin-pf-page', name: '页面配置管理', url: `${BASE}/admin/index.html#/pageFactory/page`, description: '页面配置' },
    { id: 'admin-pf-page-content', name: '页面HTML检索', url: `${BASE}/admin/index.html#/pageFactory/pageContent`, description: 'HTML代码检索' },
    { id: 'admin-pf-template', name: '页面模板管理', url: `${BASE}/admin/index.html#/pageFactory/template`, description: '页面模板配置' },
    { id: 'admin-pf-dept', name: '页面部门管理', url: `${BASE}/admin/index.html#/pageFactory/dept`, description: '页面部门配置' }
  ]
  const ADMIN_ALL_PAGES = [...ADMIN_SYS_PAGES, ...ADMIN_PERMISSION_PAGES, ...ADMIN_BASE_PAGES, ...ADMIN_TASK_PAGES, ...ADMIN_PAGE_FACTORY_PAGES]
  const INDEX_APP_PAGES = (appId) => [
    { id: `index-${appId}-agent`, name: '智能体列表', url: `${BASE}/index/index.html#/app/${appId}/agent`, description: '智能体管理列表' },
    { id: `index-${appId}-agent-user`, name: '智能体用户列表', url: `${BASE}/index/index.html#/app/${appId}/agent/user`, description: '智能体用户管理' },
    { id: `index-${appId}-workflow`, name: '流程列表', url: `${BASE}/index/index.html#/app/${appId}/workflow`, description: '工作流管理' },
    { id: `index-${appId}-plugin`, name: '插件管理', url: `${BASE}/index/index.html#/app/${appId}/plugin`, description: '插件列表' },
    { id: `index-${appId}-skill`, name: '技能列表', url: `${BASE}/index/index.html#/app/${appId}/skill`, description: '技能管理' },
    { id: `index-${appId}-analytics`, name: '会话监控分析', url: `${BASE}/index/index.html#/app/${appId}/analytics`, description: '会话统计分析' },
    { id: `index-${appId}-dataTable`, name: '数据表', url: `${BASE}/index/index.html#/app/${appId}/dataTable`, description: '数据表管理' },
    { id: `index-${appId}-knowledgeBase`, name: '知识库', url: `${BASE}/index/index.html#/app/${appId}/knowledgeBase`, description: '知识库管理' },
    { id: `index-${appId}-comp`, name: '组件管理', url: `${BASE}/index/index.html#/app/${appId}/comp`, description: '组件列表' }
  ]
  const CHAT_AGENT_ID = '40286e819e3f4ddf019e3f5adc98002d'
  const CHAT_PAGES = [
    { id: 'chat-home', name: '对话首页', url: `${BASE}/chat/index.html#/chat`, description: '聊天主页' },
    { id: 'chat-agent', name: '智能体对话', url: `${BASE}/chat/index.html#/chat?agentId=${CHAT_AGENT_ID}`, description: '指定智能体对话' },
    { id: 'chat-user', name: '用户门户', url: `${BASE}/chat/index.html#/user/chat`, description: '用户对话门户' },
    { id: 'chat-user-agents', name: '智能体组织', url: `${BASE}/chat/index.html#/user/agents`, description: '智能体列表' },
    { id: 'chat-user-tables', name: '用户数据表', url: `${BASE}/chat/index.html#/user/data-tables`, description: '用户数据表' },
    { id: 'chat-user-components', name: '业务组件', url: `${BASE}/chat/index.html#/user/components`, description: '业务组件' }
  ]
  const SETTING_SYS_PAGES = [
    { id: 'setting-sys-app', name: '智能体应用管理', url: `${BASE}/setting-system/index.html#/app`, description: '智能体应用配置' },
    { id: 'setting-sys-code', name: '代码管理', url: `${BASE}/setting-system/index.html#/code`, description: '代码/字典管理' },
    { id: 'setting-sys-model', name: '模型管理', url: `${BASE}/setting-system/index.html#/model`, description: 'AI模型管理' },
    { id: 'setting-sys-config', name: '配置管理', url: `${BASE}/setting-system/index.html#/config`, description: '系统配置管理' },
    { id: 'setting-sys-datasource', name: '数据源管理', url: `${BASE}/setting-system/index.html#/datasource`, description: '数据库连接管理' },
    { id: 'setting-sys-storage', name: '存储管理', url: `${BASE}/setting-system/index.html#/storage`, description: '文件存储管理' },
    { id: 'setting-sys-storage-file', name: '文件管理', url: `${BASE}/setting-system/index.html#/storage/file`, description: '文件浏览管理' },
    { id: 'setting-sys-knowledge-source', name: '知识库源管理', url: `${BASE}/setting-system/index.html#/knowledge/source`, description: '知识库数据源' },
    { id: 'setting-sys-datause', name: '数据访问控制', url: `${BASE}/setting-system/index.html#/datause`, description: '基础数据访问控制' },
    { id: 'setting-sys-third-party', name: '第三方系统管理', url: `${BASE}/setting-system/index.html#/third-party-system`, description: '第三方系统配置' },
    { id: 'setting-sys-openclaw', name: '运行容器管理', url: `${BASE}/setting-system/index.html#/openclaw`, description: '智能体运行容器' },
    { id: 'setting-sys-wxbot', name: '微信机器人管理', url: `${BASE}/setting-system/index.html#/wxbot`, description: '微信机器人用户' },
    { id: 'setting-sys-monitor', name: '资源监控', url: `${BASE}/setting-system/index.html#/monitor`, description: '系统资源监控' },
    { id: 'setting-sys-memory', name: '记忆管理', url: `${BASE}/setting-system/index.html#/memory`, description: '智能体记忆管理' }
  ]
  const SETTING_APP_PAGES = (appId) => [
    { id: `setting-app-${appId}-user`, name: '用户管理', url: `${BASE}/setting-app/index.html#/${appId}/permission/user`, description: '应用用户管理' },
    { id: `setting-app-${appId}-role`, name: '角色管理', url: `${BASE}/setting-app/index.html#/${appId}/permission/role`, description: '应用角色管理' },
    { id: `setting-app-${appId}-resource`, name: '资源管理', url: `${BASE}/setting-app/index.html#/${appId}/permission/resource`, description: '应用资源管理' },
    { id: `setting-app-${appId}-ug`, name: '用户组管理', url: `${BASE}/setting-app/index.html#/${appId}/permission/ug`, description: '用户组管理' },
    { id: `setting-app-${appId}-qwapp`, name: '企微应用管理', url: `${BASE}/setting-app/index.html#/${appId}/permission/qwapp`, description: '企业微信应用' },
    { id: `setting-app-${appId}-page`, name: '页面管理', url: `${BASE}/setting-app/index.html#/${appId}/sys/page`, description: '应用页面管理' },
    { id: `setting-app-${appId}-nav`, name: '导航管理', url: `${BASE}/setting-app/index.html#/${appId}/sys/nav`, description: '应用导航管理' },
    { id: `setting-app-${appId}-table`, name: '数据表管理', url: `${BASE}/setting-app/index.html#/${appId}/sys/table`, description: '数据表管理' },
    { id: `setting-app-${appId}-data-object`, name: '数据对象管理', url: `${BASE}/setting-app/index.html#/${appId}/sys/data-object`, description: '数据对象管理' },
    { id: `setting-app-${appId}-knowledge`, name: '知识库管理', url: `${BASE}/setting-app/index.html#/${appId}/sys/knowledge`, description: '知识库管理' },
    { id: `setting-app-${appId}-plugin`, name: '插件管理', url: `${BASE}/setting-app/index.html#/${appId}/sys/plugin`, description: '插件管理' },
    { id: `setting-app-${appId}-mention`, name: '注入配置', url: `${BASE}/setting-app/index.html#/${appId}/sys/mention`, description: 'Prompt注入配置' },
    { id: `setting-app-${appId}-api-config`, name: 'API配置管理', url: `${BASE}/setting-app/index.html#/${appId}/sys/api-config`, description: 'API接口配置' }
  ]
  const INDEX_BASE_PAGES = [
    { id: 'index-app-list', name: '应用列表', url: `${BASE}/index/index.html#/app-list`, description: '首页应用列表' }
  ]
  const INDEX_ALL_PAGES = [...INDEX_BASE_PAGES, ...config.target.apps.flatMap(app => INDEX_APP_PAGES(app.appId))]
  const SETTING_APP_ALL_PAGES = [...config.target.apps.flatMap(app => SETTING_APP_PAGES(app.appId))]

  return {
    'admin-sys': ADMIN_SYS_PAGES,
    'admin-all': ADMIN_ALL_PAGES,
    'index-all': INDEX_ALL_PAGES,
    'setting-sys': SETTING_SYS_PAGES,
    'setting-app': SETTING_APP_ALL_PAGES,
    'chat': CHAT_PAGES,
    'all': [...ADMIN_ALL_PAGES, ...INDEX_ALL_PAGES, ...SETTING_SYS_PAGES, ...SETTING_APP_ALL_PAGES, ...CHAT_PAGES],
  }
}

// ===== 解析命令行参数 =====
const args = process.argv.slice(2)
const mode = getArgValue(args, '--mode', config.defaults.mode)
const scope = getArgValue(args, '--scope', 'admin-sys')
const runId = generateRunId()

const hasAIKey = !!process.env[config.ai.apiKeyEnv]
const engineLabel = hasAIKey ? 'AI Agent 主动测试' : '传统规则检测（未设置AI Key）'

console.log('╔══════════════════════════════════════════════╗')
console.log('║     E2E 页面测试 v3.1 - 多项目支持           ║')
console.log('╠══════════════════════════════════════════════╣')
console.log(`║  Run ID : ${runId.padEnd(34)}║`)
console.log(`║  引擎   : ${engineLabel.padEnd(34)}║`)
console.log(`║  模式   : ${mode.padEnd(34)}║`)
console.log(`║  范围   : ${scope.padEnd(34)}║`)
console.log(`║  存储   : ${storagePath.padEnd(34)}║`)
console.log('╚══════════════════════════════════════════════╝\n')

// 选择测试页面：优先从项目配置读取
const projectConfig = loadPagesFromProjectConfig()
let pages = []

if (projectConfig) {
  // 从项目配置的 pageSets 加载
  if (scope === 'all') {
    pages = projectConfig.pages
  } else if (projectConfig.scopeMap[scope]) {
    pages = projectConfig.scopeMap[scope]
  } else {
    // scope 可能是 pageSet 的 id，也可能是 pageSet name 的部分匹配
    const match = projectConfig.project.pageSets.find(ps =>
      ps.id === scope || ps.name.includes(scope)
    )
    if (match) {
      pages = match.pages.map(p => ({
        id: p.id, name: p.name,
        url: `${projectConfig.project.baseUrl}${p.url}`,
        description: p.description || p.name,
      }))
    } else {
      // 回退到全部页面
      console.log(`[页面配置] scope "${scope}" 未匹配到页面集，使用全部页面`)
      pages = projectConfig.pages
    }
  }
  console.log(`[页面配置] 项目: ${projectConfig.project.name}, 页面数: ${pages.length}`)
} else {
  // 回退到旧版硬编码
  console.log('[页面配置] 使用内置硬编码页面列表（旧版兼容）')
  pages = FALLBACK_PAGES[scope] || FALLBACK_PAGES['admin-sys']
}

console.log(`[测试] 共 ${pages.length} 个页面待测试\n`)

// ===== 主流程 =====
async function main() {
  const runDir = join(storagePath, 'runs', runId)
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true })

  const results = []

  try {
    // Step 1: 启动浏览器 + 自动登录
    const { page } = await initBrowser()
    console.log('')

    // Step 2: 逐页测试
    for (let i = 0; i < pages.length; i++) {
      const pageInfo = pages[i]
      console.log(`\n${'─'.repeat(50)}`)
      console.log(`[${i + 1}/${pages.length}] 测试: ${pageInfo.name}`)
      console.log(`${'─'.repeat(50)}`)

      const result = await testPage(page, pageInfo, runId, mode, (type, data) => {
        // 进度回调 - 实时输出
        if (type === 'page:check') {
          const icon = data.status === 'pass' ? '✅' : data.status === 'warning' ? '⚠️' : data.status === 'running' ? '🔄' : '❌'
          console.log(`  ${icon} ${data.name}: ${data.detail || data.status}`)
        }
      })

      results.push(result)

      // 基线对比
      if (config.defaults.compareBaseline) {
        const diff = compareBaseline(pageInfo.id, result)
        if (diff.hasBaseline && diff.changes.length > 0) {
          console.log(`  📝 基线变化: ${diff.changes.join('; ')}`)
          result.baselineDiff = diff
        }
      }

      // 保存基线
      if (config.defaults.saveBaseline && result.overallStatus !== 'error') {
        saveBaseline(pageInfo.id, result)
      }

      console.log(`  📊 评分: ${result.score}/100 | 状态: ${result.overallStatus} | 耗时: ${(result.duration / 1000).toFixed(1)}s`)
    }

    // Step 3: 生成 HTML 报告
    console.log(`\n${'═'.repeat(50)}`)
    console.log('生成测试报告...')
    console.log(`${'═'.repeat(50)}`)

    const reportPath = generateReport(
      { runId, mode, scope: `${pages.length}个页面` },
      results
    )

    // 保存运行信息
    const runInfo = {
      id: runId,
      mode,
      scope,
      startedAt: results[0]?.startedAt,
      finishedAt: results[results.length - 1]?.finishedAt,
      totalPages: results.length,
      passed: results.filter(r => r.overallStatus === 'pass').length,
      warning: results.filter(r => r.overallStatus === 'warning').length,
      failed: results.filter(r => ['fail', 'error'].includes(r.overallStatus)).length,
      avgScore: Math.round(results.reduce((s, r) => s + r.score, 0) / results.length),
      totalIssues: results.reduce((s, r) => s + r.issues.length, 0),
      reportPath
    }
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(runInfo, null, 2), 'utf-8')

    // 输出汇总
    console.log('\n╔══════════════════════════════════════════════╗')
    console.log('║              测试完成 - 汇总                 ║')
    console.log('╠══════════════════════════════════════════════╣')
    console.log(`║  总页面 : ${String(runInfo.totalPages).padEnd(34)}║`)
    console.log(`║  通过   : ${String(runInfo.passed).padEnd(34)}║`)
    console.log(`║  警告   : ${String(runInfo.warning).padEnd(34)}║`)
    console.log(`║  失败   : ${String(runInfo.failed).padEnd(34)}║`)
    console.log(`║  平均分 : ${String(runInfo.avgScore).padEnd(34)}║`)
    console.log(`║  问题数 : ${String(runInfo.totalIssues).padEnd(34)}║`)
    console.log('╠══════════════════════════════════════════════╣')
    console.log(`║  报告   : `)
    console.log(`║  ${reportPath}`)
    console.log('╚══════════════════════════════════════════════╝')

  } catch (error) {
    console.error('\n[错误] 测试执行失败:', error.message)
    console.error(error.stack)
  } finally {
    await closeBrowser()
  }
}

function getArgValue(args, key, defaultValue) {
  const idx = args.indexOf(key)
  if (idx >= 0 && args[idx + 1]) return args[idx + 1]
  return defaultValue
}

main().catch(console.error)
