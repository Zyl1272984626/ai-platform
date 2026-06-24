<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <div class="app-shell">
      <AppSidebar />
      <main class="app-main">
        <router-view />
      </main>
      <ToastHost />
    </div>
  </n-config-provider>
</template>

<script setup lang="ts">
import { NConfigProvider } from 'naive-ui'
import AppSidebar from './components/layout/AppSidebar.vue'
import ToastHost from './components/common/ToastHost.vue'
import { themeOverrides } from './composables/useTheme'
</script>

<style>
/* reset 与全局 token 已迁移到 src/styles/*.css,由 main.ts 统一引入。
   此处仅保留与 .app-shell / .app-main 相关的全局布局。 */
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.app-main {
  flex: 1;
  overflow: auto;
  background: var(--bg-page);
}
</style>
