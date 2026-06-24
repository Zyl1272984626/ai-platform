<template>
  <BaseModal
    :show="true"
    title="执行参数"
    :width="480"
    @cancel="$emit('cancel')"
    @update:show="(v) => { if (!v) $emit('cancel') }"
  >
    <p class="params-desc">{{ description }}</p>
    <form @submit.prevent="handleSubmit">
      <div v-for="p in params" :key="p" class="form-row">
        <label>{{ p }}</label>
        <input v-model="values[p]" :placeholder="p" />
      </div>
    </form>

    <template #footer>
      <div class="form-actions">
        <BaseButton variant="ghost" @click="$emit('cancel')">取消</BaseButton>
        <BaseButton variant="primary" @click="handleSubmit">执行工作流</BaseButton>
      </div>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import BaseModal from '../ui/BaseModal.vue'
import BaseButton from '../ui/BaseButton.vue'

const props = defineProps<{
  params: string[]
  description?: string
}>()

const emit = defineEmits<{
  run: [values: Record<string, string>]
  cancel: []
}>()

const values = reactive<Record<string, string>>({})
props.params.forEach((p) => {
  values[p] = ''
})

function handleSubmit() {
  emit('run', { ...values })
}
</script>

<style scoped>
.params-desc {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: var(--space-5);
}
.form-row {
  margin-bottom: var(--space-3);
}
.form-row label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: var(--space-1);
}
.form-row input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  font-size: 14px;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease);
}
.form-row input:focus { border-color: var(--brand); }
.form-actions {
  display: flex;
  gap: var(--space-3);
  justify-content: flex-end;
}
</style>
