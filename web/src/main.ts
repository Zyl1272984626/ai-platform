import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { createPinia } from 'pinia'
import App from './App.vue'

// 懒加载所有视图
const DashboardView = () => import('./views/DashboardView.vue')
const ChatView = () => import('./views/ChatView.vue')
const SchoolView = () => import('./views/SchoolView.vue')
const SchoolDetailView = () => import('./views/SchoolDetailView.vue')
const SchoolDeployView = () => import('./views/SchoolDeployView.vue')
const WorkflowView = () => import('./views/WorkflowView.vue')
const SkillView = () => import('./views/SkillView.vue')
const TestView = () => import('./views/TestView.vue')
const SettingsView = () => import('./views/SettingsView.vue')
const PipelineView = () => import('./views/PipelineView.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: DashboardView },
    { path: '/chat', component: ChatView },
    { path: '/schools', component: SchoolView },
    { path: '/schools/:code/deploy', component: SchoolDeployView },
    { path: '/schools/:code', component: SchoolDetailView },
    { path: '/workflows', component: WorkflowView },
    { path: '/skills', component: SkillView },
    { path: '/tests', component: TestView },
    { path: '/pipelines', component: PipelineView },
    { path: '/settings', component: SettingsView },
  ],
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
