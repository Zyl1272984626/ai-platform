<template>
  <BaseModal
    :show="true"
    :title="mode === 'add' ? '添加学校' : '编辑学校'"
    :width="440"
    @cancel="$emit('cancel')"
    @update:show="(v) => { if (!v) $emit('cancel') }"
  >
    <form @submit.prevent="handleSubmit">
      <div class="form-row">
        <label>学校名称 <span class="req">*</span></label>
        <input v-model="form.name" placeholder="例：贵州水利" required />
      </div>
      <div class="form-row">
        <label>编码 <span class="req">*</span></label>
        <input v-model="form.code" placeholder="例：guizhou_shuili" :disabled="mode === 'edit'" required />
      </div>
    </form>

    <template #footer>
      <div class="form-actions">
        <BaseButton variant="ghost" @click="$emit('cancel')">取消</BaseButton>
        <BaseButton variant="primary" @click="handleSubmit">{{ mode === 'add' ? '添加' : '保存' }}</BaseButton>
      </div>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import BaseModal from '../ui/BaseModal.vue'
import BaseButton from '../ui/BaseButton.vue'
import type { School } from '../../api/types'

const props = defineProps<{
  mode: 'add' | 'edit'
  school?: School
}>()

const emit = defineEmits<{
  save: [data: any]
  cancel: []
}>()

const form = reactive({
  name: props.school?.name || '',
  code: props.school?.code || '',
})

function handleSubmit() {
  const data: any = {
    name: form.name,
    code: form.code,
  }
  if (props.mode === 'add') {
    // 新学校先建空壳，项目通过"添加项目"流程单独创建（支持 agent / knowledge-center 等多类型）
    data.status = 'pending'
    data.lastDeploy = null
    data.projects = []
  }
  emit('save', data)
}
</script>

<style scoped>
.form-row {
  margin-bottom: var(--space-4);
}
.form-row label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: var(--space-1);
}
.req { color: var(--error); }
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
.form-row input:disabled { background: var(--bg-surface-2); color: var(--text-3); }
.form-actions {
  display: flex;
  gap: var(--space-3);
  justify-content: flex-end;
}
</style>
