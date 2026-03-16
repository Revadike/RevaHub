import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from './views/DashboardView.vue';
import InstancesView from './views/InstancesView.vue';
import TasksView from './views/TasksView.vue';
import TaskRunsView from './views/TaskRunsView.vue';
import MarketplaceView from './views/MarketplaceView.vue';
import SettingsView from './views/SettingsView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/instances', name: 'instances', component: InstancesView },
    { path: '/tasks', name: 'tasks', component: TasksView },
    { path: '/task-runs', name: 'task-runs', component: TaskRunsView },
    { path: '/marketplace', name: 'marketplace', component: MarketplaceView },
    { path: '/settings', name: 'settings', component: SettingsView }
  ]
});
