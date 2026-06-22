import { ref } from 'vue'

/**
 * 极简全局 Toast（无需组件库）
 *
 * 用法：
 *   import { toast } from '@/composables/useToast'
 *   toast.error('创建失败')
 *   toast.success('已保存')
 *
 * 在 App.vue 中挂载 <ToastHost /> 即可显示
 */

export interface ToastItem {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

const items = ref<ToastItem[]>([])
let seq = 0

function push(type: ToastItem['type'], message: string, duration = 2800) {
  const id = ++seq
  items.value.push({ id, type, message })
  setTimeout(() => {
    items.value = items.value.filter(t => t.id !== id)
  }, duration)
}

export const toast = {
  success: (msg: string) => push('success', msg),
  error: (msg: string) => push('error', msg, 4000),
  info: (msg: string) => push('info', msg),
}

export function useToast() {
  return { items, toast }
}
