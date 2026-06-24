<template>
  <div class="chat-input-wrap">
    <textarea
      ref="textareaEl"
      v-model="text"
      @keydown.enter.exact.prevent="send"
      @input="autoResize"
      placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
      rows="1"
      :disabled="streaming"
    />
    <!-- streaming 时显示停止按钮，否则显示发送 -->
    <button v-if="streaming" class="stop-btn" @click="emit('stop')">
      <Icon :icon="IconAction.stop" :size="14" />
      <span>停止</span>
    </button>
    <button v-else class="send-btn" :disabled="!text.trim()" @click="send">
      <span>发送</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import Icon from '../ui/Icon.vue'
import { IconAction } from '../../composables/icons'

const props = defineProps<{ disabled?: boolean; streaming?: boolean }>()
const emit = defineEmits<{ send: [message: string]; stop: [] }>()

const text = ref('')
const textareaEl = ref<HTMLTextAreaElement>()

function autoResize() {
  nextTick(() => {
    const el = textareaEl.value
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }
  })
}

function send() {
  const msg = text.value.trim()
  if (!msg || props.disabled || props.streaming) return
  emit('send', msg)
  text.value = ''
  nextTick(() => {
    if (textareaEl.value) textareaEl.value.style.height = 'auto'
  })
}

function setInput(val: string) {
  text.value = val
  autoResize()
  textareaEl.value?.focus()
}

defineExpose({ setInput })
</script>

<style scoped>
.chat-input-wrap {
  display: flex;
  gap: var(--space-3);
  padding: 14px var(--space-5);
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
}
textarea {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  resize: none;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  outline: none;
  transition: border-color var(--duration) var(--ease);
  max-height: 160px;
}
textarea:focus { border-color: var(--brand); }
.send-btn {
  padding: 10px 24px;
  background: var(--brand);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  transition: background var(--duration) var(--ease);
}
.send-btn:hover:not(:disabled) { background: var(--brand-hover); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.stop-btn {
  padding: 10px 24px;
  background: var(--bg-surface);
  color: var(--error);
  border: 1px solid var(--error-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background var(--duration) var(--ease);
}
.stop-btn:hover { background: var(--error-bg); }
</style>
