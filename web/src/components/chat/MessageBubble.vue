<template>
  <div class="message" :class="role">
    <div class="msg-avatar">{{ role === 'user' ? '你' : 'AI' }}</div>
    <div class="msg-body">
      <div
        v-if="role === 'assistant'"
        ref="htmlEl"
        class="msg-html"
        v-html="rendered"
      ></div>
      <div v-else class="msg-text">{{ content }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { marked } from 'marked'

marked.setOptions({
  breaks: true,
  gfm: true,
})

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
}>()

const htmlEl = ref<HTMLElement>()

const rendered = computed(() => {
  if (!props.content) return ''
  try {
    return marked.parse(props.content) as string
  } catch {
    return props.content.replace(/\n/g, '<br>')
  }
})

/** 渲染后增强代码块：提取语言标签 + 注入复制按钮 header */
function enhanceCodeBlocks() {
  const root = htmlEl.value
  if (!root) return
  const pres = root.querySelectorAll('pre')
  pres.forEach(pre => {
    if (pre.parentElement?.classList.contains('code-wrap')) return // 已处理
    const code = pre.querySelector('code')
    // 提取语言（marked 输出 class="language-xxx"）
    let lang = ''
    if (code) {
      const m = code.className.match(/language-([\w-]+)/)
      if (m) lang = m[1]
    }
    // 包装：header 条 + pre
    const wrap = document.createElement('div')
    wrap.className = 'code-wrap'
    const header = document.createElement('div')
    header.className = 'code-header'
    const label = document.createElement('span')
    label.className = 'code-lang'
    label.textContent = lang || 'code'
    const btn = document.createElement('button')
    btn.className = 'copy-btn'
    btn.textContent = '复制'
    btn.addEventListener('click', () => {
      const text = code?.textContent || pre.textContent || ''
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '已复制'
        setTimeout(() => { btn.textContent = '复制' }, 1500)
      }).catch(() => {
        btn.textContent = '失败'
        setTimeout(() => { btn.textContent = '复制' }, 1500)
      })
    })
    header.appendChild(label)
    header.appendChild(btn)
    pre.parentNode?.insertBefore(wrap, pre)
    wrap.appendChild(header)
    wrap.appendChild(pre)
  })
}

onMounted(enhanceCodeBlocks)
watch(rendered, () => nextTick(enhanceCodeBlocks))
</script>

<style scoped>
.message {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  max-width: 85%;
}
.message.user {
  flex-direction: row-reverse;
  margin-left: auto;
}
.msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}
.message.user .msg-avatar {
  background: var(--brand);
  color: #fff;
}
.message.assistant .msg-avatar {
  background: var(--bg-surface-2);
  color: var(--text-2);
}
.msg-body {
  border-radius: var(--radius-lg);
  padding: 10px 16px;
  line-height: 1.6;
  font-size: 14px;
}
.message.user .msg-body {
  background: var(--brand);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.message.assistant .msg-body {
  background: var(--bg-surface);
  color: var(--text-2);
  border-bottom-left-radius: 4px;
  box-shadow: var(--shadow-sm);
}
.msg-html :deep(.code-wrap) {
  margin: 8px 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid #313244;
}
.msg-html :deep(.code-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px;
  background: var(--code-bg-2);
  font-size: 11px;
}
.msg-html :deep(.code-lang) {
  color: #7f849c;
  font-family: var(--font-mono);
  text-transform: lowercase;
}
.msg-html :deep(.copy-btn) {
  background: none;
  border: 1px solid #45475a;
  color: #bac2de;
  font-size: 11px;
  padding: 1px 10px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease);
}
.msg-html :deep(.copy-btn:hover) {
  background: #313244;
  color: var(--code-text);
}
.msg-html :deep(.code-wrap pre) {
  margin: 0;
  border-radius: 0;
}
.msg-html :deep(pre) {
  background: var(--code-bg);
  color: var(--code-text);
  padding: 12px 16px;
  border-radius: var(--radius-md);
  overflow-x: auto;
  font-size: 13px;
  margin: 8px 0;
}
.msg-html :deep(code) {
  background: var(--bg-surface-2);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  font-size: 13px;
  font-family: var(--font-mono);
}
.msg-html :deep(pre code) {
  background: none;
  padding: 0;
}
.msg-html :deep(p) { margin: 6px 0; }
.msg-html :deep(ul), .msg-html :deep(ol) { padding-left: 20px; }
.msg-html :deep(strong) { color: var(--text-1); }
</style>
