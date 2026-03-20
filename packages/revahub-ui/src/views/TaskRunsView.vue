<script setup lang="ts">
  import { ref, onMounted } from 'vue';
  import { apiClient } from '../api';
  import type { TaskRunRow, LogRow } from 'revahub-types';

  const runs = ref<TaskRunRow[]>([]);
  const loading = ref(true);
  const showLogsDialog = ref(false);
  const runLogs = ref<LogRow[]>([]);
  const selectedRunId = ref('');

  onMounted(async () => {
    await loadData();
  });

  async function loadData() {
    loading.value = true;
    try {
      runs.value = await apiClient.getTaskRuns({ limit: 50 });
    } catch (err) {
      console.error('Failed to load task runs:', err);
    } finally {
      loading.value = false;
    }
  }

  async function viewLogs(runId: string) {
    selectedRunId.value = runId;
    showLogsDialog.value = true;
    try {
      runLogs.value = await apiClient.getLogs({ taskRunId: runId, limit: 200 });
    } catch {
      runLogs.value = [];
    }
  }

  function formatDate(date: Date | null): string {
    if (!date) return '-';

    return new Date(date).toLocaleString();
  }

  function statusColor(status: string): string {
    const colors: Record<string, string> = {
      running: 'info',
      success: 'success',
      failed: 'error',
      timed_out: 'warning'
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
        Task Runs
      </h1>
      <v-spacer />
      <v-btn
        icon="mdi-refresh"
        variant="text"
        @click="loadData"
      />
    </div>

    <v-progress-linear
      v-if="loading"
      indeterminate
    />

    <v-card v-else>
      <v-table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Config</th>
            <th>Trigger</th>
            <th>Status</th>
            <th>Retries</th>
            <th>Started</th>
            <th>Finished</th>
            <th>Logs</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="run in runs"
            :key="run.id"
          >
            <td class="text-mono">
              {{ run.id }}
            </td>
            <td>{{ run.taskId }}</td>
            <td>{{ run.triggerType }}</td>
            <td>
              <v-chip
                :color="statusColor(run.status)"
                size="small"
              >
                {{ run.status }}
              </v-chip>
            </td>
            <td>{{ run.retryCount }}</td>
            <td>{{ formatDate(run.startedAt) }}</td>
            <td>{{ formatDate(run.finishedAt) }}</td>
            <td>
              <v-btn
                icon="mdi-text-box-outline"
                size="small"
                variant="text"
                @click="viewLogs(run.id)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <!-- Per-run Logs Dialog -->
    <v-dialog
      v-model="showLogsDialog"
      max-width="800"
    >
      <v-card :title="`Logs — ${selectedRunId}`">
        <v-card-text>
          <v-list
            v-if="runLogs.length"
            density="compact"
          >
            <v-list-item
              v-for="log in runLogs"
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
            No logs for this run
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
