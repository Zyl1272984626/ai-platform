<template>
  <n-modal
    :show="show"
    :preset="preset"
    :title="title"
    :style="modalStyle"
    :mask-closable="maskClosable"
    :close-on-esc="closeOnEsc"
    :bordered="false"
    :auto-focus="autoFocus"
    size="huge"
    @update:show="(v) => $emit('update:show', v)"
  >
    <template v-if="$slots['header-extra']" #header-extra>
      <slot name="header-extra" />
    </template>

    <slot />

    <template v-if="$slots.footer || showDefaultFooter" #footer>
      <slot name="footer">
        <div class="base-modal-footer">
          <BaseButton variant="ghost" @click="handleCancel">
            {{ cancelText }}
          </BaseButton>
          <BaseButton variant="primary" :loading="confirmLoading" @click="handleConfirm">
            {{ confirmText }}
          </BaseButton>
        </div>
      </slot>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
/**
 * 统一弹窗 —— 封装 naive-ui 的 NModal
 * ----------------------------------------------------------------
 * 替换全站手写的 .modal-overlay + .modal-content 结构(原 SettingsView 7 个、
 * SkillView/MemoryView/PipelineView/TestView 等共 12+ 处)。
 *
 * 自带:ESC 关闭、遮罩点击关闭、背景滚动锁定、遮罩动画、focus trap。
 *
 * 用法:
 *   <BaseModal v-model:show="visible" title="添加学校" @confirm="onSave">
 *     表单内容...
 *   </BaseModal>
 *
 *   或自定义底部:
 *   <BaseModal v-model:show="visible" title="详情">
 *     内容
 *     <template #footer>自定义按钮</template>
 *   </BaseModal>
 */
import { NModal } from 'naive-ui'
import { computed } from 'vue'
import BaseButton from './BaseButton.vue'

const props = withDefaults(
  defineProps<{
    show: boolean
    title?: string
    width?: number | string
    preset?: 'dialog' | 'card'
    maskClosable?: boolean
    closeOnEsc?: boolean
    autoFocus?: boolean
    // 默认底部按钮(确认/取消)相关
    showDefaultFooter?: boolean
    confirmText?: string
    cancelText?: string
    confirmLoading?: boolean
  }>(),
  {
    title: '',
    width: 520,
    preset: 'card',
    maskClosable: true,
    closeOnEsc: true,
    autoFocus: false,
    showDefaultFooter: false,
    confirmText: '确定',
    cancelText: '取消',
    confirmLoading: false,
  },
)

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const modalStyle = computed(() => ({
  width: typeof props.width === 'number' ? `${props.width}px` : props.width,
  maxWidth: '90vw',
}))

function handleCancel() {
  emit('cancel')
  emit('update:show', false)
}

function handleConfirm() {
  emit('confirm')
}
</script>

<style scoped>
.base-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
