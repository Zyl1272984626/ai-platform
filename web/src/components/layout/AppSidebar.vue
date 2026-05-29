<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="sidebar-brand" @click="$router.push('/')">
      <span class="brand-icon">AI</span>
      <span v-if="!collapsed" class="brand-text">工程平台</span>
    </div>

    <nav class="sidebar-nav">
      <router-link to="/" class="nav-item" exact-active-class="active">
        <span class="nav-icon">📊</span>
        <span v-if="!collapsed" class="nav-label">总览</span>
      </router-link>
      <router-link to="/chat" class="nav-item" active-class="active">
        <span class="nav-icon">💬</span>
        <span v-if="!collapsed" class="nav-label">对话</span>
      </router-link>
      <router-link to="/schools" class="nav-item" active-class="active">
        <span class="nav-icon">🏫</span>
        <span v-if="!collapsed" class="nav-label">学校</span>
      </router-link>
      <router-link to="/workflows" class="nav-item" active-class="active">
        <span class="nav-icon">⚙️</span>
        <span v-if="!collapsed" class="nav-label">工作流</span>
      </router-link>
      <router-link to="/skills" class="nav-item" active-class="active">
        <span class="nav-icon">🧩</span>
        <span v-if="!collapsed" class="nav-label">Skills</span>
      </router-link>
      <router-link to="/tests" class="nav-item" active-class="active">
        <span class="nav-icon">🧪</span>
        <span v-if="!collapsed" class="nav-label">测试</span>
      </router-link>
    </nav>

    <div class="sidebar-footer">
      <div class="health-dot" :class="healthy ? 'ok' : 'err'" :title="healthy ? '服务正常' : '服务异常'"></div>
      <span v-if="!collapsed" class="health-text">{{ healthy ? '服务正常' : '连接异常' }}</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const collapsed = ref(false)
const healthy = ref(true)
let timer: ReturnType<typeof setInterval> | null = null

async function checkHealth() {
  try {
    const res = await fetch('/api/health')
    healthy.value = res.ok
  } catch {
    healthy.value = false
  }
}

onMounted(() => {
  checkHealth()
  timer = setInterval(checkHealth, 30000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.sidebar {
  width: 200px;
  min-width: 200px;
  height: 100vh;
  background: #1a1a2e;
  display: flex;
  flex-direction: column;
  transition: width 0.2s;
  overflow: hidden;
}
.sidebar.collapsed {
  width: 56px;
  min-width: 56px;
}
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.brand-icon {
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 800;
  color: white;
  flex-shrink: 0;
}
.brand-text {
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
}
.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  color: rgba(255,255,255,0.6);
  text-decoration: none;
  font-size: 14px;
  transition: all 0.15s;
  white-space: nowrap;
}
.nav-item:hover {
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.9);
}
.nav-item.active {
  background: rgba(102, 126, 234, 0.2);
  color: #fff;
}
.nav-icon {
  font-size: 18px;
  flex-shrink: 0;
  width: 24px;
  text-align: center;
}
.nav-label {
  white-space: nowrap;
}
.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.08);
  display: flex;
  align-items: center;
  gap: 8px;
}
.health-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.health-dot.ok {
  background: #52c41a;
  box-shadow: 0 0 6px rgba(82, 196, 26, 0.5);
}
.health-dot.err {
  background: #ff4d4f;
  box-shadow: 0 0 6px rgba(255, 77, 79, 0.5);
}
.health-text {
  color: rgba(255,255,255,0.5);
  font-size: 12px;
  white-space: nowrap;
}
</style>
