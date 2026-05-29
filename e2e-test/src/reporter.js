import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { storagePath } from './config.js'

/**
 * 生成 HTML 测试报告
 * @param {object} runInfo - 运行信息
 * @param {Array} pageResults - 各页面测试结果
 */
export function generateReport(runInfo, pageResults) {
  const total = pageResults.length
  const passed = pageResults.filter(r => r.overallStatus === 'pass').length
  const warning = pageResults.filter(r => r.overallStatus === 'warning').length
  const failed = pageResults.filter(r => ['fail', 'error'].includes(r.overallStatus)).length
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0
  const avgScore = total > 0 ? Math.round(pageResults.reduce((s, r) => s + r.score, 0) / total) : 0
  const allIssues = pageResults.flatMap(r => r.issues.map(i => ({ ...i, pageName: r.pageName })))
  const totalDuration = pageResults.reduce((s, r) => s + r.duration, 0)
  const totalAgentRounds = pageResults.reduce((s, r) => s + (r.agentTimeline?.length || 0), 0)
  const avgLoadTime = Math.round(pageResults.filter(r => r.performance).reduce((s, r) => s + r.performance.totalLoadTime, 0) / Math.max(1, pageResults.filter(r => r.performance).length))
  const slowPages = pageResults.filter(r => r.performance && r.performance.totalLoadTime > 3000).map(r => ({ name: r.pageName, time: r.performance.totalLoadTime }))

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>E2E 页面测试报告 - ${runInfo.runId}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; color: #333; }
  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 24px 32px; }
  .header h1 { font-size: 24px; margin-bottom: 4px; }
  .header .meta { font-size: 14px; opacity: 0.8; }
  .summary { display: grid; grid-template-columns: repeat(6, 1fr); gap: 16px; padding: 24px 32px; background: white; border-bottom: 1px solid #e8e8e8; }
  .summary-card { text-align: center; padding: 16px; border-radius: 8px; background: #f9fafb; }
  .summary-card .value { font-size: 32px; font-weight: 700; }
  .summary-card .label { font-size: 13px; color: #666; margin-top: 4px; }
  .pass { color: #52c41a; } .warn { color: #faad14; } .fail { color: #ff4d4f; } .error { color: #cf1322; }
  .container { display: flex; min-height: calc(100vh - 200px); }
  .sidebar { width: 280px; background: white; border-right: 1px solid #e8e8e8; overflow-y: auto; }
  .sidebar-item { padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px; }
  .sidebar-item:hover { background: #f5f5f5; }
  .sidebar-item.active { background: #e6f7ff; border-left: 3px solid #1890ff; }
  .sidebar-item .score { font-size: 12px; color: #999; margin-left: auto; }
  .content { flex: 1; padding: 24px 32px; overflow-y: auto; }
  .issue-section { margin-bottom: 24px; }
  .issue-section h3 { font-size: 16px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e8e8e8; }
  .issue-card { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 4px solid #ff4d4f; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .issue-card.severity-critical { border-left-color: #cf1322; }
  .issue-card.severity-high { border-left-color: #ff4d4f; }
  .issue-card.severity-medium { border-left-color: #faad14; }
  .issue-card.severity-low { border-left-color: #52c41a; }
  .issue-card .title { font-weight: 600; font-size: 15px; margin-bottom: 8px; }
  .issue-card .desc { font-size: 13px; color: #666; margin-bottom: 8px; line-height: 1.6; }
  .issue-card .page-tag { font-size: 12px; background: #f0f0f0; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-bottom: 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
  .badge-pass { background: #f6ffed; color: #52c41a; }
  .badge-warning { background: #fffbe6; color: #faad14; }
  .badge-fail { background: #fff2f0; color: #ff4d4f; }
  .badge-error { background: #fff1f0; color: #cf1322; }
  .check-list { list-style: none; }
  .check-item { padding: 8px 0; border-bottom: 1px solid #f5f5f5; font-size: 13px; display: flex; align-items: flex-start; gap: 8px; }
  .check-icon { font-size: 16px; flex-shrink: 0; }
  .screenshot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin-top: 12px; }
  .screenshot-thumb { border: 1px solid #e8e8e8; border-radius: 8px; overflow: hidden; cursor: pointer; }
  .screenshot-thumb img { width: 100%; display: block; }
  .screenshot-thumb .name { padding: 6px 10px; font-size: 12px; background: #fafafa; }
  .page-detail { background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .page-detail h2 { font-size: 18px; margin-bottom: 4px; }
  .page-detail .url { font-size: 12px; color: #999; margin-bottom: 16px; word-break: break-all; }
  .dom-toggle { cursor: pointer; color: #1890ff; font-size: 13px; margin-top: 8px; }
  .dom-content { display: none; max-height: 400px; overflow: auto; background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 8px; font-size: 12px; font-family: monospace; white-space: pre-wrap; margin-top: 8px; }
  .dom-content.show { display: block; }
  .filter-bar { padding: 12px 16px; background: white; border-bottom: 1px solid #e8e8e8; display: flex; gap: 8px; }
  .filter-btn { padding: 4px 12px; border: 1px solid #d9d9d9; border-radius: 4px; background: white; cursor: pointer; font-size: 13px; }
  .filter-btn.active { background: #1890ff; color: white; border-color: #1890ff; }
  /* 截图放大弹窗 */
  .lightbox { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; cursor: pointer; }
  .lightbox.show { display: flex; align-items: center; justify-content: center; }
  .lightbox img { max-width: 95%; max-height: 95%; }
</style>
</head>
<body>

<div class="header">
  <h1>E2E 页面测试报告</h1>
  <div class="meta">${runInfo.runId} | 测试模式: ${runInfo.mode} | 测试范围: ${runInfo.scope || '自定义'}</div>
</div>

<div class="summary">
  <div class="summary-card">
    <div class="value ${passRate >= 80 ? 'pass' : passRate >= 60 ? 'warn' : 'fail'}">${passRate}%</div>
    <div class="label">通过率 (${passed}/${total}页)</div>
  </div>
  <div class="summary-card">
    <div class="value">${avgScore}</div>
    <div class="label">平均评分 (满分100)</div>
  </div>
  <div class="summary-card">
    <div class="value ${allIssues.length > 0 ? 'fail' : 'pass'}">${allIssues.length}</div>
    <div class="label">发现问题</div>
  </div>
  <div class="summary-card">
    <div class="value">${formatDuration(totalDuration)}</div>
    <div class="label">总耗时</div>
  </div>
  <div class="summary-card">
    <div class="value ${avgLoadTime > 3000 ? 'warn' : 'pass'}">${avgLoadTime}ms</div>
    <div class="label">平均页面加载时间</div>
  </div>
  <div class="summary-card">
    <div class="value" style="color:#667eea;">${totalAgentRounds}</div>
    <div class="label">AI Agent 交互轮次</div>
  </div>
</div>

${allIssues.length > 0 ? `
<div class="issue-section" style="padding: 16px 32px; background: white; border-bottom: 1px solid #e8e8e8;">
  <h3>问题总览 (${allIssues.length}个)</h3>
  ${allIssues.map(issue => `
    <div class="issue-card severity-${issue.severity}">
      <span class="page-tag">${issue.pageName}</span>
      <span class="badge badge-${issue.severity === 'critical' ? 'error' : issue.severity === 'high' ? 'fail' : 'warning'}">${severityLabel(issue.severity)}</span>
      <div class="title">${issue.title}</div>
      <div class="desc">${issue.description || ''}</div>
      ${issue.suggestion ? `<div class="desc" style="color:#1890ff">💡 建议: ${issue.suggestion}</div>` : ''}
    </div>
  `).join('')}
</div>
` : ''}

${slowPages.length > 0 ? `
<div class="issue-section" style="padding: 16px 32px; background: white; border-bottom: 1px solid #e8e8e8;">
  <h3>加载慢页面 (>3秒, ${slowPages.length}个)</h3>
  ${slowPages.sort((a,b) => b.time - a.time).map(p => `
    <div class="issue-card severity-medium">
      <div class="title">${p.name}</div>
      <div class="desc">加载耗时: ${p.time}ms</div>
    </div>
  `).join('')}
</div>
` : ''}

<div class="filter-bar">
  <button class="filter-btn active" onclick="filterPages('all')">全部 (${total})</button>
  <button class="filter-btn" onclick="filterPages('pass')">✅ 通过 (${passed})</button>
  <button class="filter-btn" onclick="filterPages('warning')">⚠️ 警告 (${warning})</button>
  <button class="filter-btn" onclick="filterPages('fail')">❌ 失败 (${failed})</button>
</div>

<div class="container">
  <div class="sidebar">
    ${pageResults.map((r, i) => `
      <div class="sidebar-item ${i === 0 ? 'active' : ''}" data-status="${r.overallStatus}" onclick="showPage(${i})">
        <span>${statusIcon(r.overallStatus)}</span>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.pageName}</span>
        <span class="score">${r.score}分</span>
      </div>
    `).join('')}
  </div>
  <div class="content">
    ${pageResults.map((r, i) => `
      <div class="page-detail" id="page-${i}" style="display: ${i === 0 ? 'block' : 'none'};" data-status="${r.overallStatus}">
        <h2>${statusIcon(r.overallStatus)} ${r.pageName} <span class="badge badge-${r.overallStatus === 'pass' ? 'pass' : r.overallStatus === 'warning' ? 'warning' : 'fail'}">${r.score}分</span></h2>
        <div class="url">${r.url}</div>
        <div style="font-size:13px; color:#999; margin-bottom:12px;">耗时: ${(r.duration / 1000).toFixed(1)}秒 | 测试时间: ${r.startedAt}${r.performance ? ` | 页面加载: ${r.performance.totalLoadTime}ms` : ''}</div>

        <h4 style="margin-bottom:8px;">检查项 (${r.checks.length}项)</h4>
        <ul class="check-list">
          ${r.checks.map(c => `
            <li class="check-item">
              <span class="check-icon">${c.status === 'pass' ? '✅' : c.status === 'warning' ? '⚠️' : '❌'}</span>
              <span><strong>${c.name}</strong> <span class="badge badge-${c.status === 'pass' ? 'pass' : c.status === 'warning' ? 'warning' : 'fail'}">${c.status}</span><br><span style="color:#666">${c.detail || ''}</span></span>
            </li>
          `).join('')}
        </ul>

        ${r.issues.length > 0 ? `
          <h4 style="margin-top:16px; margin-bottom:8px; color:#ff4d4f;">发现问题 (${r.issues.length}个)</h4>
          ${r.issues.map(issue => `
            <div class="issue-card severity-${issue.severity}" style="margin-bottom:8px;">
              <span class="badge badge-${issue.severity === 'critical' ? 'error' : issue.severity === 'high' ? 'fail' : 'warning'}">${severityLabel(issue.severity)}</span>
              <div class="title">${issue.title}</div>
              <div class="desc">${issue.description || ''}</div>
              ${issue.suggestion ? `<div class="desc" style="color:#1890ff">💡 ${issue.suggestion}</div>` : ''}
            </div>
          `).join('')}
        ` : ''}

        ${r.agentTimeline?.length > 0 ? `
          <h4 style="margin-top:16px; margin-bottom:8px; color:#667eea;">AI Agent 测试时间线 (${r.agentTimeline.length}轮)</h4>
          <div style="background:#f9f9fb; border-radius:8px; padding:12px 16px; font-size:13px; margin-bottom:12px;">
            ${r.agentTimeline.map((t, ti) => `
              <div style="padding:6px 0; ${ti < r.agentTimeline.length - 1 ? 'border-bottom:1px solid #eee;' : ''}">
                <strong style="color:#667eea;">第${t.round}轮</strong>
                <span class="badge badge-${t.status === 'pass' ? 'pass' : t.status === 'error' ? 'fail' : 'warning'}" style="margin-left:4px;">${t.status}</span>
                ${t.action ? `<span style="color:#666; margin-left:8px;">→ ${t.action.type}: ${t.action.target || ''} <span style="color:#999;">(${t.action.reason || ''})</span></span>` : '<span style="color:#999; margin-left:8px;">（观察结束）</span>'}
                ${t.issues?.length > 0 ? `<div style="color:#ff4d4f; margin-top:4px; padding-left:24px;">${t.issues.map(i => `⚠️ ${i.title}`).join(' | ')}</div>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${r.screenshots.length > 0 ? `
          <h4 style="margin-top:16px; margin-bottom:8px;">截图证据 (${r.screenshots.length}张)</h4>
          <div class="screenshot-grid">
            ${r.screenshots.map(ss => {
              try {
                const imgData = readFileSync(ss.file, 'base64')
                return `
                  <div class="screenshot-thumb" onclick="showLightbox(this)">
                    <img src="data:image/png;base64,${imgData}" alt="${ss.name}" loading="lazy">
                    <div class="name">${ss.name}</div>
                  </div>
                `
              } catch (e) {
                return `<div class="screenshot-thumb"><div class="name">截图加载失败: ${ss.name}</div></div>`
              }
            }).join('')}
          </div>
        ` : ''}
      </div>
    `).join('')}
  </div>
</div>

<div class="lightbox" id="lightbox" onclick="this.classList.remove('show')">
  <img id="lightbox-img" src="">
</div>

<script>
function showPage(idx) {
  document.querySelectorAll('.page-detail').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + idx).style.display = 'block';
  document.querySelectorAll('.sidebar-item')[idx].classList.add('active');
}

function filterPages(status) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.style.display = (status === 'all' || el.dataset.status === status) ? '' : 'none';
  });
  document.querySelectorAll('.page-detail').forEach(el => {
    el.style.display = (status === 'all' || el.dataset.status === status || el.style.display === 'block') ? '' : 'none';
  });
}

function showLightbox(thumb) {
  const img = thumb.querySelector('img');
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = img.src;
  lb.classList.add('show');
}
</script>

</body>
</html>`

  // 保存报告
  const reportPath = join(storagePath, 'reports', `${runInfo.runId}.html`)
  writeFileSync(reportPath, html, 'utf-8')
  console.log(`\n[报告] HTML报告已生成: ${reportPath}`)

  return reportPath
}

function statusIcon(status) {
  const icons = { pass: '✅', warning: '⚠️', fail: '❌', error: '💥' }
  return icons[status] || '⏳'
}

function severityLabel(severity) {
  const labels = { critical: '🔴 严重', high: '🟠 高', medium: '🟡 中', low: '🟢 低' }
  return labels[severity] || severity
}

function formatDuration(ms) {
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}秒`
  return `${(ms / 60000).toFixed(1)}分钟`
}
