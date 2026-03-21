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
    status: string;
    enabled: boolean;
    options: Record<string, unknown>;
  }

  interface Module {
    name: string;
    label: string;
    version: string;
    source: string;
    native: boolean;
  }

  const instances = ref<Instance[]>([]);
  const modules = ref<Module[]>([]);
  const loading = ref(true);
  const showCreateDialog = ref(false);
  const showEditDialog = ref(false);
  const showLogsDialog = ref(false);
  const optionDefs = ref<OptionDef[]>([]);

  const newInstance = ref<{ moduleName: string; label: string; options: Record<string, unknown> }>({
    moduleName: '',
    label: '',
    options: {}
  });

  const editInstance = ref<{ id: string; label: string; options: Record<string, unknown> }>({
    id: '', label: '', options: {}
  });

  const instanceLogs = ref<Array<{ id: string; level: string; message: string; timestamp: Date }>>([]);
  const logsInstanceId = ref('');

  onMounted(async () => {
    await loadData();
  });

  watch(() => newInstance.value.moduleName, async (moduleName) => {
    if (!moduleName) {
      optionDefs.value = []; return;
    }

    try {
      optionDefs.value = await apiClient.getModuleOptions(moduleName) as OptionDef[];
    } catch {
      optionDefs.value = [];
    }
  });

  async function loadData() {
    loading.value = true;
    try {
      const [instData, modData] = await Promise.all([
        apiClient.getInstances(),
        apiClient.getModules()
      ]);

      instances.value = instData as Instance[];
      modules.value = modData as unknown as Module[];
    } catch (err) {
      console.error('Failed to load instances:', err);
    } finally {
      loading.value = false;
    }
  }

  async function createInstance() {
    try {
      await apiClient.createInstance(newInstance.value);
      showCreateDialog.value = false;
      newInstance.value = { moduleName: '', label: '', options: {} };
      optionDefs.value = [];
      await loadData();
    } catch (err) {
      console.error('Failed to create instance:', err);
    }
  }

  async function openEdit(inst: Instance) {
    editInstance.value = { id: inst.id, label: inst.label, options: { ...inst.options } };
    try {
      optionDefs.value = await apiClient.getModuleOptions(inst.moduleName) as OptionDef[];
    } catch {
      optionDefs.value = [];
    }

    showEditDialog.value = true;
  }

  async function saveEdit() {
    try {
      await apiClient.updateInstance(editInstance.value.id, {
        label: editInstance.value.label,
        options: editInstance.value.options
      });
      showEditDialog.value = false;
      await loadData();
    } catch (err) {
      console.error('Failed to update instance:', err);
    }
  }

  async function openLogs(id: string) {
    logsInstanceId.value = id;
    showLogsDialog.value = true;
    try {
      instanceLogs.value = await apiClient.getLogs({ moduleInstanceId: id, limit: 100 });
    } catch {
      instanceLogs.value = [];
    }
  }

  async function startInstance(id: string) {
    await apiClient.startInstance(id);
    await loadData();
  }

  async function stopInstance(id: string) {
    await apiClient.stopInstance(id);
    await loadData();
  }

  async function restartInstance(id: string) {
    await apiClient.restartInstance(id);
    await loadData();
  }

  async function deleteInstance(id: string) {
    if (!confirm('Delete this instance?')) return;

    await apiClient.deleteInstance(id);
    await loadData();
  }

  function statusColor(status: string): string {
    const colors: Record<string, string> = {
      running: 'success',
      stopped: 'grey',
      crashed: 'error'
    };

    return colors[status] ?? 'grey';
  }

  function levelColor(level: string): string {
    const colors: Record<string, string> = { error: 'error', warn: 'warning', info: 'info', debug: 'grey' };
    return colors[level] ?? 'grey';
  }
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4">
        Module Instances
      </h1>
      <v-spacer />
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        @click="showCreateDialog = true"
      >
        New Instance
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
            <th>Module</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="inst in instances"
            :key="inst.id"
          >
            <td>{{ inst.label }}</td>
            <td>{{ inst.moduleName }}</td>
            <td>
              <v-chip
                :color="statusColor(inst.status)"
                size="small"
              >
                {{ inst.status }}
              </v-chip>
            </td>
            <td>
              <v-btn
                v-if="inst.status !== 'running'"
                color="success"
                icon="mdi-play"
                size="small"
                variant="text"
                @click="startInstance(inst.id)"
              />
              <v-btn
                v-if="inst.status === 'running'"
                color="warning"
                icon="mdi-stop"
                size="small"
                variant="text"
                @click="stopInstance(inst.id)"
              />
              <v-btn
                color="info"
                icon="mdi-restart"
                size="small"
                variant="text"
                @click="restartInstance(inst.id)"
              />
              <v-btn
                icon="mdi-pencil"
                size="small"
                variant="text"
                @click="openEdit(inst)"
              />
              <v-btn
                icon="mdi-text-box-outline"
                size="small"
                variant="text"
                @click="openLogs(inst.id)"
              />
              <v-btn
                color="error"
                icon="mdi-delete"
                size="small"
                variant="text"
                @click="deleteInstance(inst.id)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-dialog
      v-model="showCreateDialog"
      max-width="600"
    >
      <v-card title="New Instance">
        <v-card-text>
          <v-select
            v-model="newInstance.moduleName"
            :items="modules.map(m => ({ title: m.label, value: m.name }))"
            label="Module"
          />
          <v-text-field
            v-model="newInstance.label"
            label="Label"
          />
          <option-fields
            v-if="optionDefs.length"
            v-model="newInstance.options"
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
            @click="createInstance"
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
      <v-card title="Edit Instance">
        <v-card-text>
          <v-text-field
            v-model="editInstance.label"
            label="Label"
          />
          <option-fields
            v-if="optionDefs.length"
            v-model="editInstance.options"
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

    <!-- Logs Dialog -->
    <v-dialog
      v-model="showLogsDialog"
      max-width="800"
    >
      <v-card title="Instance Logs">
        <v-card-text>
          <v-list
            v-if="instanceLogs.length"
            density="compact"
          >
            <v-list-item
              v-for="log in instanceLogs"
              :key="log.id"
            >
              <template #prepend>
                <v-chip
                  class="mr-2"
                  :color="levelColor(log.level)"
                  size="x-small"
                >
                  {{ log.level }}
                </v-chip>
              </template>
              <v-list-item-title>{{ log.message }}</v-list-item-title>
              <v-list-item-subtitle>{{ new Date(log.timestamp).toLocaleString() }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <p
            v-else
            class="text-grey"
          >
            No logs
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showLogsDialog = false">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
