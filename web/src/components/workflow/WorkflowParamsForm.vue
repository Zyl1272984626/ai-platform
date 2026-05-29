<template>
  <div class="params-overlay" @click.self="$emit('cancel')">
    <div class="params-card">
      <h3>执行参数</h3>
      <p class="params-desc">{{ description }}</p>
      <form @submit.prevent="handleSubmit">
        <div v-for="p in params" :key="p" class="form-row">
          <label>{{ p }}</label>
          <input v-model="values[p]" :placeholder="p" />
        </div>
        <div class="form-actions">
          <button type="button" class="btn-cancel" @click="$emit('cancel')">取消</button>
          <button type="submit" class="btn-run">执行工作流</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'

const props = defineProps<{
  params: string[]
  description?: string
}>()

const emit = defineEmits<{
  run: [values: Record<string, string>]
  cancel: []
}>()

const values = reactive<Record<string, string>>({})
props.params.forEach(p => { values[p] = '' })

function handleSubmit() {
  emit('run', { ...values })
}
</script>

<style scoped>
.params-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.params-card {
  background: #fff;
  border-radius: 14px;
  padding: 28px;
  width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
.params-card h3 {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 6px;
}
.params-desc {
  font-size: 13px;
  color: #888;
  margin-bottom: 20px;
}
.form-row {
  margin-bottom: 12px;
}
.form-row label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #555;
  margin-bottom: 4px;
}
.form-row input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}
.form-row input:focus { border-color: #667eea; }
.form-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
}
.btn-cancel {
  padding: 8px 20px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #666;
}
.btn-run {
  padding: 8px 24px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}
</style>
