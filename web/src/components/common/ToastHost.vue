<template>
  <TransitionGroup name="toast" tag="div" class="toast-host">
    <div v-for="t in items" :key="t.id" class="toast-item" :class="t.type">
      <span class="toast-icon">{{ icon(t.type) }}</span>
      <span class="toast-msg">{{ t.message }}</span>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { useToast } from '../../composables/useToast'
const { items } = useToast()
function icon(type: string) {
  return type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'
}
</script>

<style scoped>
.toast-host {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 13px;
  color: #fff;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  pointer-events: auto;
  min-width: 200px;
}
.toast-item.success { background: #52c41a; }
.toast-item.error { background: #ff4d4f; }
.toast-item.info { background: #1890ff; }
.toast-icon { font-weight: 700; }

.toast-enter-active, .toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from { opacity: 0; transform: translateY(-12px); }
.toast-leave-to { opacity: 0; transform: translateY(-12px); }
</style>
