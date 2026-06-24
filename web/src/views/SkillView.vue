<template>
  <div class="skill-page page-container">
    <PageHeader title="Skills" description="浏览所有可用的能力和场景 Skills" />

    <div class="filter-bar">
      <input v-model="search" class="search-input" placeholder="搜索 Skills..." />
      <div class="filter-tabs">
        <button class="ftab" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button class="ftab" :class="{ active: filter === 'scene' }" @click="filter = 'scene'">场景</button>
        <button class="ftab" :class="{ active: filter === 'capability' }" @click="filter = 'capability'">能力</button>
        <button class="ftab" :class="{ active: filter === 'test' }" @click="filter = 'test'">测试</button>
        <button class="ftab" :class="{ active: filter === 'base' }" @click="filter = 'base'">基础</button>
        <button class="ftab" :class="{ active: filter === 'pipeline' }" @click="filter = 'pipeline'">流水线</button>
        <button class="ftab" :class="{ active: filter === 'codex' }" @click="filter = 'codex'">Codex</button>
      </div>
    </div>

    <div class="skill-grid">
      <div
        v-for="skill in filteredSkills"
        :key="skill.name"
        class="skill-card"
        @click="openDetail(skill.name)"
      >
        <div class="skill-top">
          <span class="skill-type-badge" :class="skill.type">{{ skillTypeLabel(skill.type) }}</span>
          <span class="skill-name">{{ skill.name }}</span>
        </div>
        <div class="skill-desc">{{ skill.description }}</div>
        <div class="skill-tags">
          <span v-for="tag in skill.tags?.slice(0, 4)" :key="tag" class="tag">{{ tag }}</span>
          <span v-if="skill.constraints?.length" class="tag tag-constraint">{{ skill.constraints.length }} 条限制</span>
        </div>
        <div v-if="skill.dependencies?.length" class="skill-deps">
          依赖: {{ skill.dependencies.join(', ') }}
        </div>
      </div>
    </div>

    <div v-if="filteredSkills.length === 0" class="no-result">没有找到匹配的 Skill</div>

    <!-- 详情弹窗 -->
    <BaseModal v-model:show="detailSkillVisible" :title="detailSkill?.name || ''" :width="680">
      <template v-if="detailSkill" #header-extra>
        <span class="skill-type-badge" :class="detailSkill.type">{{ skillTypeLabel(detailSkill.type) }}</span>
      </template>
      <template v-if="detailSkill">
        <p class="detail-desc">{{ detailSkill.description }}</p>
        <div class="detail-tags">
          <span v-for="tag in detailSkill.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
        <div v-if="detailSkill.dependencies?.length" class="detail-deps">
          <strong>依赖:</strong> {{ detailSkill.dependencies.join(', ') }}
        </div>
        <div v-if="detailSkill.usage" class="detail-usage">
          <strong>使用场景:</strong> {{ detailSkill.usage }}
        </div>
        <div v-if="detailSkill.constraints?.length" class="detail-constraints">
          <strong>限制说明:</strong>
          <ul>
            <li v-for="c in detailSkill.constraints" :key="c">{{ c }}</li>
          </ul>
        </div>
        <div class="detail-content" v-html="renderedContent"></div>
      </template>
      <template v-if="detailSkill?.type === 'scene'" #footer>
        <BaseButton variant="primary" @click="tryInChat">在对话中试用</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'
import { listSkills, getSkill } from '../api/skills'
import type { Skill } from '../api/types'
import PageHeader from '../components/layout/PageHeader.vue'
import BaseModal from '../components/ui/BaseModal.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import Icon from '../components/ui/Icon.vue'
import { IconAction } from '../composables/icons'

const router = useRouter()
const skills = ref<Skill[]>([])
const search = ref('')
const filter = ref<'all' | 'scene' | 'capability' | 'test' | 'base' | 'pipeline' | 'codex'>('all')
const detailSkill = ref<Skill | null>(null)
const detailContent = ref('')
// BaseModal 的 show 双向绑定:detailSkill 非空时显示,关闭时置空
const detailSkillVisible = computed({
  get: () => detailSkill.value !== null,
  set: (v) => { if (!v) detailSkill.value = null },
})

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

