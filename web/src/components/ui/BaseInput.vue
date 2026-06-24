<template>
  <n-input
    v-if="type !== 'textarea' && type !== 'password' && type !== 'number'"
    :value="modelValue"
    :type="type"
    :placeholder="placeholder"
    :size="nSize"
    :disabled="disabled"
    :clearable="clearable"
    :readonly="readonly"
    :style="widthStyle"
    @update:value="(v) => $emit('update:modelValue', v)"
    @keydown.enter="$emit('enter')"
  >
    <template v-if="$slots.prefix" #prefix><slot name="prefix" /></template>
    <template v-if="$slots.suffix" #suffix><slot name="suffix" /></template>
  </n-input>

  <n-input-number
    v-else-if="type === 'number'"
    :value="modelValue === '' ? null : Number(modelValue)"
    :placeholder="placeholder"
    :size="nSize"
    :disabled="disabled"
    :style="widthStyle"
    @update:value="(v) => $emit('update:modelValue', v === null ? '' : String(v))"
  />

  <n-input
    v-else-if="type === 'textarea'"
    type="textarea"
    :value="modelValue"
    :placeholder="placeholder"
    :size="nSize"
    :disabled="disabled"
    :readonly="readonly"
    :rows="rows"
    :autosize="autosize"
    :style="widthStyle"
    @update:value="(v) => $emit('update:modelValue', v)"
  />

  <PasswordInputLegacy
    v-else
    :model-value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :style="widthStyle"
    @update:model-value="(v) => $emit('update:modelValue', v)"
  />
</template>

<script setup lang="ts">
/**
 * 统一输入框 —— 封装 naive-ui 的 NInput
 * ----------------------------------------------------------------
 * 支持 text / textarea / password 三种类型,统一 placeholder、focus 光晕、尺寸。
 * password 类型复用已有的 PasswordInput 组件(带显隐切换)。
 *
 * 用法:<BaseInput v-model="val" placeholder="请输入" />
 */
import { NInput, NInputNumber } from 'naive-ui'
import { computed } from 'vue'
import PasswordInputLegacy from '../common/PasswordInput.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    type?: 'text' | 'textarea' | 'password' | 'number'
    placeholder?: string
    size?: 'small' | 'medium' | 'large'
    disabled?: boolean
    clearable?: boolean
    readonly?: boolean
    rows?: number
    autosize?: boolean | { minRows: number; maxRows: number }
    width?: string
  }>(),
  {
    type: 'text',
    placeholder: '',
    size: 'medium',
    disabled: false,
    clearable: false,
    readonly: false,
    rows: 3,
    autosize: false,
    width: undefined,
  },
)

defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'enter'): void
}>()

const nSize = computed(() =>
  props.size === 'small' ? 'small' : props.size === 'large' ? 'large' : 'medium',
)

const widthStyle = computed(() => (props.width ? { width: props.width } : undefined))
</script>
