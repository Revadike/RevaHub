<script setup lang="ts">
  import { ref, onMounted } from 'vue';
  import { apiClient } from '../api';
  import type { TaskRunRow } from 'revahub-types';

  interface Instance {
    id: string;
    moduleName: string;
    label: string;
    status: string;
  }

  const instances = ref<Instance[]>([]);
  const recentRuns = ref<TaskRunRow[]>([]);
  const loading = ref(true);

  onMounted(async () => {
    try {
      const [instanceData, runData] = await Promise.all([
        apiClient.getInstances(),
        apiClient.getTaskRuns({ limit: 10 })
      ]);

      instances.value = instanceData as Instance[];
      recentRuns.value = runData;
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      loading.value = false;
    }
  });

  function statusColor(status: string): string {
    const colors: Record<string, string> = {
      running: 'success',
      stopped: 'grey',
      crashed: 'error',
      success: 'success',
      failed: 'error',
      timed_out: 'warning'
    };

    return colors[status] ?? 'grey';
  }
</script>

<template>
  <div>
    <h1 class="text-h4 mb-4">
      Dashboard
    </h1>

    <v-progress-linear
      v-if="loading"
      indeterminate
    />

    <v-row v-else>
      <v-col
        cols="12"
        md="6"
      >
        <v-card title="Module Instances">
          <v-card-text>
            <v-list v-if="instances.length">
              <v-list-item
                v-for="inst in instances"
                :key="inst.id"
                :subtitle="inst.moduleName"
                :title="inst.label"
              >
                <template #append>
                  <v-chip
                    :color="statusColor(inst.status)"
                    size="small"
                  >
                    {{ inst.status }}
                  </v-chip>
                </template>
              </v-list-item>
            </v-list>
            <p
              v-else
              class="text-grey"
            >
              No instances configured
            </p>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col
        cols="12"
        md="6"
      >
        <v-card title="Recent Task Runs">
          <v-card-text>
            <v-list v-if="recentRuns.length">
              <v-list-item
                v-for="run in recentRuns"
                :key="run.id"
                :subtitle="`${run.triggerType} — ${new Date(run.startedAt).toLocaleString()}`"
                :title="run.taskId"
              >
                <template #append>
                  <v-chip
                    :color="statusColor(run.status)"
                    size="small"
                  >
                    {{ run.status }}
                  </v-chip>
                </template>
              </v-list-item>
            </v-list>
            <p
              v-else
              class="text-grey"
            >
              No recent runs
            </p>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