function skillTypeLabel(type: Skill['type']) {
  const labels: Record<Skill['type'], string> = {
    scene: '场景',
    capability: '能力',
    test: '测试',
    base: '基础',
    pipeline: '流水线',
    codex: 'Codex',
  }
  return labels[type] || type
}
</script>

<style scoped>
.filter-bar {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  margin-top: var(--space-4);
}
.search-input {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  outline: none;
  width: 240px;
  transition: border-color var(--duration-fast) var(--ease);
}
.search-input:focus { border-color: var(--brand); }
.filter-tabs { display: flex; gap: 4px; }
.ftab {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  font-size: 12px;
  cursor: pointer;
  color: var(--text-2);
  transition: all var(--duration-fast) var(--ease);
}
.ftab.active {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
}
.skill-card {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: 18px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all var(--duration) var(--ease);
  border: 2px solid transparent;
}
.skill-card:hover {
  border-color: var(--brand);
  transform: translateY(-2px);
  box-shadow: var(--shadow-brand);
}
.skill-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.skill-type-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-weight: 500;
}
.skill-type-badge.scene { background: var(--brand-soft); color: var(--brand); }
.skill-type-badge.capability { background: var(--success-bg); color: var(--success); }
.skill-type-badge.test { background: #f9f0ff; color: #722ed1; }
.skill-type-badge.base { background: var(--info-bg); color: var(--info); }
.skill-type-badge.pipeline { background: var(--warning-bg); color: var(--warning); }
.skill-type-badge.codex { background: #ecfdf3; color: #087443; }
.skill-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  font-family: var(--font-mono);
}
.skill-desc {
  font-size: 13px;
  color: var(--text-3);
  line-height: 1.5;
  margin-bottom: 10px;
}
.skill-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  background: var(--bg-surface-2);
  color: var(--text-3);
}
.tag-constraint {
  background: var(--error-bg);
  color: var(--error);
  border: 1px solid var(--error-border);
}
.skill-deps {
  font-size: 11px;
  color: var(--text-4);
  margin-top: var(--space-2);
}
.no-result {
  text-align: center;
  color: var(--text-4);
  padding: 40px;
  font-size: 14px;
}

/* 详情弹窗内容(BaseModal 提供外壳) */
.detail-desc {
  font-size: 14px;
  color: var(--text-2);
  line-height: 1.6;
  margin-bottom: var(--space-3);
}
.detail-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: var(--space-3); }
.detail-deps {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: var(--space-3);
  padding: 8px 12px;
  background: var(--bg-surface-2);
  border-radius: var(--radius-sm);
}
.detail-usage {
  font-size: 13px;
  color: var(--info);
  margin-bottom: var(--space-3);
  padding: 8px 12px;
  background: var(--info-bg);
  border-radius: var(--radius-sm);
  line-height: 1.6;
}
.detail-constraints {
  font-size: 13px;
  color: var(--error);
  margin-bottom: var(--space-4);
  padding: 8px 12px;
  background: var(--error-bg);
  border-radius: var(--radius-sm);
  border: 1px solid var(--error-border);
}
.detail-constraints ul {
  margin: 6px 0 0;
  padding-left: 18px;
}
.detail-constraints li {
  margin-bottom: 3px;
  line-height: 1.5;
}
.detail-content {
  border-top: 1px solid var(--border);
  padding-top: var(--space-4);
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.7;
}
.detail-content :deep(h1), .detail-content :deep(h2), .detail-content :deep(h3) {
  color: var(--text-1);
  margin: 16px 0 8px;
}
.detail-content :deep(pre) {
  background: var(--code-bg);
  color: var(--code-text);
  padding: 12px;
  border-radius: var(--radius-md);
  overflow-x: auto;
  font-size: 12px;
}
.detail-content :deep(code) {
  background: var(--bg-surface-2);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  font-size: 12px;
}
.detail-content :deep(pre code) {
  background: none;
  padding: 0;
}
</style>
