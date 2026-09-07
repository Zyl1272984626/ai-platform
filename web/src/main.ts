// 全局样式(顺序:reset → tokens → global,必须在最顶部)
import './styles/reset.css'
import './styles/tokens.css'
import './styles/global.css'

import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { createPinia } from 'pinia'
import App from './App.vue'

// 懒加载所有视图
const TaskView = () => import('./views/TaskView.vue')
const ProjectBaselineView = () => import('./views/ProjectBaselineView.vue')
const EvidenceView = () => import('./views/EvidenceView.vue')
const ToolsView = () => import('./views/ToolsView.vue')
const ChatView = () => import('./views/ChatView.vue')
const SchoolView = () => import('./views/SchoolView.vue')
const SchoolDetailView = () => import('./views/SchoolDetailView.vue')
const ProjectConfigView = () => import('./views/ProjectConfigView.vue')
const ProjectDeployView = () => import('./views/ProjectDeployView.vue')
const WorkflowView = () => import('./views/WorkflowView.vue')
const SkillView = () => import('./views/SkillView.vue')
const TestView = () => import('./views/TestView.vue')
const SettingsView = () => import('./views/SettingsView.vue')
const PipelineView = () => import('./views/PipelineView.vue')
const MemoryView = () => import('./views/MemoryView.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/tasks' },
    { path: '/tasks', component: TaskView },
    { path: '/projects', component: ProjectBaselineView },
    { path: '/evidence', component: EvidenceView },
    { path: '/tools', component: ToolsView },
    { path: '/chat', component: ChatView },
    { path: '/schools', component: SchoolView },
    { path: '/schools/:code', component: SchoolDetailView },
    // 项目级：配置 / 部署（必须放在 :code 之前，否则被通配匹配）
    { path: '/schools/:code/projects/:pcode/deploy', component: ProjectDeployView },
    { path: '/schools/:code/projects/:pcode', component: ProjectConfigView },
    // 兼容旧书签：/schools/:code/deploy → 跳转到 agent 项目部署
    { path: '/schools/:code/deploy', redirect: to => `/schools/${to.params.code}/projects/agent/deploy` },
    { path: '/workflows', component: WorkflowView },
    { path: '/skills', component: SkillView },
    { path: '/tests', component: TestView },
    { path: '/pipelines', component: PipelineView },
    { path: '/memory', component: MemoryView },
    { path: '/settings', component: SettingsView },
  ],
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
