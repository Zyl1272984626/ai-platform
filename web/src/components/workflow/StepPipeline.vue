<template>
  <div class="step-pipeline">
    <div v-for="(step, i) in steps" :key="step.stepId" class="step-node" :class="stepClass(step)">
      <div class="step-dot">
        <span v-if="step.status === 'running'" class="spinner"></span>
        <Icon v-else-if="step.status === 'success'" :icon="IconStatus.check" :size="14" />
        <Icon v-else-if="step.status === 'failed'" :icon="IconStatus.x" :size="14" />
        <span v-else>{{ i + 1 }}</span>
      </div>
      <div class="step-label">{{ step.stepId }}</div>
      <div v-if="i < steps.length - 1" class="step-line" :class="{ active: step.status === 'success' }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { StepRun } from '../../api/types'
import Icon from '../ui/Icon.vue'
import { IconStatus } from '../../composables/icons'

defineProps<{
  steps: StepRun[]
}>()

function stepClass(step: StepRun) {
  return `step-${step.status}`
}
</script>

<style scoped>
.step-pipeline {
  display: flex;
  align-items: flex-start;
  gap: 0;
  padding: var(--space-4) 0;
  overflow-x: auto;
}
.step-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
  position: relative;
}
.step-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  border: 2px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-3);
  z-index: 1;
}
.step-pending .step-dot { border-color: var(--border); color: var(--text-4); }
.step-running .step-dot { border-color: var(--info); color: var(--info); background: var(--info-bg); }
.step-success .step-dot { border-color: var(--success); color: #fff; background: var(--success); }
.step-failed .step-dot { border-color: var(--error); color: #fff; background: var(--error); }
.step-skipped .step-dot { border-color: var(--border-strong); color: var(--text-4); background: var(--bg-surface-2); }
.step-waiting_confirm .step-dot { border-color: var(--warning); color: var(--warning); background: var(--warning-bg); }

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--info);
  border-top-color: transparent;
  border-radius: 50%;
  animation: aui-spin 0.8s linear infinite;
}

.step-label {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 6px;
  text-align: center;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step-success .step-label { color: var(--success); font-weight: 500; }
.step-failed .step-label { color: var(--error); font-weight: 500; }
.step-running .step-label { color: var(--info); font-weight: 500; }

.step-line {
  position: absolute;
  top: 16px;
  left: calc(50% + 16px);
  width: calc(100% - 32px);
  height: 2px;
  background: var(--border-light);
}
.step-line.active { background: var(--success); }
</style>
