<template>
  <div class="password-input">
    <input
      v-bind="$attrs"
      :type="visible ? 'text' : 'password'"
      :value="modelValue"
      @input="onInput"
    />
    <button
      type="button"
      class="toggle-button"
      :title="visible ? '隐藏' : '显示'"
      :aria-label="visible ? '隐藏' : '显示'"
      @click="visible = !visible"
    >
      <component :is="visible ? EyeOffOutline : EyeOutline" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { EyeOffOutline, EyeOutline } from '@vicons/ionicons5'

defineOptions({ inheritAttrs: false })

defineProps<{
  modelValue?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const visible = ref(false)

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<style scoped>
.password-input {
  position: relative;
}

.password-input input {
  box-sizing: border-box;
  width: 100%;
  padding-right: 40px;
  padding: 8px 40px 8px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.password-input input:focus {
  border-color: #667eea;
  outline: none;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.15);
}

.toggle-button {
  position: absolute;
  top: 50%;
  right: 8px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #8c8c8c;
  cursor: pointer;
  transform: translateY(-50%);
}

.toggle-button:hover {
  background: #f5f5f5;
  color: #667eea;
}

.toggle-button svg {
  width: 18px;
  height: 18px;
  display: block;
}
</style>
