import type {
  ModuleInstanceRow,
  TaskRow,
  TaskRunRow,
  LogRow,
  SettingRow,
  OptionDef,
  PackageRegistryEntry
} from 'revahub-types';

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
  // Packages (replaces modules/tasks)
  getPackages: () => api<PackageRegistryEntry[]>('/packages'),
  getPackage: (name: string) => api<PackageRegistryEntry>(`/packages/${encodeURIComponent(name)}`),
  getPackageOptions: (name: string) => api<OptionDef[]>(`/packages/${encodeURIComponent(name)}/options`),

  // Modules (package registry)
  getModules: () => api<Array<{ name: string; version: string; label: string; source: string; status: string }>>('/modules'),
  getModule: (name: string) => api<{ name: string; version: string; label: string; source: string; status: string }>(`/modules/${encodeURIComponent(name)}`),
  getModuleOptions: (name: string) => api<OptionDef[]>(`/modules/${encodeURIComponent(name)}/options`),

  // Task Packages (package registry)
  getTaskPackages: () => api<Array<{ name: string; version: string; label: string; source: string; status: string }>>('/task-packages'),
  getTaskPackage: (name: string) => api<{ name: string; version: string; label: string; source: string; status: string }>(`/task-packages/${encodeURIComponent(name)}`),
  getTaskPackageOptions: (name: string) => api<OptionDef[]>(`/task-packages/${encodeURIComponent(name)}/options`),

  // Instances
  getInstances: () => api<ModuleInstanceRow[]>('/instances'),
  getInstance: (id: string) => api<ModuleInstanceRow>(`/instances/${encodeURIComponent(id)}`),
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
  getTasks: () => api<TaskRow[]>('/tasks'),
  getTask: (id: string) => api<TaskRow>(`/tasks/${encodeURIComponent(id)}`),
  createTask: (body: { taskName: string; label: string; options?: Record<string, unknown> }) =>
    api('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    api(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (id: string) =>
    api(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runTask: (id: string) =>
    api(`/tasks/${encodeURIComponent(id)}/run`, { method: 'POST' }),

  // Task Runs
  getTaskRuns: (params?: { taskId?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.taskId) query.set('taskId', params.taskId);
    if (params?.limit) query.set('limit', String(params.limit));

    return api<TaskRunRow[]>(`/task-runs?${query.toString()}`);
  },
  getTaskRun: (id: string) => api<TaskRunRow>(`/task-runs/${encodeURIComponent(id)}`),

  // Logs
  getLogs: (params?: { taskRunId?: string; moduleInstanceId?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.taskRunId) query.set('taskRunId', params.taskRunId);
    if (params?.moduleInstanceId) query.set('moduleInstanceId', params.moduleInstanceId);
    if (params?.limit) query.set('limit', String(params.limit));

    return api<LogRow[]>(`/logs?${query.toString()}`);
  },

  // Settings
  getSettings: () => api<SettingRow[]>('/settings'),
  updateSetting: (key: string, value: unknown) =>
    api(`/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }),

  // Marketplace
  searchPackages: (q?: string) => {
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    return api<Array<{ name: string; version: string; description: string }>>(`/marketplace/search${query}`);
  },
  installPackage: (packageName: string) =>
    api('/marketplace/install', { method: 'POST', body: JSON.stringify({ packageName }) }),
  uninstallPackage: (packageName: string) =>
    api('/marketplace/uninstall', { method: 'POST', body: JSON.stringify({ packageName }) }),
  updatePackage: (packageName: string) =>
    api('/marketplace/update', { method: 'POST', body: JSON.stringify({ packageName }) }),
  importLocalPackage: (path: string) =>
    api('/marketplace/import/local', { method: 'POST', body: JSON.stringify({ path }) }),
  importGitPackage: (url: string) =>
    api('/marketplace/import/git', { method: 'POST', body: JSON.stringify({ url }) }),
  pullGitPackage: (packageName: string) =>
    api('/marketplace/pull', { method: 'POST', body: JSON.stringify({ packageName }) }),
  removeLocalPackage: (packageName: string) =>
    api('/marketplace/remove-local', { method: 'POST', body: JSON.stringify({ packageName }) })
};
