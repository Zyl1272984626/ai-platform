<template>
  <aside class="session-sidebar">
    <button class="btn-new" @click="$emit('create')">+ 新会话</button>

    <div class="search-wrap">
      <input
        v-model="keyword"
        class="search-input"
        placeholder="搜索会话..."
      />
    </div>

    <div class="session-list">
      <template v-for="g in grouped" :key="g.label">
        <div v-if="g.items.length" class="group-label">{{ g.label }}</div>
        <div
          v-for="s in g.items"
          :key="s.id"
          class="session-item"
          :class="{ active: currentId === s.id }"
          @click="$emit('select', s)"
        >
          <div class="session-info">
            <span class="session-name">{{ s.title || '新会话' }}</span>
            <span class="session-time">{{ formatTime(s.updatedAt) }}</span>
          </div>
          <button class="session-del" @click.stop="$emit('delete', s.id)" title="删除" aria-label="删除">
            <Icon :icon="IconAction.close" :size="14" />
          </button>
        </div>
      </template>
      <div v-if="filtered.length === 0" class="empty-hint">无匹配会话</div>
    </div>

    <div class="quick-cmds">
      <div class="cmd-title">快捷命令</div>
      <button v-for="skill in sceneSkills" :key="skill.name" class="cmd-btn" @click="$emit('command', skill.trigger?.command || `/${skill.name}`)">
        {{ skill.trigger?.command || `/${skill.name}` }}
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Session, Skill } from '../../api/types'
import Icon from '../ui/Icon.vue'
import { IconAction } from '../../composables/icons'

const props = defineProps<{
  sessions: Session[]
  currentId?: string
  sceneSkills: Skill[]
}>()

defineEmits<{
  create: []
  select: [session: Session]
  delete: [id: string]
  command: [cmd: string]
}>()

const keyword = ref('')

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.sessions
  return props.sessions.filter(s => (s.title || '新会话').toLowerCase().includes(kw))
})

interface Group { label: string; items: Session[] }

const grouped = computed<Group[]>(() => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86400000
  const groups: Group[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '更早', items: [] },
  ]
  for (const s of filtered.value) {
    const t = new Date(s.updatedAt).getTime()
    if (t >= today) groups[0].items.push(s)
    else if (t >= yesterday) groups[1].items.push(s)
    else groups[2].items.push(s)
  }
  return groups
})

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<style scoped>
.session-sidebar {
  width: 260px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.btn-new {
  margin: var(--space-3);
  padding: 10px;
  background: var(--brand);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background var(--duration-fast) var(--ease);
}
.btn-new:hover { background: var(--brand-hover); }

.search-wrap { padding: 0 var(--space-3) var(--space-2); }
.search-input {
  width: 100%;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  outline: none;
  transition: border-color var(--duration) var(--ease);
}
.search-input:focus { border-color: var(--brand); }
.search-input::placeholder { color: var(--text-4); }

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-2);
}
.group-label {
  font-size: 11px;
  color: var(--text-3);
  font-weight: 500;
  padding: 10px 6px 4px;
  position: sticky;
  top: 0;
  background: var(--bg-surface);
  z-index: 1;
}
.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  margin-bottom: 2px;
  transition: background var(--duration-fast) var(--ease);
}
.session-item:hover { background: var(--bg-surface-2); }
.session-item.active { background: var(--brand-soft); }
.session-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  flex: 1;
}
.session-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-time {
  font-size: 11px;
  color: var(--text-4);
}
.session-del {
  background: none;
  border: none;
  color: var(--text-4);
  cursor: pointer;
  padding: 4px;
  font-size: 12px;
  border-radius: var(--radius-xs);
  opacity: 0;
  transition: all var(--duration-fast) var(--ease);
}
.session-item:hover .session-del { opacity: 1; }
.session-del:hover { color: var(--error); background: var(--error-bg); }
.empty-hint {
  text-align: center;
  color: var(--text-4);
  font-size: 12px;
  padding: 20px 0;
}
.quick-cmds {
  border-top: 1px solid var(--border);
  padding: var(--space-2) var(--space-3);
}
.cmd-title { font-size: 11px; color: var(--text-3); margin-bottom: 6px; font-weight: 500; }
.cmd-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  background: var(--bg-surface-2);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  margin-bottom: 4px;
  font-family: var(--font-mono);
  color: var(--brand);
  font-weight: 500;
  transition: background var(--duration-fast) var(--ease);
}
.cmd-btn:hover { background: var(--brand-soft); }
</style>
