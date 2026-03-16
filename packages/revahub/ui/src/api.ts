const BASE_URL = '/api';

/**
 * Typed fetch wrapper for the RevaHub API.
 * @param path - API endpoint path (relative to /api)
 * @param options - Standard fetch options
 * @returns Parsed JSON response
 */
async function api<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((error as { error?: string }).error ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  // Modules
  getModules: () => api('/modules'),
  getModule: (name: string) => api(`/modules/${encodeURIComponent(name)}`),
  getModuleOptions: (name: string) => api(`/modules/${encodeURIComponent(name)}/options`),

  // Instances
  getInstances: () => api('/instances'),
  getInstance: (id: string) => api(`/instances/${encodeURIComponent(id)}`),
  createInstance: (body: { moduleName: string; label: string; options?: Record<string, unknown> }) =>
    api('/instances', { method: 'POST', body: JSON.stringify(body) }),
  updateInstance: (id: string, body: Record<string, unknown>) =>
    api(`/instances/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteInstance: (id: string) =>
    api(`/instances/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  startInstance: (id: string) =>
    api(`/instances/${encodeURIComponent(id)}/start`, { method: 'POST' }),
  stopInstance: (id: string) =>
    api(`/instances/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  restartInstance: (id: string) =>
    api(`/instances/${encodeURIComponent(id)}/restart`, { method: 'POST' }),

  // Tasks
  getTasks: () => api('/tasks'),
  getTask: (name: string) => api(`/tasks/${encodeURIComponent(name)}`),
  getTaskOptions: (name: string) => api(`/tasks/${encodeURIComponent(name)}/options`),

  // Task Configs
  getTaskConfigs: () => api('/task-configs'),
  getTaskConfig: (id: string) => api(`/task-configs/${encodeURIComponent(id)}`),
  createTaskConfig: (body: { taskName: string; label: string; options?: Record<string, unknown> }) =>
    api('/task-configs', { method: 'POST', body: JSON.stringify(body) }),
  updateTaskConfig: (id: string, body: Record<string, unknown>) =>
    api(`/task-configs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTaskConfig: (id: string) =>
    api(`/task-configs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runTaskConfig: (id: string) =>
    api(`/task-configs/${encodeURIComponent(id)}/run`, { method: 'POST' }),

  // Task Runs
  getTaskRuns: (params?: { taskConfigId?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.taskConfigId) query.set('taskConfigId', params.taskConfigId);
    if (params?.limit) query.set('limit', String(params.limit));

    return api(`/task-runs?${query.toString()}`);
  },
  getTaskRun: (id: string) => api(`/task-runs/${encodeURIComponent(id)}`),

  // Logs
  getLogs: (params?: { taskRunId?: string; moduleInstanceId?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.taskRunId) query.set('taskRunId', params.taskRunId);
    if (params?.moduleInstanceId) query.set('moduleInstanceId', params.moduleInstanceId);
    if (params?.limit) query.set('limit', String(params.limit));

    return api(`/logs?${query.toString()}`);
  },

  // Settings
  getSettings: () => api('/settings'),
  updateSetting: (key: string, value: unknown) =>
    api(`/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }),

  // Marketplace
  searchPackages: (q?: string) => {
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    return api(`/marketplace/search${query}`);
  },
  installPackage: (packageName: string) =>
    api('/marketplace/install', { method: 'POST', body: JSON.stringify({ packageName }) }),
  uninstallPackage: (packageName: string) =>
    api('/marketplace/uninstall', { method: 'POST', body: JSON.stringify({ packageName }) }),
  updatePackage: (packageName: string) =>
    api('/marketplace/update', { method: 'POST', body: JSON.stringify({ packageName }) })
};
