<template>
  <aside class="session-sidebar">
    <button class="btn-new" @click="$emit('create')">+ 新会话</button>
    <div class="session-list">
      <div
        v-for="s in sessions"
        :key="s.id"
        class="session-item"
        :class="{ active: currentId === s.id }"
        @click="$emit('select', s)"
      >
        <div class="session-info">
          <span class="session-name">{{ s.messages.length > 0 ? s.messages[0].content.slice(0, 20) : '新会话' }}</span>
          <span class="session-time">{{ formatTime(s.updatedAt) }}</span>
        </div>
        <button class="session-del" @click.stop="$emit('delete', s.id)" title="删除">✕</button>
      </div>
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
import type { Session, Skill } from '../../api/types'

defineProps<{
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

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.session-sidebar {
  width: 260px;
  background: #fff;
  border-right: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.btn-new {
  margin: 12px;
  padding: 10px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: opacity 0.15s;
}
.btn-new:hover { opacity: 0.9; }
.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}
.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.15s;
}
.session-item:hover { background: #f5f5f7; }
.session-item.active { background: #eef0ff; }
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
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-time {
  font-size: 11px;
  color: #bbb;
}
.session-del {
  background: none;
  border: none;
  color: #ccc;
  cursor: pointer;
  padding: 4px;
  font-size: 12px;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.15s;
}
.session-item:hover .session-del { opacity: 1; }
.session-del:hover { color: #ff4d4f; background: #fff2f0; }
.quick-cmds {
  border-top: 1px solid #e8e8e8;
  padding: 10px 12px;
}
.cmd-title { font-size: 11px; color: #999; margin-bottom: 6px; font-weight: 500; }
.cmd-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  background: #f5f5f7;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  margin-bottom: 4px;
  font-family: monospace;
  color: #667eea;
  font-weight: 500;
  transition: background 0.15s;
}
.cmd-btn:hover { background: #eef0ff; }
</style>
