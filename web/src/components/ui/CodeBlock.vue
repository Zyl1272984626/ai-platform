<template>
  <div class="code-wrap">
    <div class="code-header">
      <span class="code-lang">{{ lang }}</span>
      <button class="copy-btn" @click="copy">{{ copied ? '已复制' : '复制' }}</button>
    </div>
    <pre><code>{{ code }}</code></pre>
  </div>
</template>

<script setup lang="ts">
/**
 * 统一代码块组件
 * ----------------------------------------------------------------
 * 统一 MessageBubble / ToolCallBlock 里两份重复的 Catppuccin 暗色代码块。
 * 自带语言标签 + 复制按钮(声明式,替代 MessageBubble 里的 DOM 操作)。
 *
 * 用法:<CodeBlock :code="str" lang="json" />
 */
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    code: string
    lang?: string
  }>(),
  {
    lang: 'code',
  },
)

const copied = ref(false)

function copy() {
  navigator.clipboard
    .writeText(props.code)
    .then(() => {
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 1500)
    })
    .catch(() => {})
}
</script>

<style scoped>
.code-wrap {
  margin: 8px 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid #313244;
}
.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px;
  background: var(--code-bg-2);
  font-size: 11px;
}
.code-lang {
  color: #7f849c;
  font-family: var(--font-mono);
  text-transform: lowercase;
}
.copy-btn {
  background: none;
  border: 1px solid #45475a;
  color: #bac2de;
  font-size: 11px;
  padding: 1px 10px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease);
}
.copy-btn:hover {
  background: #313244;
  color: var(--code-text);
}
pre {
  margin: 0;
  border-radius: 0;
  background: var(--code-bg);
  color: var(--code-text);
  padding: 12px 16px;
  overflow-x: auto;
  font-size: 13px;
  font-family: var(--font-mono);
}
code {
  background: none;
  padding: 0;
  font-family: inherit;
}
</style>
