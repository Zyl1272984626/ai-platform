<template>
  <n-icon :size="size" :color="color" :class="$attrs.class">
    <component :is="icon" />
  </n-icon>
</template>

<script setup lang="ts">
/**
 * 统一图标组件 —— 极薄封装 naive-ui 的 NIcon
 * ----------------------------------------------------------------
 * 接收 @vicons/ionicons5 的图标组件,统一尺寸/颜色。
 * 用法:<Icon :icon="GridOutline" /> 或 <Icon :icon="GridOutline" :size="20" />
 */
import { NIcon } from 'naive-ui'
import type { Component } from 'vue'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    icon: Component
    size?: number
    color?: string
  }>(),
  {
    size: 18,
    color: undefined,
  },
)
</script>
