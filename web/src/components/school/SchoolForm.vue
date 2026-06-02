<template>
  <div class="school-form" @click.self="$emit('cancel')">
    <div class="form-card">
      <h3>{{ mode === 'add' ? '添加学校' : '编辑学校' }}</h3>
      <form @submit.prevent="handleSubmit">
        <div class="form-row">
          <label>学校名称 <span class="req">*</span></label>
          <input v-model="form.name" placeholder="例：贵州水利" required />
        </div>
        <div class="form-row">
          <label>编码 <span class="req">*</span></label>
          <input v-model="form.code" placeholder="例：guizhou_shuili" :disabled="mode === 'edit'" required />
        </div>
        <div class="form-actions">
          <button type="button" class="btn-cancel" @click="$emit('cancel')">取消</button>
          <button type="submit" class="btn-save">{{ mode === 'add' ? '添加' : '保存' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
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
    data.type = 'mysql'
    data.port = 9998
    data.database = 'agent_portal'
    data.deploy = { host: '', user: 'root' }
    data.deployConfig = { serverOs: 'linux', windowsDrive: 'D:' }
    data.status = 'pending'
    data.lastDeploy = null
  }
  emit('save', data)
}
</script>

<style scoped>
.school-form {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.form-card {
  background: #fff;
  border-radius: 14px;
  padding: 28px;
  width: 440px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
.form-card h3 {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 20px;
}
.form-row {
  margin-bottom: 14px;
}
.form-row label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #555;
  margin-bottom: 4px;
}
.req { color: #ff4d4f; }
.form-row input, .form-row select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}
.form-row input:focus, .form-row select:focus { border-color: #667eea; }
.form-row input:disabled { background: #f5f5f5; color: #999; }
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
.btn-save {
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
