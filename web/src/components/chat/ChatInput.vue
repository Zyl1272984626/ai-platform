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
      <span class="stop-icon">■</span>
      <span>停止</span>
    </button>
    <button v-else class="send-btn" :disabled="!text.trim()" @click="send">
      <span>发送</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'

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
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #e8e8e8;
  background: #fff;
}
textarea {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #ddd;
  border-radius: 10px;
  resize: none;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  outline: none;
  transition: border-color 0.2s;
  max-height: 160px;
}
textarea:focus { border-color: #667eea; }
.send-btn {
  padding: 10px 24px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  transition: opacity 0.2s;
}
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.stop-btn {
  padding: 10px 24px;
  background: #fff;
  color: #ff4d4f;
  border: 1px solid #ffccc7;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.2s;
}
.stop-btn:hover { background: #fff2f0; }
.stop-icon {
  font-size: 10px;
  display: inline-block;
}
.sending { animation: blink 1s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
</style>
