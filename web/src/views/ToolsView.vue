<template>
  <div class="page-container tools-page">
    <PageHeader title="高级工具" description="底层能力仍然保留，但它们服务于研发任务，不再成为必须理解的主流程" />
    <div class="tool-grid">
      <button v-for="tool in tools" :key="tool.path" class="tool-card surface-card" @click="$router.push(tool.path)">
        <Icon :icon="tool.icon" :size="24" /><div><strong>{{ tool.name }}</strong><p>{{ tool.desc }}</p></div><span>→</span>
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import PageHeader from '../components/layout/PageHeader.vue'
import Icon from '../components/ui/Icon.vue'
import { IconNav } from '../composables/icons'
const tools=[
  {name:'执行流水线',desc:'查看既有接力运行和阶段产物',path:'/pipelines',icon:IconNav.pipeline},
  {name:'测试中心',desc:'运行 Agent、E2E、前端、API 和代码审查测试',path:'/tests',icon:IconNav.test},
  {name:'记忆维护',desc:'审查候选记忆、召回和自动化记录',path:'/memory',icon:IconNav.memory},
  {name:'Skills',desc:'查看系统可以调用的执行配方',path:'/skills',icon:IconNav.skill},
  {name:'工作流',desc:'保留既有自动化工作流入口',path:'/workflows',icon:IconNav.workflow},
  {name:'工程对话',desc:'进入原始会话和执行环境',path:'/chat',icon:IconNav.chat},
]
</script>
<style scoped>
.tools-page{max-width:1100px}.tool-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.tool-card{display:grid;grid-template-columns:42px 1fr auto;align-items:center;text-align:left;cursor:pointer;color:var(--brand)}.tool-card:hover{border-color:var(--brand-border);box-shadow:var(--shadow-md)}.tool-card strong{display:block;color:var(--text-1);font-size:14px}.tool-card p{font-size:11px;color:var(--text-3);margin-top:5px}.tool-card>span{font-size:20px}@media(max-width:700px){.tool-grid{grid-template-columns:1fr}}
</style>
