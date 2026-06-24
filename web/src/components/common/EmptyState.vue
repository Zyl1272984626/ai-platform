<template>
  <div class="empty-state">
    <div v-if="$slots.icon" class="empty-icon"><slot name="icon" /></div>
    <div v-else-if="icon" class="empty-icon">{{ icon }}</div>
    <div class="empty-title">{{ title }}</div>
    <div v-if="description" class="empty-desc">{{ description }}</div>
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * 空状态组件
 * ----------------------------------------------------------------
 * 支持两种图标方式:
 *   1. <template #icon><Icon :icon="X" /></template>  (推荐,矢量图标)
 *   2. icon="学校"  (兼容旧用法,emoji/文字字符)
 * 若都不传则不显示图标区。
 */
defineProps<{
  icon?: string
  title: string
  description?: string
}>()
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-3);
}
.empty-icon {
  margin-bottom: var(--space-4);
  color: var(--text-4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.empty-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: var(--space-2);
}
.empty-desc {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: var(--space-4);
  text-align: center;
  max-width: 320px;
}
</style>
