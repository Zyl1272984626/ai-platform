<template>
  <n-button
    :type="nType"
    :secondary="variant === 'ghost'"
    :tertiary="variant === 'text'"
    :size="nSize"
    :loading="loading"
    :disabled="disabled"
    :block="block"
    :circle="circle"
    @click="$emit('click', $event)"
  >
    <template v-if="$slots.icon || icon" #icon>
      <slot name="icon">
        <n-icon><component :is="icon" /></n-icon>
      </slot>
    </template>
    <slot />
  </n-button>
</template>

<script setup lang="ts">
/**
 * 统一按钮组件 —— 封装 naive-ui 的 NButton
 * ----------------------------------------------------------------
 * variant:
 *   primary  主按钮(实心品牌色)
 *   outline  描边按钮
 *   ghost    幽灵按钮(浅底)
 *   text     纯文字按钮
 *   danger   危险按钮(实心红)
 *
 * 用法:
 *   <BaseButton variant="primary" :icon="AddOutline" @click="...">添加</BaseButton>
 *   <BaseButton variant="danger" :loading="saving">删除</BaseButton>
 */
import { NButton, NIcon } from 'naive-ui'
import { computed } from 'vue'
import type { Component } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'outline' | 'ghost' | 'text' | 'danger'
    size?: 'small' | 'medium' | 'large'
    loading?: boolean
    disabled?: boolean
    block?: boolean
    circle?: boolean
    icon?: Component
  }>(),
  {
    variant: 'primary',
    size: 'medium',
    loading: false,
    disabled: false,
    block: false,
    circle: false,
    icon: undefined,
  },
)

defineEmits<{ (e: 'click', evt: MouseEvent): void }>()

const nType = computed(() => {
  switch (props.variant) {
    case 'danger':
      return 'error'
    case 'outline':
    case 'ghost':
    case 'text':
      return 'default'
    default:
      return 'primary'
  }
})

const nSize = computed(() =>
  props.size === 'small' ? 'small' : props.size === 'large' ? 'large' : 'medium',
)
</script>
