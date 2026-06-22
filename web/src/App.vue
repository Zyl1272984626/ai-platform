<template>
  <div class="app-shell">
    <AppSidebar />
    <main class="app-main">
      <router-view />
    </main>
    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import AppSidebar from './components/layout/AppSidebar.vue'
import ToastHost from './components/common/ToastHost.vue'
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.app-main {
  flex: 1;
  overflow: auto;
  background: #f0f2f5;
}
</style>
