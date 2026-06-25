<template>
  <div class="page-header">
    <div class="page-header-main">
      <button v-if="showBack" class="back-btn" @click="handleBack" aria-label="返回">
        <Icon :icon="IconAction.back" :size="18" />
      </button>
      <div class="page-header-text">
        <div class="page-header-title-row">
          <h1 class="page-header-title">
            <slot name="title">{{ title }}</slot>
          </h1>
          <slot name="badge" />
        </div>
        <p v-if="description || $slots.description" class="page-header-desc">
          <slot name="description">{{ description }}</slot>
        </p>
      </div>
    </div>
    <div v-if="$slots.default" class="page-header-actions">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 统一页面头部
 * ----------------------------------------------------------------
 * 替换各视图里手写的 .page-header / .dash-header(原 Dashboard 26px /
 * School 22px / Test 22px 字号不一)。统一标题、描述、返回按钮、右侧操作。
 *
 * 用法:
 *   <PageHeader title="测试" description="运行各类测试">
 *     <BaseButton variant="primary">刷新</BaseButton>
 *   </PageHeader>
 *
 *   <PageHeader title="详情" show-back @back="goBack" />
 */
import { useRouter } from 'vue-router'
import { getCurrentInstance } from 'vue'
import Icon from '../ui/Icon.vue'
import { IconAction } from '../../composables/icons'

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    showBack?: boolean
  }>(),
  {
    description: '',
    showBack: false,
  },
)

const emit = defineEmits<{ (e: 'back'): void }>()
const router = useRouter()
const instance = getCurrentInstance()

function handleBack() {
  // 父组件监听了 back 则交给它处理,否则默认 router.back()
  if (instance?.vnode.props?.onBack) {
    emit('back')
  } else {
    router.back()
  }
}
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}
.page-header-main {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  min-width: 0;
}
.back-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  transition: all var(--duration-fast) var(--ease);
}
.back-btn:hover {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-soft);
}
.page-header-text {
  min-width: 0;
}
.page-header-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.page-header-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-1);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}
.page-header-desc {
  font-size: 13px;
  color: var(--text-3);
  margin-top: 6px;
  line-height: var(--leading-normal);
}
.page-header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
</style>
