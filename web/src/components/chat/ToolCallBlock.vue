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
        <CodeBlock :code="formatJson(input)" lang="json" />
      </div>
      <div v-if="result" class="tool-section">
        <div class="tool-section-label">结果</div>
        <CodeBlock :code="truncatedResult" lang="text" />
        <button v-if="isResultLong" class="toggle-more" @click.stop="showFull = !showFull">
          {{ showFull ? '收起' : '显示全部' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import CodeBlock from '../ui/CodeBlock.vue'

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
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-surface-2);
  overflow: hidden;
}
.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-2);
  transition: background var(--duration-fast) var(--ease);
}
.tool-header:hover { background: var(--bg-surface); }
.tool-status-dot {
  width: 8px; height: 8px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}
.dot-done { background: var(--success); }
.dot-loading {
  background: var(--info);
  animation: aui-blink 1s infinite;
}
.tool-name {
  font-weight: 600;
  color: var(--text-1);
  font-family: var(--font-mono);
}
.tool-preview {
  flex: 1;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-toggle {
  color: var(--info);
  font-weight: 500;
  white-space: nowrap;
}
.tool-detail {
  padding: 0 12px 12px;
}
.tool-section-label {
  font-size: 11px;
  color: var(--text-3);
  margin-bottom: 4px;
  font-weight: 500;
}
.toggle-more {
  background: none;
  border: none;
  color: var(--info);
  font-size: 11px;
  cursor: pointer;
  margin-top: 4px;
  padding: 0;
}
</style>
