<template>
  <div class="dashboard">
    <header class="dash-header">
      <div>
        <h1>AI 工程平台</h1>
        <p class="subtitle">基于 Claude Code 的全自动化工程平台</p>
      </div>
    </header>

    <!-- 统计卡片 -->
    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-icon school-icon">🏫</div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.schools }}</div>
          <div class="stat-label">学校</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon session-icon">💬</div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.sessions }}</div>
          <div class="stat-label">会话</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon run-icon">⚙️</div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.runs }}</div>
          <div class="stat-label">工作流执行</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon skill-icon">🧩</div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.skills }}</div>
          <div class="stat-label">Skills</div>
        </div>
      </div>
    </div>

    <!-- 快捷操作 -->
    <section class="section">
      <h2 class="section-title">快捷操作</h2>
      <div class="action-grid">
        <div class="action-card" @click="$router.push('/chat')">
          <div class="action-icon">💬</div>
          <div class="action-name">新建对话</div>
          <div class="action-desc">与 Claude Code 对话，自动执行工程任务</div>
        </div>
        <div class="action-card" @click="$router.push('/schools')">
          <div class="action-icon">🏫</div>
          <div class="action-name">学校部署</div>
          <div class="action-desc">一键部署新学校，自动生成配置并推送</div>
        </div>
        <div class="action-card" @click="$router.push('/workflows')">
          <div class="action-icon">⚙️</div>
          <div class="action-name">执行工作流</div>
          <div class="action-desc">触发自动化工作流：Bug修复、迁移、巡检等</div>
        </div>
        <div class="action-card" @click="$router.push('/skills')">
          <div class="action-icon">🧩</div>
          <div class="action-name">浏览 Skills</div>
          <div class="action-desc">查看所有可用能力和场景 Skills</div>
        </div>
        <div class="action-card" @click="$router.push('/tests')">
          <div class="action-icon">🧪</div>
          <div class="action-name">运行测试</div>
          <div class="action-desc">Agent测试、E2E页面测试、前端测试、API测试</div>
        </div>
      </div>
    </section>

    <!-- 最近活动 -->
    <div class="activity-row">
      <section class="section flex-1">
        <h2 class="section-title">最近工作流</h2>
        <div v-if="recentRuns.length === 0" class="empty-hint">暂无工作流执行记录</div>
        <div v-else class="run-list">
          <div v-for="run in recentRuns" :key="run.id" class="run-item" @click="$router.push('/workflows')">
            <div class="run-name">{{ run.workflowName }}</div>
            <StatusBadge :status="run.status" size="small" />
            <div class="run-time">{{ formatTime(run.startedAt) }}</div>
          </div>
        </div>
      </section>

      <section class="section flex-1">
        <h2 class="section-title">系统状态</h2>
        <div class="sys-info">
          <div class="sys-row">
            <span class="sys-label">项目路径</span>
            <span class="sys-value">{{ health.projectRoot || '-' }}</span>
          </div>
          <div class="sys-row">
            <span class="sys-label">平台版本</span>
            <span class="sys-value">{{ health.version || '-' }}</span>
          </div>
          <div class="sys-row">
            <span class="sys-label">服务状态</span>
            <span class="sys-value ok">正常运行</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import StatusBadge from '../components/common/StatusBadge.vue'
import { listSchools } from '../api/schools'
import { listSessions } from '../api/sessions'
import { listRuns } from '../api/workflows'
import { listSkills } from '../api/skills'

const stats = reactive({ schools: 0, sessions: 0, runs: 0, skills: 0 })
const recentRuns = ref<any[]>([])
const health = reactive({ projectRoot: '', version: '' })

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(async () => {
  try {
    const [schools, sessions, runs, skills, healthRes] = await Promise.allSettled([
      listSchools(),
      listSessions(),
      listRuns(),
      listSkills(),
      fetch('/api/health').then(r => r.json()),
    ])
    if (schools.status === 'fulfilled') stats.schools = schools.value.length
    if (sessions.status === 'fulfilled') stats.sessions = sessions.value.length
    if (runs.status === 'fulfilled') {
      stats.runs = runs.value.length
      recentRuns.value = runs.value.slice(0, 5)
    }
    if (skills.status === 'fulfilled') stats.skills = skills.value.length
    if (healthRes.status === 'fulfilled') Object.assign(health, healthRes.value)
  } catch { /* ignore */ }
})
</script>

<style scoped>
.dashboard {
  padding: 28px 32px;
  max-width: 1200px;
  margin: 0 auto;
}
.dash-header {
  margin-bottom: 28px;
}
.dash-header h1 {
  font-size: 26px;
  font-weight: 700;
  color: #1a1a2e;
}
.subtitle {
  color: #888;
  font-size: 14px;
  margin-top: 4px;
}

/* 统计卡片 */
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 28px;
}
.stat-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}
.school-icon  { background: #f0f7ff; }
.session-icon { background: #f0fff4; }
.run-icon     { background: #fff7e6; }
.skill-icon   { background: #f9f0ff; }
.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: #1a1a2e;
}
.stat-label {
  font-size: 13px;
  color: #999;
}

/* 快捷操作 */
.section {
  margin-bottom: 24px;
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  margin-bottom: 14px;
}
.action-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
}
.action-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: all 0.15s;
  border: 2px solid transparent;
}
.action-card:hover {
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
  transform: translateY(-2px);
}
.action-icon { font-size: 28px; margin-bottom: 10px; }
.action-name { font-size: 15px; font-weight: 600; color: #333; margin-bottom: 4px; }
.action-desc { font-size: 12px; color: #999; line-height: 1.5; }

/* 活动行 */
.activity-row {
  display: flex;
  gap: 20px;
}
.flex-1 { flex: 1; }
.empty-hint {
  color: #bbb;
  font-size: 13px;
  padding: 20px 0;
}
.run-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.run-item {
  background: #fff;
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  transition: background 0.15s;
}
.run-item:hover { background: #fafafa; }
.run-name { flex: 1; font-size: 13px; font-weight: 500; color: #333; }
.run-time { font-size: 11px; color: #bbb; white-space: nowrap; }

/* 系统信息 */
.sys-info {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.sys-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f5f5f5;
  font-size: 13px;
}
.sys-row:last-child { border-bottom: none; }
.sys-label { color: #999; }
.sys-value { color: #333; font-family: monospace; font-size: 12px; }
.sys-value.ok { color: #52c41a; font-weight: 500; font-family: inherit; }
</style>
