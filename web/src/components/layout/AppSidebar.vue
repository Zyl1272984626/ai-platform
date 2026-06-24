<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="sidebar-brand" @click="$router.push('/')">
      <span class="brand-icon">AI</span>
      <span v-if="!collapsed" class="brand-text">工程平台</span>
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
      <router-link to="/" class="nav-item" exact-active-class="active" title="总览">
        <Icon :icon="IconNav.dashboard" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">总览</span>
      </router-link>
      <router-link to="/chat" class="nav-item" active-class="active" title="对话">
        <Icon :icon="IconNav.chat" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">对话</span>
      </router-link>
      <router-link to="/schools" class="nav-item" active-class="active" title="学校">
        <Icon :icon="IconNav.school" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">学校</span>
      </router-link>
      <router-link to="/workflows" class="nav-item" active-class="active" title="工作流">
        <Icon :icon="IconNav.workflow" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">工作流</span>
      </router-link>
      <router-link to="/skills" class="nav-item" active-class="active" title="Skills">
        <Icon :icon="IconNav.skill" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">Skills</span>
      </router-link>
      <router-link to="/tests" class="nav-item" active-class="active" title="测试">
        <Icon :icon="IconNav.test" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">测试</span>
      </router-link>
      <router-link to="/pipelines" class="nav-item" active-class="active" title="流水线">
        <Icon :icon="IconNav.pipeline" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">流水线</span>
      </router-link>
      <router-link to="/memory" class="nav-item" active-class="active" title="记忆">
        <Icon :icon="IconNav.memory" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">记忆</span>
      </router-link>
      <router-link to="/settings" class="nav-item" active-class="active" title="设置">
        <Icon :icon="IconNav.settings" class="nav-icon" />
        <span v-if="!collapsed" class="nav-label">设置</span>
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
}
.sidebar.collapsed {
  width: var(--sidebar-w-collapsed);
  min-width: var(--sidebar-w-collapsed);
}
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.brand-icon {
  width: 32px;
  height: 32px;
  background: var(--brand-grad);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
}
.brand-text {
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
}
.collapse-btn {
  position: absolute;
  top: 24px;
  right: -12px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
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
}
.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  color: rgba(255, 255, 255, 0.6);
  text-decoration: none;
  font-size: 14px;
  transition: all var(--duration-fast) var(--ease);
  white-space: nowrap;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
}
.nav-item.active {
  background: rgba(102, 126, 234, 0.2);
  color: #fff;
}
.nav-icon {
  font-size: 18px;
  flex-shrink: 0;
  width: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.6);
  transition: color var(--duration) var(--ease);
}
.nav-item:hover .nav-icon,
.nav-item.active .nav-icon {
  color: #fff;
}
.nav-label {
  white-space: nowrap;
}
.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  gap: 8px;
}
.health-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}
.health-dot.ok {
  background: var(--success);
  box-shadow: 0 0 6px rgba(82, 196, 26, 0.5);
}
.health-dot.err {
  background: var(--error);
  box-shadow: 0 0 6px rgba(255, 77, 79, 0.5);
}
.health-text {
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  white-space: nowrap;
}
</style>
