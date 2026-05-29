<template>
  <span class="status-badge" :class="[colorClass, sizeClass]">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  status: string
  size?: 'small' | 'medium'
}>()

const statusMap: Record<string, { label: string; color: string }> = {
  pending:     { label: '待配置', color: 'warning' },
  configured:  { label: '已配置', color: 'info' },
  deployed:    { label: '已部署', color: 'success' },
  error:       { label: '异常', color: 'error' },
  failed:      { label: '失败', color: 'error' },
  running:     { label: '运行中', color: 'running' },
  completed:   { label: '已完成', color: 'success' },
  paused:      { label: '已暂停', color: 'warning' },
  aborted:     { label: '已中止', color: 'default' },
  active:      { label: '活跃', color: 'success' },
  idle:        { label: '空闲', color: 'default' },
  success:     { label: '成功', color: 'success' },
  skipped:     { label: '已跳过', color: 'default' },
  waiting_confirm: { label: '等待确认', color: 'warning' },
}

const label = computed(() => statusMap[props.status]?.label || props.status)
const colorClass = computed(() => `badge-${statusMap[props.status]?.color || 'default'}`)
const sizeClass = computed(() => props.size === 'small' ? 'badge-sm' : 'badge-md')
</script>

<style scoped>
.status-badge {
  display: inline-block;
  border-radius: 10px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.badge-sm { font-size: 11px; padding: 2px 8px; }
.badge-md { font-size: 12px; padding: 3px 10px; }

.badge-success { background: #f6ffed; color: #52c41a; border: 1px solid #b7eb8f; }
.badge-warning { background: #fffbe6; color: #faad14; border: 1px solid #ffe58f; }
.badge-error   { background: #fff2f0; color: #ff4d4f; border: 1px solid #ffccc7; }
.badge-info    { background: #e6f7ff; color: #1890ff; border: 1px solid #91d5ff; }
.badge-default { background: #f5f5f5; color: #999; border: 1px solid #d9d9d9; }
.badge-running { background: #e6f7ff; color: #1890ff; border: 1px solid #91d5ff; animation: pulse 1.5s infinite; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
</style>
