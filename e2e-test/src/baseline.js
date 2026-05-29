/**
 * 基线快照管理
 *
 * 功能：
 * - 保存基线：首次测试的截图+AI状态描述+无障碍树
 * - 加载基线：读取之前的基线数据
 * - 对比基线：检测页面变化
 */

import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { storagePath } from './config.js'

const baselinesDir = join(storagePath, 'baselines')

/**
 * 保存基线快照
 */
export function saveBaseline(pageId, data) {
  const pageDir = join(baselinesDir, pageId)
  if (!existsSync(pageDir)) mkdirSync(pageDir, { recursive: true })

  const meta = {
    pageId,
    pageName: data.pageName,
    url: data.url,
    createdAt: new Date().toISOString(),
    score: data.score,
    screenshotCount: data.screenshots?.length || 0,
    checkCount: data.checks?.length || 0,
    issueCount: data.issues?.length || 0,
    // AI 生成的正常状态描述
    normalState: data.agentTimeline?.length > 0
      ? `AI Agent ${data.agentTimeline.length} 轮测试，评分 ${data.score}`
      : `规则检测，评分 ${data.score}`,
    checks: data.checks?.map(c => ({ name: c.name, status: c.status })) || []
  }

  writeFileSync(join(pageDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
  console.log(`[基线] 已保存基线: ${pageId} (评分 ${data.score})`)
}

/**
 * 加载基线快照
 */
export function loadBaseline(pageId) {
  const metaPath = join(baselinesDir, pageId, 'meta.json')
  if (!existsSync(metaPath)) return null

  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * 对比当前测试结果与基线
 * 返回变化列表
 */
export function compareBaseline(pageId, currentResult) {
  const baseline = loadBaseline(pageId)
  if (!baseline) return { hasBaseline: false, changes: [] }

  const changes = []

  // 评分变化
  if (currentResult.score !== baseline.score) {
    const diff = currentResult.score - baseline.score
    changes.push(`评分变化: ${baseline.score} → ${currentResult.score} (${diff > 0 ? '+' : ''}${diff})`)
  }

  // 检查项变化
  const baselineChecks = new Map(baseline.checks?.map(c => [c.name, c.status]) || [])
  for (const check of (currentResult.checks || [])) {
    const baselineStatus = baselineChecks.get(check.name)
    if (baselineStatus && baselineStatus !== check.status) {
      changes.push(`检查项变化: "${check.name}" ${baselineStatus} → ${check.status}`)
    }
  }

  // 新增问题
  if (currentResult.issues?.length > (baseline.issueCount || 0)) {
    changes.push(`问题数变化: ${baseline.issueCount} → ${currentResult.issues.length}`)
  }

  return { hasBaseline: true, baseline, changes }
}
