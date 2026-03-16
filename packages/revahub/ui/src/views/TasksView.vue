<script setup lang="ts">
  import { ref, onMounted, watch } from 'vue';
  import { apiClient } from '../api';
  import OptionFields from '../components/OptionFields.vue';

  interface OptionDef {
    key: string;
    type: string;
    label: string;
    required?: boolean;
    default?: unknown;
    choices?: Array<{ label: string; value: string | number }>;
    module?: string;
    multi?: boolean;
  }

  interface Instance {
    id: string;
    moduleName: string;
    label: string;
  }

  interface Task {
    name: string;
    label: string;
    version: string;
    native: boolean;
  }

  interface TaskConfig {
    id: string;
    taskName: string;
    label: string;
    enabled: boolean;
    options: Record<string, unknown>;
  }

  interface TaskRun {
    id: string;
    taskConfigId: string;
    status: string;
    startedAt: string;
  }

  const tasks = ref<Task[]>([]);
  const taskConfigs = ref<TaskConfig[]>([]);
  const instances = ref<Instance[]>([]);
  const latestRuns = ref<Map<string, TaskRun>>(new Map());
  const loading = ref(true);
  const showCreateDialog = ref(false);
  const showEditDialog = ref(false);
  const optionDefs = ref<OptionDef[]>([]);

  const newConfig = ref<{ taskName: string; label: string; options: Record<string, unknown> }>({
    taskName: '', label: '', options: {}
  });

  const editConfig = ref<{ id: string; label: string; options: Record<string, unknown> }>({
    id: '', label: '', options: {}
  });

  onMounted(async () => {
    await loadData();
  });

  watch(() => newConfig.value.taskName, async (taskName) => {
    if (!taskName) {
      optionDefs.value = []; return;
    }

    try {
      optionDefs.value = await apiClient.getTaskOptions(taskName) as OptionDef[];
    } catch {
      optionDefs.value = [];
    }
  });

  async function loadData() {
    loading.value = true;
    try {
      const [taskData, configData, instData, runData] = await Promise.all([
        apiClient.getTasks(),
        apiClient.getTaskConfigs(),
        apiClient.getInstances(),
        apiClient.getTaskRuns({ limit: 200 })
      ]);

      tasks.value = taskData as Task[];
      taskConfigs.value = configData as TaskConfig[];
      instances.value = instData as Instance[];

      // Build latest run per config
      const runs = runData as TaskRun[];
      const map = new Map<string, TaskRun>();
      for (const run of runs) {
        if (!map.has(run.taskConfigId)) {
          map.set(run.taskConfigId, run);
        }
      }

      latestRuns.value = map;
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      loading.value = false;
    }
  }

  async function createConfig() {
    try {
      await apiClient.createTaskConfig(newConfig.value);
      showCreateDialog.value = false;
      newConfig.value = { taskName: '', label: '', options: {} };
      optionDefs.value = [];
      await loadData();
    } catch (err) {
      console.error('Failed to create task config:', err);
    }
  }

  async function openEdit(config: TaskConfig) {
    editConfig.value = { id: config.id, label: config.label, options: { ...config.options } };
    try {
      optionDefs.value = await apiClient.getTaskOptions(config.taskName) as OptionDef[];
    } catch {
      optionDefs.value = [];
    }

    showEditDialog.value = true;
  }

  async function saveEdit() {
    try {
      await apiClient.updateTaskConfig(editConfig.value.id, {
        label: editConfig.value.label,
        options: editConfig.value.options
      });
      showEditDialog.value = false;
      await loadData();
    } catch (err) {
      console.error('Failed to update task config:', err);
    }
  }

  async function toggleEnabled(config: TaskConfig) {
    await apiClient.updateTaskConfig(config.id, { enabled: !config.enabled });
    await loadData();
  }

  async function runTask(id: string) {
    try {
      await apiClient.runTaskConfig(id);
      await loadData();
    } catch (err) {
      console.error('Failed to run task:', err);
    }
  }

  async function deleteConfig(id: string) {
    if (!confirm('Delete this task config?')) return;

    await apiClient.deleteTaskConfig(id);
    await loadData();
  }

  function triggerInfo(options: Record<string, unknown>): string {
    const trigger = options.trigger as { type?: string; cron?: string; instance?: string; event?: string } | undefined;
    if (!trigger) return '—';
    if (trigger.type === 'cron') return `Cron: ${trigger.cron ?? ''}`;
    if (trigger.type === 'event') return `Event: ${trigger.instance ?? ''}/${trigger.event ?? ''}`;

    return '—';
  }

  function webhookUrl(config: TaskConfig): string | null {
    if (!(config.options as Record<string, unknown>).exposeWebhook) return null;

    return `/webhooks/${config.id}`;
  }

  function lastRunStatus(configId: string): TaskRun | undefined {
    return latestRuns.value.get(configId);
  }

  function statusColor(status: string): string {
    const colors: Record<string, string> = {
      running: 'info', success: 'success', failed: 'error', timed_out: 'warning'
    };
    return colors[status] ?? 'grey';
  }
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4">Tasks</h1>
      <v-spacer />
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        @click="showCreateDialog = true">
        New Config
      </v-btn>
    </div>

    <v-progress-linear
      v-if="loading"
      indeterminate />

    <v-card v-else>
      <v-table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Task</th>
            <th>Trigger</th>
            <th>Last Run</th>
            <th>Webhook</th>
            <th>Enabled</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="config in taskConfigs"
            :key="config.id">
            <td>{{ config.label }}</td>
            <td>{{ config.taskName }}</td>
            <td class="text-caption">{{ triggerInfo(config.options) }}</td>
            <td>
              <template v-if="lastRunStatus(config.id)">
                <v-chip
                  :color="statusColor(lastRunStatus(config.id)!.status)"
                  size="x-small">
                  {{ lastRunStatus(config.id)!.status }}
                </v-chip>
                <span class="text-caption ml-1">{{ new Date(lastRunStatus(config.id)!.startedAt).toLocaleString() }}</span>
              </template>
              <span
                v-else
                class="text-grey">—</span>
            </td>
            <td>
              <code
                v-if="webhookUrl(config)"
                class="text-caption">{{ webhookUrl(config) }}</code>
              <span
                v-else
                class="text-grey">—</span>
            </td>
            <td>
              <v-switch
                color="primary"
                density="compact"
                hide-details
                :model-value="config.enabled"
                @update:model-value="toggleEnabled(config)"
              />
            </td>
            <td>
              <v-btn
                color="success"
                icon="mdi-play"
                size="small"
                variant="text"
                @click="runTask(config.id)"
              />
              <v-btn
                icon="mdi-pencil"
                size="small"
                variant="text"
                @click="openEdit(config)"
              />
              <v-btn
                color="error"
                icon="mdi-delete"
                size="small"
                variant="text"
                @click="deleteConfig(config.id)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <!-- Create Dialog -->
    <v-dialog
      v-model="showCreateDialog"
      max-width="600">
      <v-card title="New Task Config">
        <v-card-text>
          <v-select
            v-model="newConfig.taskName"
            :items="tasks.map(t => ({ title: t.label, value: t.name }))"
            label="Task"
          />
          <v-text-field
            v-model="newConfig.label"
            label="Label" />
          <option-fields
            v-if="optionDefs.length"
            v-model="newConfig.options"
            :instances="instances"
            :option-defs="optionDefs"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showCreateDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            @click="createConfig">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Edit Dialog -->
    <v-dialog
      v-model="showEditDialog"
      max-width="600">
      <v-card title="Edit Task Config">
        <v-card-text>
          <v-text-field
            v-model="editConfig.label"
            label="Label" />
          <option-fields
            v-if="optionDefs.length"
            v-model="editConfig.options"
            :instances="instances"
            :option-defs="optionDefs"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showEditDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            @click="saveEdit">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
