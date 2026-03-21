<script setup lang="ts">
  import type { TaskRow, TaskRunRow } from 'revahub-types';
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

  interface TaskPackage {
    name: string;
    label: string;
    version: string;
    source: string;
    native: boolean;
  }

  const taskPackages = ref<TaskPackage[]>([]);
  const tasks = ref<TaskRow[]>([]);
  const instances = ref<Instance[]>([]);
  const latestRuns = ref<Map<string, TaskRunRow>>(new Map());
  const loading = ref(true);
  const showCreateDialog = ref(false);
  const showEditDialog = ref(false);
  const optionDefs = ref<OptionDef[]>([]);

  const newTask = ref<{ taskName: string; label: string; options: Record<string, unknown> }>({
    taskName: '', label: '', options: {}
  });

  const editTask = ref<{ id: string; label: string; options: Record<string, unknown> }>({
    id: '', label: '', options: {}
  });

  onMounted(async () => {
    await loadData();
  });

  watch(() => newTask.value.taskName, async (taskName) => {
    if (!taskName) {
      optionDefs.value = []; return;
    }

    try {
      optionDefs.value = await apiClient.getTaskPackageOptions(taskName) as OptionDef[];
    } catch {
      optionDefs.value = [];
    }
  });

  async function loadData() {
    loading.value = true;
    try {
      const [packageData, taskData, instData, runData] = await Promise.all([
        apiClient.getTaskPackages(),
        apiClient.getTasks(),
        apiClient.getInstances(),
        apiClient.getTaskRuns({ limit: 200 })
      ]);

      taskPackages.value = packageData as unknown as TaskPackage[];
      tasks.value = taskData;
      instances.value = instData as Instance[];

      // Build latest run per task
      const map = new Map<string, TaskRunRow>();
      for (const run of runData) {
        if (!map.has(run.taskId)) {
          map.set(run.taskId, run);
        }
      }

      latestRuns.value = map;
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      loading.value = false;
    }
  }

  async function createTask() {
    try {
      await apiClient.createTask(newTask.value);
      showCreateDialog.value = false;
      newTask.value = { taskName: '', label: '', options: {} };
      optionDefs.value = [];
      await loadData();
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  }

  async function openEdit(task: TaskRow) {
    editTask.value = { id: task.id, label: task.label, options: { ...task.options } };
    try {
      optionDefs.value = await apiClient.getTaskPackageOptions(task.taskName) as OptionDef[];
    } catch {
      optionDefs.value = [];
    }

    showEditDialog.value = true;
  }

  async function saveEdit() {
    try {
      await apiClient.updateTask(editTask.value.id, {
        label: editTask.value.label,
        options: editTask.value.options
      });
      showEditDialog.value = false;
      await loadData();
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  }

  async function toggleEnabled(task: TaskRow) {
    await apiClient.updateTask(task.id, { enabled: !task.enabled });
    await loadData();
  }

  async function runTask(id: string) {
    try {
      await apiClient.runTask(id);
      await loadData();
    } catch (err) {
      console.error('Failed to run task:', err);
    }
  }

  async function deleteTask(id: string) {
    if (!confirm('Delete this task?')) return;

    await apiClient.deleteTask(id);
    await loadData();
  }

  function triggerInfo(options: Record<string, unknown>): string {
    const trigger = options.trigger as { type?: string; cron?: string; instance?: string; event?: string } | undefined;
    if (!trigger) return '—';
    if (trigger.type === 'cron') return `Cron: ${trigger.cron ?? ''}`;
    if (trigger.type === 'event') return `Event: ${trigger.instance ?? ''}/${trigger.event ?? ''}`;

    return '—';
  }

  function webhookUrl(task: TaskRow): string | null {
    if (!(task.options as Record<string, unknown>).exposeWebhook) return null;

    return `/webhooks/${task.id}`;
  }

  function lastRunStatus(taskId: string): TaskRunRow | undefined {
    return latestRuns.value.get(taskId);
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
      <h1 class="text-h4">
        Tasks
      </h1>
      <v-spacer />
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        @click="showCreateDialog = true"
      >
        New Task
      </v-btn>
    </div>

    <v-progress-linear
      v-if="loading"
      indeterminate
    />

    <v-card v-else>
      <v-table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Task Package</th>
            <th>Trigger</th>
            <th>Last Run</th>
            <th>Webhook</th>
            <th>Enabled</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="task in tasks"
            :key="task.id"
          >
            <td>{{ task.label }}</td>
            <td>{{ task.taskName }}</td>
            <td class="text-caption">
              {{ triggerInfo(task.options) }}
            </td>
            <td>
              <template v-if="lastRunStatus(task.id)">
                <v-chip
                  :color="statusColor(lastRunStatus(task.id)!.status)"
                  size="x-small"
                >
                  {{ lastRunStatus(task.id)!.status }}
                </v-chip>
                <span class="text-caption ml-1">{{ new Date(lastRunStatus(task.id)!.startedAt).toLocaleString() }}</span>
              </template>
              <span
                v-else
                class="text-grey"
              >—</span>
            </td>
            <td>
              <code
                v-if="webhookUrl(task)"
                class="text-caption"
              >{{ webhookUrl(task) }}</code>
              <span
                v-else
                class="text-grey"
              >—</span>
            </td>
            <td>
              <v-switch
                color="primary"
                density="compact"
                hide-details
                :model-value="task.enabled"
                @update:model-value="toggleEnabled(task)"
              />
            </td>
            <td>
              <v-btn
                color="success"
                icon="mdi-play"
                size="small"
                variant="text"
                @click="runTask(task.id)"
              />
              <v-btn
                icon="mdi-pencil"
                size="small"
                variant="text"
                @click="openEdit(task)"
              />
              <v-btn
                color="error"
                icon="mdi-delete"
                size="small"
                variant="text"
                @click="deleteTask(task.id)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <!-- Create Dialog -->
    <v-dialog
      v-model="showCreateDialog"
      max-width="600"
    >
      <v-card title="New Task">
        <v-card-text>
          <v-select
            v-model="newTask.taskName"
            :items="taskPackages.map(t => ({ title: t.label, value: t.name }))"
            label="Task Package"
          />
          <v-text-field
            v-model="newTask.label"
            label="Label"
          />
          <option-fields
            v-if="optionDefs.length"
            v-model="newTask.options"
            :instances="instances"
            :option-defs="optionDefs"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showCreateDialog = false">
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            @click="createTask"
          >
            Create
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Edit Dialog -->
    <v-dialog
      v-model="showEditDialog"
      max-width="600"
    >
      <v-card title="Edit Task">
        <v-card-text>
          <v-text-field
            v-model="editTask.label"
            label="Label"
          />
          <option-fields
            v-if="optionDefs.length"
            v-model="editTask.options"
            :instances="instances"
            :option-defs="optionDefs"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showEditDialog = false">
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            @click="saveEdit"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
