<template>
  <div class="tool-block" :class="{ expanded }">
    <div class="tool-header" @click="expanded = !expanded">
      <span class="tool-status-dot" :class="statusClass"></span>
      <span class="tool-name">{{ name }}</span>
      <span v-if="inputPreview" class="tool-preview">{{ inputPreview }}</span>
      <span class="tool-toggle">{{ expanded ? '收起' : '展开' }}</span>
    </div>
    <div v-if="expanded" class="tool-detail">
      <div v-if="input" class="tool-section">
        <div class="tool-section-label">输入</div>
        <pre class="tool-code">{{ formatJson(input) }}</pre>
      </div>
      <div v-if="result" class="tool-section">
        <div class="tool-section-label">结果</div>
        <pre class="tool-code tool-result">{{ truncatedResult }}</pre>
        <button v-if="isResultLong" class="toggle-more" @click.stop="showFull = !showFull">
          {{ showFull ? '收起' : '显示全部' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  name: string
  input?: any
  result?: string
  done?: boolean
}>()

const expanded = ref(false)
const showFull = ref(false)

const statusClass = computed(() => props.done ? 'dot-done' : 'dot-loading')
const inputPreview = computed(() => {
  if (!props.input) return ''
  const s = JSON.stringify(props.input)
  return s.length > 60 ? s.slice(0, 60) + '...' : s
})

const isResultLong = computed(() => (props.result?.length || 0) > 300)
const truncatedResult = computed(() => {
  if (!props.result) return ''
  if (showFull.value || !isResultLong.value) return props.result
  return props.result.slice(0, 300) + '\n... (点击"显示全部"查看完整结果)'
})

function formatJson(obj: any): string {
  try {
    return typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}
</script>

<style scoped>
.tool-block {
  margin: 6px 0;
  border-radius: 8px;
  border: 1px solid #e8e8f0;
  background: #fafafe;
  overflow: hidden;
}
.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  transition: background 0.15s;
}
.tool-header:hover { background: #f0f0f5; }
.tool-status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-done { background: #52c41a; }
.dot-loading {
  background: #1890ff;
  animation: spin 1s infinite;
}
@keyframes spin { 0%,100%{opacity:1} 50%{opacity:0.3} }
.tool-name {
  font-weight: 600;
  color: #1a1a2e;
  font-family: monospace;
}
.tool-preview {
  flex: 1;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-toggle {
  color: #1890ff;
  font-weight: 500;
  white-space: nowrap;
}
.tool-detail {
  padding: 0 12px 12px;
}
.tool-section-label {
  font-size: 11px;
  color: #999;
  margin-bottom: 4px;
  font-weight: 500;
}
.tool-code {
  background: #1e1e2e;
  color: #cdd6f4;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-family: 'Fira Code', monospace;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
}
.tool-result { color: #a6e3a1; }
.toggle-more {
  background: none;
  border: none;
  color: #1890ff;
  font-size: 11px;
  cursor: pointer;
  margin-top: 4px;
  padding: 0;
}
</style>
