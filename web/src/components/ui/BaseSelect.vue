<template>
  <n-select
    :value="modelValue"
    :options="options"
    :placeholder="placeholder"
    :size="nSize"
    :disabled="disabled"
    :clearable="clearable"
    :multiple="multiple"
    :style="widthStyle"
    @update:value="(v) => $emit('update:modelValue', v)"
  />
</template>

<script setup lang="ts">
/**
 * 统一下拉选择 —— 封装 naive-ui 的 NSelect
 * ----------------------------------------------------------------
 * 消除原生 <select> 的丑箭头,统一下拉样式、focus 光晕。
 * options 格式与 naive-ui 一致:[{ label, value, disabled? }]
 *
 * 用法:
 *   <BaseSelect v-model="v" :options="opts" placeholder="请选择" />
 */
import { NSelect } from 'naive-ui'
import type { SelectOption as NSelectOption } from 'naive-ui'
import { computed } from 'vue'

export type SelectOption = NSelectOption

const props = withDefaults(
  defineProps<{
    modelValue: string | number | (string | number)[]
    options: SelectOption[]
    placeholder?: string
    size?: 'small' | 'medium' | 'large'
    disabled?: boolean
    clearable?: boolean
    multiple?: boolean
    width?: string
  }>(),
  {
    placeholder: '请选择',
    size: 'medium',
    disabled: false,
    clearable: false,
    multiple: false,
    width: undefined,
  },
)

defineEmits<{ (e: 'update:modelValue', value: any): void }>()

const nSize = computed(() =>
  props.size === 'small' ? 'small' : props.size === 'large' ? 'large' : 'medium',
)

const widthStyle = computed(() => (props.width ? { width: props.width } : undefined))
</script>
