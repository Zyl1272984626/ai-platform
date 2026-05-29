<template>
  <div class="message" :class="role">
    <div class="msg-avatar">{{ role === 'user' ? '你' : 'AI' }}</div>
    <div class="msg-body">
      <div v-if="role === 'assistant'" class="msg-html" v-html="rendered"></div>
      <div v-else class="msg-text">{{ content }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'

marked.setOptions({
  breaks: true,
  gfm: true,
})

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
}>()

const rendered = computed(() => {
  if (!props.content) return ''
  try {
    return marked.parse(props.content) as string
  } catch {
    return props.content.replace(/\n/g, '<br>')
  }
})
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
  background: #667eea;
  color: #fff;
}
.message.assistant .msg-avatar {
  background: #f0f0f5;
  color: #666;
}
.msg-body {
  border-radius: 14px;
  padding: 10px 16px;
  line-height: 1.6;
  font-size: 14px;
}
.message.user .msg-body {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.message.assistant .msg-body {
  background: #fff;
  color: #333;
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.msg-html :deep(pre) {
  background: #1e1e2e;
  color: #cdd6f4;
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
  margin: 8px 0;
}
.msg-html :deep(code) {
  background: #f0f0f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: 'Fira Code', monospace;
}
.msg-html :deep(pre code) {
  background: none;
  padding: 0;
}
.msg-html :deep(p) { margin: 6px 0; }
.msg-html :deep(ul), .msg-html :deep(ol) { padding-left: 20px; }
.msg-html :deep(strong) { color: #1a1a2e; }
</style>
