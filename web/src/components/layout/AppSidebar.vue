<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="sidebar-brand" @click="$router.push('/')">
      <span class="brand-icon">AI</span>
      <span v-if="!collapsed" class="brand-text">闭环研发台</span>
    </div>
    <button
      class="collapse-btn"
      :class="{ collapsed }"
      :title="collapsed ? '展开' : '收起'"
      :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
      @click="toggleCollapse"
    >
      <Icon :icon="collapsed ? IconArrow.right : IconArrow.left" :size="16" />
    </button>

    <nav class="sidebar-nav">
      <div v-if="!collapsed" class="nav-section-label">核心工作</div>
      <router-link to="/tasks" class="nav-item" active-class="active" title="研发任务">
        <Icon :icon="IconNav.task" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">研发任务</span>
      </router-link>
      <router-link to="/projects" class="nav-item" active-class="active" title="项目基线">
        <Icon :icon="IconNav.project" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">项目基线</span>
      </router-link>
      <router-link to="/evidence" class="nav-item" active-class="active" title="证据与验收">
        <Icon :icon="IconNav.evidence" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">证据与验收</span>
      </router-link>
      <router-link to="/settings" class="nav-item" active-class="active" title="设置">
        <Icon :icon="IconNav.settings" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">系统设置</span>
      </router-link>
      <div v-if="!collapsed" class="nav-section-label nav-section-secondary">运营配置</div>
      <router-link to="/schools" class="nav-item" active-class="active" title="校园管理">
        <Icon :icon="IconNav.school" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">校园管理</span>
      </router-link>
      <div v-if="!collapsed" class="nav-section-label nav-section-secondary">底层能力</div>
      <router-link to="/tools" class="nav-item" active-class="active" title="高级工具">
        <Icon :icon="IconNav.tools" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">高级工具</span>
      </router-link>
    </nav>

    <div class="sidebar-footer">
      <span class="health-dot" :class="healthy ? 'ok' : 'err'"></span>
      <span v-if="!collapsed" class="health-text">{{ healthy ? '服务正常' : '连接异常' }}</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Icon from '../ui/Icon.vue'
import { IconNav, IconArrow } from '../../composables/icons'

const STORAGE_KEY = 'sidebar-collapsed'
const collapsed = ref(false)
const healthy = ref(true)
let timer: ReturnType<typeof setInterval> | null = null

function toggleCollapse() {
  collapsed.value = !collapsed.value
  localStorage.setItem(STORAGE_KEY, String(collapsed.value))
}

// 窄屏(<= 1024px)自动折叠
function syncWithViewport() {
  const narrow = window.innerWidth <= 1024
  if (narrow && !collapsed.value) {
    collapsed.value = true
  }
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health')
    healthy.value = res.ok
  } catch {
    healthy.value = false
  }
}

onMounted(() => {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'true') {
    collapsed.value = true
  }
  syncWithViewport()
  checkHealth()
  timer = setInterval(checkHealth, 30000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  min-width: var(--sidebar-w);
  height: 100vh;
  background: var(--bg-dark);
  display: flex;
  flex-direction: column;
  transition: width var(--duration) var(--ease);
  overflow: hidden;
  position: relative;
  /* 右侧细分割线,增强与内容区的分离感 */
  box-shadow: 1px 0 0 0 var(--border);
}
.sidebar.collapsed {
  width: var(--sidebar-w-collapsed);
  min-width: var(--sidebar-w-collapsed);
}

/* 品牌区 */
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 18px 18px;
  cursor: pointer;
}
.brand-icon {
  width: 36px;
  height: 36px;
  background: var(--brand-grad);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
  letter-spacing: 0.02em;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
}
.brand-text {
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: var(--tracking-tight);
}

/* 折叠按钮 */
.collapse-btn {
  position: absolute;
  top: 28px;
  right: -12px;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-pill);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-header);
  box-shadow: var(--shadow-sm);
  transition: all var(--duration-fast) var(--ease);
}
.collapse-btn:hover {
  color: var(--brand);
  border-color: var(--brand);
  transform: scale(1.1);
}

/* 导航区 */
.sidebar-nav {
  flex: 1;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.nav-section-label {
  padding: 12px 12px 6px;
  color: #64748b;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.nav-section-secondary {
  margin-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 18px;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  color: var(--text-4);
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 500;
  transition: all var(--duration-fast) var(--ease);
  white-space: nowrap;
}
.nav-item:hover {
  background: var(--bg-dark-hover);
  color: #e2e8f0;
}
/* 激活态:左侧指示条 + 微妙品牌色背景,而非重色块 */
.nav-item.active {
  background: var(--bg-dark-active);
  color: #fff;
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  background: var(--brand);
  border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
}
.nav-icon {
  font-size: 18px;
  flex-shrink: 0;
  width: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  transition: color var(--duration-fast) var(--ease);
}
.nav-item:hover .nav-icon {
  color: #e2e8f0;
}
.nav-item.active .nav-icon {
  color: var(--brand);
}
.nav-label {
  white-space: nowrap;
}

/* 底部健康状态 */
.sidebar-footer {
  padding: 14px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  gap: 8px;
}
.health-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  position: relative;
}
.health-dot.ok {
  background: var(--success);
}
.health-dot.ok::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: var(--radius-pill);
  background: var(--success);
  opacity: 0.3;
  animation: aui-pulse 2s infinite;
}
.health-dot.err {
  background: var(--error);
}
.health-text {
  color: var(--text-4);
  font-size: 12px;
  white-space: nowrap;
}
</style>
