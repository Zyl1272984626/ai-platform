<template>
  <div class="step-pipeline">
    <div v-for="(step, i) in steps" :key="step.stepId" class="step-node" :class="stepClass(step)">
      <div class="step-dot">
        <span v-if="step.status === 'running'" class="spinner"></span>
        <span v-else-if="step.status === 'success'">✓</span>
        <span v-else-if="step.status === 'failed'">✕</span>
        <span v-else>{{ i + 1 }}</span>
      </div>
      <div class="step-label">{{ step.stepId }}</div>
      <div v-if="i < steps.length - 1" class="step-line" :class="{ active: step.status === 'success' }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { StepRun } from '../../api/types'

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
  padding: 16px 0;
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
  border: 2px solid #ddd;
  background: #fff;
  color: #999;
  z-index: 1;
}
.step-pending .step-dot { border-color: #ddd; color: #bbb; }
.step-running .step-dot { border-color: #1890ff; color: #1890ff; background: #e6f7ff; }
.step-success .step-dot { border-color: #52c41a; color: #fff; background: #52c41a; }
.step-failed .step-dot { border-color: #ff4d4f; color: #fff; background: #ff4d4f; }
.step-skipped .step-dot { border-color: #d9d9d9; color: #bbb; background: #f5f5f5; }
.step-waiting_confirm .step-dot { border-color: #faad14; color: #faad14; background: #fffbe6; }

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid #1890ff;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.step-label {
  font-size: 11px;
  color: #999;
  margin-top: 6px;
  text-align: center;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step-success .step-label { color: #52c41a; font-weight: 500; }
.step-failed .step-label { color: #ff4d4f; font-weight: 500; }
.step-running .step-label { color: #1890ff; font-weight: 500; }

.step-line {
  position: absolute;
  top: 16px;
  left: calc(50% + 16px);
  width: calc(100% - 32px);
  height: 2px;
  background: #eee;
}
.step-line.active { background: #52c41a; }
</style>
