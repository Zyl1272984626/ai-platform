<template>
  <div class="dashboard page-container">
    <PageHeader title="AI 工程平台" description="基于 Claude Code 的全自动化工程平台" />

    <!-- 统计卡片 -->
    <div class="stat-row grid-auto">
      <div class="stat-card">
        <div class="stat-icon school-icon"><Icon :icon="IconNav.school" :size="24" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.schools }}</div>
          <div class="stat-label">学校</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon session-icon"><Icon :icon="IconNav.chat" :size="24" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.sessions }}</div>
          <div class="stat-label">会话</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon run-icon"><Icon :icon="IconNav.workflow" :size="24" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.runs }}</div>
          <div class="stat-label">工作流执行</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon skill-icon"><Icon :icon="IconNav.skill" :size="24" /></div>
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
          <div class="action-icon brand"><Icon :icon="IconNav.chat" :size="26" /></div>
          <div class="action-name">新建对话</div>
          <div class="action-desc">与 Claude Code 对话，自动执行工程任务</div>
        </div>
        <div class="action-card" @click="$router.push('/schools')">
          <div class="action-icon green"><Icon :icon="IconNav.school" :size="26" /></div>
          <div class="action-name">学校部署</div>
          <div class="action-desc">一键部署新学校，自动生成配置并推送</div>
        </div>
        <div class="action-card" @click="$router.push('/workflows')">
          <div class="action-icon orange"><Icon :icon="IconNav.workflow" :size="26" /></div>
          <div class="action-name">执行工作流</div>
          <div class="action-desc">触发自动化工作流：Bug修复、迁移、巡检等</div>
        </div>
        <div class="action-card" @click="$router.push('/skills')">
          <div class="action-icon purple"><Icon :icon="IconNav.skill" :size="26" /></div>
          <div class="action-name">浏览 Skills</div>
          <div class="action-desc">查看所有可用能力和场景 Skills</div>
        </div>
        <div class="action-card" @click="$router.push('/tests')">
          <div class="action-icon cyan"><Icon :icon="IconNav.test" :size="26" /></div>
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
import PageHeader from '../components/layout/PageHeader.vue'
import Icon from '../components/ui/Icon.vue'
import { IconNav } from '../composables/icons'
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
/* 统计卡片 */
.stat-row {
  margin-bottom: var(--space-7);
}
.stat-card {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--duration) var(--ease);
}
.stat-card:hover {
  box-shadow: var(--shadow-md);
}
.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.school-icon  { background: var(--info-bg); color: var(--info); }
.session-icon { background: var(--success-bg); color: var(--success); }
.run-icon     { background: var(--warning-bg); color: var(--warning); }
.skill-icon   { background: var(--brand-soft); color: var(--brand); }
.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-1);
}
.stat-label {
  font-size: 13px;
  color: var(--text-3);
}

/* 快捷操作 */
.section {
  margin-bottom: var(--space-6);
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: var(--space-4);
}
.action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-4);
}
.action-card {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration) var(--ease), box-shadow var(--duration) var(--ease), border-color var(--duration) var(--ease);
  border: 2px solid transparent;
}
.action-card:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow-brand);
  transform: translateY(-2px);
}
.action-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  margin-bottom: var(--space-3);
}
.action-icon.brand  { background: var(--brand); }
.action-icon.green  { background: var(--success); }
.action-icon.orange { background: var(--warning); }
.action-icon.purple { background: #9254de; }.action-icon.cyan   { background: var(--info); }
.action-name { font-size: 15px; font-weight: 600; color: var(--text-1); margin-bottom: var(--space-1); }
.action-desc { font-size: 12px; color: var(--text-3); line-height: 1.5; }

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
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: background var(--duration-fast) var(--ease);
}
.run-item:hover { background: var(--bg-surface-2); }
.run-name { flex: 1; font-size: 13px; font-weight: 500; color: var(--text-1); }
.run-time { font-size: 11px; color: var(--text-4); white-space: nowrap; }

/* 系统信息 */
.sys-info {
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  box-shadow: var(--shadow-sm);
}
.sys-row {
  display: flex;
  justify-content: space-between;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-light);
  font-size: 13px;
}
.sys-row:last-child { border-bottom: none; }
.sys-label { color: var(--text-3); }
.sys-value { color: var(--text-1); font-family: var(--font-mono); font-size: 12px; }
.sys-value.ok { color: var(--success); font-weight: 500; font-family: inherit; }
</style>
