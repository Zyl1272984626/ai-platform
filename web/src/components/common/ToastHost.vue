<template>
  <TransitionGroup name="toast" tag="div" class="toast-host">
    <div v-for="t in items" :key="t.id" class="toast-item" :class="t.type">
      <Icon :icon="iconComp(t.type)" class="toast-icon" :size="16" />
      <span class="toast-msg">{{ t.message }}</span>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { useToast } from '../../composables/useToast'
import Icon from '../ui/Icon.vue'
import { IconStatus } from '../../composables/icons'
const { items } = useToast()
function iconComp(type: string) {
  if (type === 'success') return IconStatus.success
  if (type === 'error') return IconStatus.error
  return IconStatus.info
}
</script>

<style scoped>
.toast-host {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  pointer-events: none;
}
.toast-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 11px 18px;
  border-radius: var(--radius-md);
  font-size: 13px;
  color: #fff;
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
  min-width: 220px;
  backdrop-filter: blur(8px);
}
.toast-item.success { background: rgba(82, 196, 26, 0.95); }
.toast-item.error { background: rgba(255, 77, 79, 0.95); }
.toast-item.info { background: rgba(24, 144, 255, 0.95); }
.toast-icon {
  flex-shrink: 0;
}

.toast-enter-active, .toast-leave-active { transition: all 0.25s var(--ease-out); }
.toast-enter-from { opacity: 0; transform: translateY(-12px); }
.toast-leave-to { opacity: 0; transform: translateY(-12px); }
</style>
