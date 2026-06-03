<template>
  <div class="skill-page">
    <header class="page-header">
      <div>
        <h1>Skills</h1>
        <p class="page-desc">浏览所有可用的能力和场景 Skills</p>
      </div>
      <div class="filter-bar">
        <input v-model="search" class="search-input" placeholder="搜索 Skills..." />
        <div class="filter-tabs">
          <button class="ftab" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
          <button class="ftab" :class="{ active: filter === 'scene' }" @click="filter = 'scene'">场景</button>
          <button class="ftab" :class="{ active: filter === 'capability' }" @click="filter = 'capability'">能力</button>
          <button class="ftab" :class="{ active: filter === 'test' }" @click="filter = 'test'">测试</button>
          <button class="ftab" :class="{ active: filter === 'base' }" @click="filter = 'base'">基础</button>
        </div>
      </div>
    </header>

    <div class="skill-grid">
      <div
        v-for="skill in filteredSkills"
        :key="skill.name"
        class="skill-card"
        @click="openDetail(skill.name)"
      >
        <div class="skill-top">
          <span class="skill-type-badge" :class="skill.type">{{ skill.type === 'scene' ? '场景' : skill.type === 'test' ? '测试' : skill.type === 'base' ? '基础' : '能力' }}</span>
          <span class="skill-name">{{ skill.name }}</span>
        </div>
        <div class="skill-desc">{{ skill.description }}</div>
        <div class="skill-tags">
          <span v-for="tag in skill.tags?.slice(0, 4)" :key="tag" class="tag">{{ tag }}</span>
        </div>
        <div v-if="skill.dependencies?.length" class="skill-deps">
          依赖: {{ skill.dependencies.join(', ') }}
        </div>
      </div>
    </div>

    <div v-if="filteredSkills.length === 0" class="no-result">没有找到匹配的 Skill</div>

    <!-- 详情弹窗 -->
    <div v-if="detailSkill" class="detail-overlay" @click.self="detailSkill = null">
      <div class="detail-card">
        <div class="detail-header">
          <div>
            <span class="skill-type-badge" :class="detailSkill.type">{{ detailSkill.type === 'scene' ? '场景' : detailSkill.type === 'test' ? '测试' : detailSkill.type === 'base' ? '基础' : '能力' }}</span>
            <h2>{{ detailSkill.name }}</h2>
          </div>
          <button class="close-btn" @click="detailSkill = null">✕</button>
        </div>
        <p class="detail-desc">{{ detailSkill.description }}</p>
        <div class="detail-tags">
          <span v-for="tag in detailSkill.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
        <div v-if="detailSkill.dependencies?.length" class="detail-deps">
          <strong>依赖:</strong> {{ detailSkill.dependencies.join(', ') }}
        </div>
        <div class="detail-content" v-html="renderedContent"></div>
        <div v-if="detailSkill.type === 'scene'" class="detail-actions">
          <button class="btn-try" @click="tryInChat">在对话中试用</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'
import { listSkills, getSkill } from '../api/skills'
import type { Skill } from '../api/types'

const router = useRouter()
const skills = ref<Skill[]>([])
const search = ref('')
const filter = ref<'all' | 'scene' | 'capability' | 'test' | 'base'>('all')
const detailSkill = ref<Skill | null>(null)
const detailContent = ref('')

const filteredSkills = computed(() => {
  let list = skills.value
  if (filter.value !== 'all') list = list.filter(s => s.type === filter.value)
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q) ||
      s.tags?.some(t => t.toLowerCase().includes(q))
    )
  }
  return list
})

const renderedContent = computed(() => {
  if (!detailContent.value) return ''
  try { return marked.parse(detailContent.value) as string }
  catch { return detailContent.value.replace(/\n/g, '<br>') }
})

onMounted(async () => {
  try { skills.value = await listSkills() } catch { /* ignore */ }
})

async function openDetail(name: string) {
  try {
    const skill = await getSkill(name)
    detailSkill.value = skill
    detailContent.value = skill.content || ''
  } catch { /* ignore */ }
}

function tryInChat() {
  if (!detailSkill.value) return
  router.push('/chat')
}
</script>

<style scoped>
.skill-page {
  padding: 28px 32px;
  max-width: 1200px;
  margin: 0 auto;
}
.page-header { margin-bottom: 24px; }
.page-header h1 { font-size: 22px; font-weight: 700; color: #1a1a2e; }
.page-desc { font-size: 13px; color: #999; margin-top: 4px; }
.filter-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
}
.search-input {
  padding: 8px 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  width: 240px;
  transition: border-color 0.15s;
}
.search-input:focus { border-color: #667eea; }
.filter-tabs { display: flex; gap: 4px; }
.ftab {
  padding: 6px 14px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  color: #666;
  transition: all 0.15s;
}
.ftab.active {
  background: #667eea;
  color: #fff;
  border-color: #667eea;
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.skill-card {
  background: #fff;
  border-radius: 12px;
  padding: 18px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: all 0.15s;
  border: 2px solid transparent;
}
.skill-card:hover {
  border-color: #667eea;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.12);
}
.skill-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.skill-type-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.skill-type-badge.scene { background: #eef0ff; color: #667eea; }
.skill-type-badge.capability { background: #f0fff4; color: #52c41a; }
.skill-type-badge.test { background: #f9f0ff; color: #722ed1; }
.skill-type-badge.base { background: #e6f7ff; color: #1890ff; }
.skill-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a2e;
  font-family: monospace;
}
.skill-desc {
  font-size: 13px;
  color: #888;
  line-height: 1.5;
  margin-bottom: 10px;
}
.skill-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #f5f5f7;
  color: #999;
}
.skill-deps {
  font-size: 11px;
  color: #bbb;
  margin-top: 8px;
}
.no-result {
  text-align: center;
  color: #bbb;
  padding: 40px;
  font-size: 14px;
}

/* 详情弹窗 */
.detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.detail-card {
  background: #fff;
  border-radius: 14px;
  padding: 28px;
  width: 640px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}
.detail-header h2 {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a2e;
  margin-top: 4px;
}
.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: #999;
  cursor: pointer;
  padding: 4px;
}
.close-btn:hover { color: #333; }
.detail-desc {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
  margin-bottom: 12px;
}
.detail-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.detail-deps {
  font-size: 13px;
  color: #888;
  margin-bottom: 16px;
  padding: 8px 12px;
  background: #f5f5f7;
  border-radius: 6px;
}
.detail-content {
  border-top: 1px solid #eee;
  padding-top: 16px;
  font-size: 13px;
  color: #555;
  line-height: 1.7;
}
.detail-content :deep(h1), .detail-content :deep(h2), .detail-content :deep(h3) {
  color: #1a1a2e;
  margin: 16px 0 8px;
}
.detail-content :deep(pre) {
  background: #1e1e2e;
  color: #cdd6f4;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12px;
}
.detail-content :deep(code) {
  background: #f0f0f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.detail-content :deep(pre code) {
  background: none;
  padding: 0;
}
.detail-actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}
.btn-try {
  padding: 8px 24px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}
.btn-try:hover { opacity: 0.9; }
</style>
